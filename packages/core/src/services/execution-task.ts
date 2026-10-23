/** Durable executions are distinct from personal to-do tasks (SRS FR-008--010). */
export type ExecutionTaskState =
  | 'CREATED'
  | 'PLANNING'
  | 'READY'
  | 'WAITING_APPROVAL'
  | 'RUNNING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'PAUSED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface ExecutionTask {
  id: string;
  userId: string;
  workspaceId: string;
  workflowId: string;
  workflowRunId: string | null;
  state: ExecutionTaskState;
  version: number;
  requestKey: string;
  requestHash: string;
  inputs: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  outcome: 'UNKNOWN' | 'SUCCESS' | 'FAILURE' | 'CANCELLED' | null;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export const EXECUTION_TASK_TERMINAL: readonly ExecutionTaskState[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
];
const transitions: Record<ExecutionTaskState, readonly ExecutionTaskState[]> = {
  CREATED: ['PLANNING', 'READY', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PLANNING: ['READY', 'FAILED', 'CANCELLED', 'EXPIRED'],
  READY: ['RUNNING', 'FAILED', 'CANCELLED', 'EXPIRED'],
  RUNNING: ['WAITING_APPROVAL', 'VERIFYING', 'FAILED', 'CANCELLED', 'PAUSED'],
  WAITING_APPROVAL: ['READY', 'FAILED', 'CANCELLED', 'EXPIRED'],
  VERIFYING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  RETRYING: ['READY', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAUSED: ['READY', 'FAILED', 'CANCELLED', 'EXPIRED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};
export function canTransitionExecutionTask(
  from: ExecutionTaskState,
  to: ExecutionTaskState
): boolean {
  return transitions[from]?.includes(to) ?? false;
}
