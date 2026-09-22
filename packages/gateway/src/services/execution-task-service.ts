import { createHash } from 'node:crypto';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import { EXECUTION_TASK_TERMINAL, type ExecutionTask } from '@ownpilot/core/services';
import {
  ExecutionTasksRepository,
  ExecutionTaskRecoveryRepository,
} from '../db/repositories/execution-tasks.js';
import { createWorkflowsRepository } from '../db/repositories/workflows/index.js';
import { JobQueueService } from './job-queue-service.js';
import { getWorkflowService } from './workflow/index.js';
import { executionTaskContext } from './execution-task-context.js';
import { getLog } from './log.js';
import { sessionManager } from '../ws/session.js';
import type { JobRecord } from '../db/repositories/jobs.js';

const log = getLog('ExecutionTasks');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export class ExecutionTaskService {
  readonly repo: ExecutionTasksRepository;
  constructor(
    readonly userId: string,
    readonly workspaceId: string
  ) {
    this.repo = new ExecutionTasksRepository(userId, workspaceId);
  }
  private async fingerprint(workflowId: string, inputs: Record<string, unknown>): Promise<string> {
    await this.repo.authorizeWorkflow(workflowId);
    const workflow = await createWorkflowsRepository(this.userId).get(workflowId);
    if (!workflow) throw new Error('Workflow not found');
    // Bind approvals/retries to the workflow definition that the user submitted.
    return createHash('sha256')
      .update(
        canonical({
          workflowId,
          inputs,
          nodes: workflow.nodes,
          edges: workflow.edges,
          variables: workflow.variables,
        })
      )
      .digest('hex');
  }
  async audit(
    task: ExecutionTask,
    action: string,
    result?: string,
    approvalId?: string
  ): Promise<void> {
    const risk = new RiskEngine().classify('workflow.execute', action);
    const decision = new PolicyEngine().evaluate({
      identity: { userId: this.userId, workspaceId: this.workspaceId, roles: ['user'] },
      action,
      resource: task.workflowId,
      capability: 'workflow.execute',
      risk,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      autonomous: false,
      requestedParameters: {},
    });
    if (decision.decision !== 'ALLOW') throw new Error('Execution task denied by policy');
    await ActionLedger.record({
      userId: this.userId,
      workspaceId: this.workspaceId,
      taskId: task.id,
      runId: task.workflowRunId ?? undefined,
      tool: 'execution_task',
      action,
      resource: task.id,
      resourceType: 'execution_task',
      capability: 'workflow.execute',
      riskLevel: risk,
      policyDecision: decision.decision,
      executionEnvironment: process.env.NODE_ENV ?? 'development',
      durationMs: 0,
      result,
      approvalId,
    });
  }
  async start(input: { workflowId: string; requestKey: string; inputs?: Record<string, unknown> }) {
    const inputs = input.inputs ?? {};
    const requestHash = await this.fingerprint(input.workflowId, inputs);
    // Persist creation and job admission together. The worker audits before effects.
    const task = await this.repo.create({ ...input, inputs, requestHash });
    this.notify(task);
    return task;
  }
  async cancel(id: string) {
    const task = await this.repo.get(id);
    if (!task) throw new Error('Execution task not found');
    if (EXECUTION_TASK_TERMINAL.includes(task.state)) return task;
    await this.audit(task, 'execution_task.cancel_requested');
    const cancelled = await this.repo.cancel(id);
    if (task.jobId) await JobQueueService.getInstance().cancel(task.jobId);
    this.notify(cancelled);
    return cancelled;
  }
  async approve(id: string, approvalId: string) {
    const task = await this.repo.get(id);
    if (!task) throw new Error('Execution task not found');
    if ((await this.fingerprint(task.workflowId, task.inputs)) !== task.requestHash)
      throw new Error('Workflow changed; submit a new execution task');
    await this.audit(task, 'execution_task.approval_requested', 'approve', approvalId);
    const ready = await this.repo.approve(id, approvalId);
    this.notify(ready);
    return ready;
  }
  notify(task: ExecutionTask) {
    // A socket's authenticated owner is mandatory; workspace metadata alone grants nothing.
    for (const session of sessionManager.getAll()) {
      if (
        session.userId === task.userId &&
        (session.metadata.currentWorkspace ?? 'default') === task.workspaceId
      ) {
        sessionManager.send(session.id, 'execution-task:updated', {
          id: task.id,
          workspaceId: task.workspaceId,
          state: task.state,
          version: task.version,
        });
      }
    }
  }

  async execute(job: JobRecord, signal: AbortSignal): Promise<Record<string, unknown>> {
    const id = job.payload.executionTaskId;
    if (
      typeof id !== 'string' ||
      job.payload.userId !== this.userId ||
      job.payload.workspaceId !== this.workspaceId
    )
      throw new Error('Invalid execution task job identity');
    let task = await this.repo.get(id);
    if (!task || task.state !== 'READY' || task.jobId !== job.id)
      throw new Error('Execution task job is stale');
    try {
      signal.throwIfAborted();
      if ((await this.fingerprint(task.workflowId, task.inputs)) !== task.requestHash)
        throw new Error('Workflow changed since submission');
      await this.audit(task, 'execution_task.start');
      task = await this.repo.transition(id, task.version, 'RUNNING');
      this.notify(task);
      const workflowService = getWorkflowService();
      const onAbort = () => workflowService.cancelExecution(task!.workflowId);
      signal.addEventListener('abort', onAbort, { once: true });
      let run;
      try {
        run = await executionTaskContext.run(
          {
            taskId: id,
            userId: this.userId,
            workspaceId: this.workspaceId,
            workflowId: task.workflowId,
            signal,
          },
          async () => {
            if (typeof job.payload.approvalId === 'string')
              return workflowService.resumeFromApproval(job.payload.approvalId, this.userId);
            return workflowService.executeWorkflow(task!.workflowId, this.userId, undefined, {
              inputs: task!.inputs,
            });
          }
        );
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      signal.throwIfAborted();
      task = await this.repo.get(id);
      if (!task || task.state !== 'RUNNING') throw new Error('Execution task interrupted');
      if (run.id !== task.workflowRunId) throw new Error('Workflow result identity mismatch');
      if (run.status === 'awaiting_approval') {
        await this.audit(task, 'execution_task.waiting_approval');
        task = await this.repo.transition(id, task.version, 'WAITING_APPROVAL');
      } else if (
        run.status === 'completed' &&
        Object.values(run.nodeResults).every(
          (node) => node.status === 'success' || node.status === 'skipped'
        )
      ) {
        task = await this.repo.transition(id, task.version, 'VERIFYING');
        await this.audit(task, 'execution_task.verified', 'SUCCESS');
        signal.throwIfAborted();
        task = await this.repo.transition(id, task.version, 'COMPLETED', {
          outcome: 'SUCCESS',
          result: { workflowRunId: run.id },
        });
      } else {
        throw new Error(run.error ?? `Unverified workflow outcome: ${run.status}`);
      }
      this.notify(task);
      return { executionTaskId: id, state: task.state };
    } catch (error) {
      const current = await this.repo.get(id);
      if (current && !EXECUTION_TASK_TERMINAL.includes(current.state)) {
        const failed = await this.repo.cancel(
          id,
          error instanceof Error ? error.message : 'Interrupted execution',
          'UNKNOWN'
        );
        await this.audit(failed, 'execution_task.interrupted', 'UNKNOWN');
        this.notify(failed);
      }
      throw error;
    }
  }
}

export async function reconcileExecutionTasks() {
  for (const task of await new ExecutionTaskRecoveryRepository().interrupted()) {
    const service = new ExecutionTaskService(task.userId, task.workspaceId);
    const failed = await service.repo.cancel(
      task.id,
      'Execution interrupted; outcome requires inspection',
      'UNKNOWN'
    );
    await service.audit(failed, 'execution_task.recovered', 'UNKNOWN');
    service.notify(failed);
  }
}

export function registerExecutionTaskWorker(): () => void {
  const stop = JobQueueService.getInstance().startWorker(
    async (job, signal) => {
      const { userId, workspaceId } = job.payload;
      if (typeof userId !== 'string' || typeof workspaceId !== 'string')
        throw new Error('Missing execution task scope');
      return new ExecutionTaskService(userId, workspaceId).execute(job, signal);
    },
    { queue: 'execution_tasks', concurrency: 4, name: 'execution_task_worker' }
  );
  let reconciling = false;
  const timer = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    void reconcileExecutionTasks()
      .catch((error) => log.error('Execution task recovery failed', { error: String(error) }))
      .finally(() => {
        reconciling = false;
      });
  }, 5000);
  timer.unref();
  return () => {
    clearInterval(timer);
    stop();
  };
}
