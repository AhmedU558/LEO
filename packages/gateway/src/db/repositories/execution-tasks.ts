import { randomUUID } from 'node:crypto';
import { BaseRepository } from './base.js';
import {
  canTransitionExecutionTask,
  EXECUTION_TASK_TERMINAL,
  type ExecutionTask,
  type ExecutionTaskState,
} from '@ownpilot/core/services';

const columns = `id, user_id AS "userId", workspace_id AS "workspaceId", workflow_id AS "workflowId",
 workflow_run_id AS "workflowRunId", state, version, request_key AS "requestKey", request_hash AS "requestHash",
 inputs, result, error, outcome, job_id AS "jobId", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt"`;

export class ExecutionTasksRepository extends BaseRepository {
  constructor(
    readonly userId: string,
    readonly workspaceId: string
  ) {
    super();
    if (!userId || !workspaceId) throw new Error('Execution task identity required');
  }

  async authorizeWorkflow(workflowId: string): Promise<void> {
    const row = await this.queryOne(
      `SELECT id FROM workflows WHERE id=$1 AND user_id=$2 AND workspace_id=$3`,
      [workflowId, this.userId, this.workspaceId]
    );
    if (!row) throw new Error('Workflow not found in workspace');
    if (this.workspaceId !== 'default') {
      const workspace = await this.queryOne(
        `SELECT id FROM user_workspaces WHERE id=$1 AND user_id=$2 AND status='active'`,
        [this.workspaceId, this.userId]
      );
      if (!workspace) throw new Error('Workspace access denied');
    }
  }

  get(id: string): Promise<ExecutionTask | null> {
    return this.queryOne<ExecutionTask>(
      `SELECT ${columns} FROM execution_tasks WHERE id=$1 AND user_id=$2 AND workspace_id=$3`,
      [id, this.userId, this.workspaceId]
    );
  }

  list(): Promise<ExecutionTask[]> {
    return this.query<ExecutionTask>(
      `SELECT ${columns} FROM execution_tasks WHERE user_id=$1 AND workspace_id=$2 ORDER BY created_at DESC, id DESC LIMIT 100`,
      [this.userId, this.workspaceId]
    );
  }

  async create(input: {
    workflowId: string;
    requestKey: string;
    requestHash: string;
    inputs: Record<string, unknown>;
  }): Promise<ExecutionTask> {
    return this.transaction(async () => {
      await this.authorizeWorkflow(input.workflowId);
      const id = randomUUID();
      const inserted = await this.queryOne<ExecutionTask>(
        `INSERT INTO execution_tasks
        (id,user_id,workspace_id,workflow_id,state,request_key,request_hash,inputs)
        VALUES ($1,$2,$3,$4,'CREATED',$5,$6,$7) ON CONFLICT(user_id,workspace_id,request_key) DO NOTHING RETURNING ${columns}`,
        [
          id,
          this.userId,
          this.workspaceId,
          input.workflowId,
          input.requestKey,
          input.requestHash,
          JSON.stringify(input.inputs),
        ]
      );
      if (!inserted) {
        const prior = await this.queryOne<ExecutionTask>(
          `SELECT ${columns} FROM execution_tasks WHERE user_id=$1 AND workspace_id=$2 AND request_key=$3`,
          [this.userId, this.workspaceId, input.requestKey]
        );
        if (!prior || prior.requestHash !== input.requestHash)
          throw new Error('Idempotency key conflicts with existing submission');
        return prior;
      }
      return this.enqueueLocked(inserted);
    });
  }

  private async enqueueLocked(task: ExecutionTask, approvalId?: string): Promise<ExecutionTask> {
    const jobId = `execution:${task.id}:${task.version + 1}`;
    await this.execute(
      `INSERT INTO jobs(id,name,queue,payload,max_attempts) VALUES($1,'execution_task','execution_tasks',$2,1)`,
      [
        jobId,
        JSON.stringify({
          executionTaskId: task.id,
          userId: this.userId,
          workspaceId: this.workspaceId,
          approvalId,
        }),
      ]
    );
    return this.updateLocked(task, 'READY', { jobId });
  }

  private async lock(id: string): Promise<ExecutionTask> {
    const task = await this.queryOne<ExecutionTask>(
      `SELECT ${columns} FROM execution_tasks WHERE id=$1 AND user_id=$2 AND workspace_id=$3 FOR UPDATE`,
      [id, this.userId, this.workspaceId]
    );
    if (!task) throw new Error('Execution task not found');
    return task;
  }

  private async updateLocked(
    task: ExecutionTask,
    state: ExecutionTaskState,
    patch: Partial<
      Pick<ExecutionTask, 'workflowRunId' | 'jobId' | 'result' | 'error' | 'outcome'>
    > = {}
  ): Promise<ExecutionTask> {
    if (!canTransitionExecutionTask(task.state, state))
      throw new Error(`Invalid execution task transition ${task.state} -> ${state}`);
    if (state === 'COMPLETED' && patch.outcome !== 'SUCCESS')
      throw new Error('Completion requires verified success');
    const next = { ...task, ...patch };
    const updated = await this.queryOne<ExecutionTask>(
      `UPDATE execution_tasks SET state=$4,version=version+1,workflow_run_id=$5,job_id=$6,result=$7,error=$8,outcome=$9,updated_at=NOW(),completed_at=CASE WHEN $10 THEN NOW() ELSE completed_at END
      WHERE id=$1 AND user_id=$2 AND workspace_id=$3 AND version=$11 RETURNING ${columns}`,
      [
        task.id,
        this.userId,
        this.workspaceId,
        state,
        next.workflowRunId,
        next.jobId,
        JSON.stringify(next.result),
        next.error,
        next.outcome,
        EXECUTION_TASK_TERMINAL.includes(state),
        task.version,
      ]
    );
    if (!updated) throw new Error('Concurrent execution task transition');
    return updated;
  }

