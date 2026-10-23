export type AutonomyStatus =
  'idle' | 'planning' | 'executing' | 'verifying' | 'paused' | 'failed' | 'completed' | 'stopped';

export interface AutonomousProfile {
  id: string;
  name: string;
  description: string;
  maxBudgetUsd: number;
  maxConcurrency: number;
  maxTimeMs: number;
  failureThreshold: number;
  requireApprovalFor: string[];
}

export interface AutonomousTask {
  id: string;
  goal: string;
  profileId: string;
  status: AutonomyStatus;
  userId: string;
  workspaceId: string;
  plan: string[];
  currentStepIndex: number;
  failures: number;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomyEvent {
  id: string;
  taskId: string;
  type:
    | 'plan_created'
    | 'step_started'
    | 'step_completed'
    | 'step_failed'
    | 'approval_requested'
    | 'paused'
    | 'resumed'
    | 'stopped';
  details: Record<string, unknown>;
  timestamp: string;
}
