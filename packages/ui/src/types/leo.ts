/**
 * Wire types for the LEO autonomy / computer / voice / social / analytics APIs.
 *
 * These pages originally imported them from `@ownpilot/core/autonomy`,
 * `/computer`, `/voice`, `/social` and `/analytics`. `@ownpilot/core` is a Node
 * package and is not — and should not become — a dependency of the browser
 * bundle: it is not in `packages/ui/package.json`, no other UI file imports it,
 * and those five imports were the whole reason `tsc -b` and `vite build` failed
 * here. Every other UI module declares its API shapes locally, so these follow
 * that convention.
 *
 * They mirror `packages/core/src/{autonomy,computer,voice,social,analytics}/models.ts`.
 * Keep them in step when the gateway response shape changes.
 */

// ---------------------------------------------------------------------------
// Autonomy
// ---------------------------------------------------------------------------

export type AutonomyStatus =
  'idle' | 'planning' | 'executing' | 'verifying' | 'paused' | 'failed' | 'completed' | 'stopped';

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

// ---------------------------------------------------------------------------
// Computer use
// ---------------------------------------------------------------------------

export type ComputerActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'scroll'
  | 'screenshot'
  | 'execute_shell'
  | 'read_file'
  | 'write_file'
  | 'press_key'
  | 'hover';

export interface ComputerAction {
  type: ComputerActionType;
  params: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ComputerActionResult {
  success: boolean;
  actionId?: string;
  data?: unknown;
  screenshotBase64?: string;
  accessibilityTree?: unknown;
  error?: string;
}

export interface ComputerTask {
  id: string;
  userId: string;
  accountId?: string;
  targetUrl?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  actions: ComputerAction[];
  results: ComputerActionResult[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export type VoiceSessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'audio' | 'tool_call' | 'tool_result';
  text?: string;
  audioBase64?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: unknown;
  timestamp: string;
}

export interface VoiceSession {
  id: string;
  userId: string;
  status: VoiceSessionStatus;
  messages: VoiceMessage[];
  startedAt: string;
  endedAt?: string;
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'x';

export type ContentStatus =
  'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface SocialAccount {
  id: string;
  userId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName: string;
  profileUrl?: string;
  status: 'active' | 'disconnected' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface SocialMediaAsset {
  id: string;
  url: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
}

export interface SocialContentMetadata {
  instagram?: {
    caption?: string;
    hashtags?: string[];
    isReel?: boolean;
    locationId?: string;
  };
  tiktok?: {
    title?: string;
    privacyLevel?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
    disableComments?: boolean;
  };
  youtube?: {
    title?: string;
    description?: string;
    isShort?: boolean;
  };
}

export interface SocialContent {
  id: string;
  userId: string;
  accountId: string;
  platform: SocialPlatform;
  status: ContentStatus;
  text: string;
  media: SocialMediaAsset[];
  metadata: SocialContentMetadata;
  scheduledFor?: string;
  publishedUrl?: string;
  providerPostId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Analytics / learning
// ---------------------------------------------------------------------------

export interface LearningRecommendation {
  id: string;
  title: string;
  description: string;
  sourceType: 'success_pattern' | 'failure_trend' | 'user_feedback' | 'cost_optimization';
  targetComponent: string;
  proposedChange: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

export interface UsageStats {
  totalTasks: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
  activeAgents: number;
}

// ---------------------------------------------------------------------------
// Durable execution tasks
// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/services/execution-task.ts`.

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

// ---------------------------------------------------------------------------
// Social publishing campaigns
// ---------------------------------------------------------------------------
// Mirrors `packages/core/src/social/models.ts`.

export type CampaignStatus =
  | 'READY'
  | 'QUEUED'
  | 'WAITING_APPROVAL'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIAL'
  | 'FAILED'
  | 'UNKNOWN'
  | 'CANCELLED'
  | 'NEEDS_RECONCILIATION';

export interface PublishingCampaign {
  id: string;
  userId: string;
  workspaceId: string;
  contentItemId: string;
  executionTaskId?: string;
  status: CampaignStatus;
  scheduledFor?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