  async transition(
    id: string,
    version: number,
    state: ExecutionTaskState,
    patch: Partial<Pick<ExecutionTask, 'workflowRunId' | 'result' | 'error' | 'outcome'>> = {}
  ): Promise<ExecutionTask> {
    return this.transaction(async () => {
      const task = await this.lock(id);
      if (task.version !== version) throw new Error('Concurrent execution task transition');
      return this.updateLocked(task, state, patch);
    });
  }

  async bindRun(id: string, runId: string): Promise<void> {
    await this.transaction(async () => {
      const task = await this.lock(id);
      if (task.state !== 'RUNNING' || (task.workflowRunId && task.workflowRunId !== runId))
        throw new Error('Execution task cannot bind this run');
      const log = await this.queryOne(
        `SELECT id FROM workflow_logs WHERE id=$1 AND workflow_id=$2`,
        [runId, task.workflowId]
      );
      if (!log) throw new Error('Workflow run mismatch');
      await this.execute(
        `UPDATE execution_tasks SET workflow_run_id=$2,version=version+1,updated_at=NOW() WHERE id=$1`,
        [id, runId]
      );
    });
  }

  async whileRunning<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.transaction(async () => {
      const task = await this.lock(id);
      if (task.state !== 'RUNNING') throw new Error('Execution task no longer running');
      return fn();
    });
  }

  async cancel(
    id: string,
    error = 'Cancelled by user',
    outcome: 'CANCELLED' | 'UNKNOWN' = 'CANCELLED'
  ): Promise<ExecutionTask> {
    return this.transaction(async () => {
      const task = await this.lock(id);
      if (EXECUTION_TASK_TERMINAL.includes(task.state)) return task;
      const next = await this.updateLocked(task, outcome === 'UNKNOWN' ? 'FAILED' : 'CANCELLED', {
        error,
        outcome,
      });
      await this.execute(
        `UPDATE workflow_approvals SET status='rejected',decided_at=NOW() WHERE workflow_log_id=$1 AND user_id=$2 AND workspace_id=$3 AND status='pending'`,
        [task.workflowRunId, this.userId, this.workspaceId]
      );
      await this.execute(
        `UPDATE jobs SET status='cancelled',completed_at=NOW(),updated_at=NOW() WHERE (id=$1 OR payload->>'executionTaskId'=$2 OR payload->>'workflowRunId'=$3) AND status IN ('available','active')`,
        [task.jobId, task.id, task.workflowRunId]
      );
      if (task.workflowRunId)
        await this.execute(
          `UPDATE workflow_logs SET status=$2,error=$3,completed_at=NOW() WHERE id=$1 AND status IN ('running','awaiting_approval')`,
          [task.workflowRunId, outcome === 'UNKNOWN' ? 'failed' : 'cancelled', error]
        );
      return next;
    });
  }

  async approve(id: string, approvalId: string): Promise<ExecutionTask> {
    return this.transaction(async () => {
      const task = await this.lock(id);
      if (task.state !== 'WAITING_APPROVAL')
        throw new Error('Execution task is not waiting for approval');
      const approved = await this.queryOne(
        `UPDATE workflow_approvals SET status='approved',decided_at=NOW() WHERE id=$1 AND workflow_log_id=$2 AND user_id=$3 AND workspace_id=$4 AND status='pending' AND (expires_at IS NULL OR expires_at>NOW()) RETURNING id`,
        [approvalId, task.workflowRunId, this.userId, this.workspaceId]
      );
      if (!approved) throw new Error('Approval unavailable or expired');
      return this.enqueueLocked(task, approvalId);
    });
  }

  async detail(id: string) {
    const task = await this.get(id);
    if (!task) throw new Error('Execution task not found');
    const run = task.workflowRunId
      ? await this.queryOne(
          `SELECT id,status,node_results AS "nodeResults",error FROM workflow_logs WHERE id=$1 AND workflow_id=$2`,
          [task.workflowRunId, task.workflowId]
        )
      : null;
    const approvals = await this.query(
      `SELECT id,node_id AS "nodeId",status,message,expires_at AS "expiresAt" FROM workflow_approvals WHERE workflow_log_id=$1 AND user_id=$2 AND workspace_id=$3 ORDER BY created_at`,
      [task.workflowRunId, this.userId, this.workspaceId]
    );
    const audit = await this.query<{ actionId: string }>(
      `SELECT action_id AS "actionId" FROM action_ledger WHERE task_id=$1 AND user_id=$2 AND workspace_id=$3 ORDER BY timestamp LIMIT 200`,
      [id, this.userId, this.workspaceId]
    );
    return { task, run, approvals, auditActionIds: audit.map((a) => a.actionId) };
  }
}

/** Internal correlation only; callers must authenticate and check both scope fields. */
export class ExecutionTaskRecoveryRepository extends BaseRepository {
  byRun(runId: string) {
    return this.queryOne<ExecutionTask>(
      `SELECT ${columns} FROM execution_tasks WHERE workflow_run_id=$1`,
      [runId]
    );
  }
  async interrupted(): Promise<ExecutionTask[]> {
    return this
      .query<ExecutionTask>(`SELECT ${columns} FROM execution_tasks WHERE state IN ('READY','RUNNING','VERIFYING') AND (
      job_id IS NULL OR NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.id=execution_tasks.job_id AND (status='available' OR (status='active' AND lease_expires_at>NOW()))))`);
  }
}
