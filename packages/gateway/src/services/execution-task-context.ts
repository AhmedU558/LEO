import { AsyncLocalStorage } from 'node:async_hooks';
import { ExecutionTasksRepository } from '../db/repositories/execution-tasks.js';

export interface ExecutionTaskContext {
  taskId: string;
  userId: string;
  workspaceId: string;
  workflowId: string;
  signal: AbortSignal;
  jobId?: string;
  leaseToken?: string;
  approvalId?: string;
}
export const executionTaskContext = new AsyncLocalStorage<ExecutionTaskContext>();
export const computerStepContext = new AsyncLocalStorage<{
  nodeId: string;
  runId: string;
  capabilities: readonly string[];
  effectIndex: number;
}>();

/** Recheck persisted cancellation before each step and before committing its result. */
export async function assertExecutionTaskActive(): Promise<void> {
  const ctx = executionTaskContext.getStore();
  if (!ctx) return;
  ctx.signal.throwIfAborted();
  const repo = new ExecutionTasksRepository(ctx.userId, ctx.workspaceId);
  const task = await repo.get(ctx.taskId);
  if (!task || task.state !== 'RUNNING' || task.workflowId !== ctx.workflowId)
    throw new Error('Execution task is no longer running');
  await repo.authorizeWorkflow(ctx.workflowId);
}

export async function bindExecutionTaskRun(workflowId: string, runId: string): Promise<void> {
  const ctx = executionTaskContext.getStore();
  if (!ctx) return;
  if (workflowId !== ctx.workflowId)
    throw new Error('Nested workflows require a separate execution task');
  await assertExecutionTaskActive();
  await new ExecutionTasksRepository(ctx.userId, ctx.workspaceId).bindRun(ctx.taskId, runId);
}
