import type { MediaAsset } from '../media/models.js';
export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'x';

export interface SocialAccount {
  id: string;
  userId: string;
  workspaceId: string;
  platform: SocialPlatform;
  accountId: string;
  accountName: string;
  profileUrl?: string;
  status: 'active' | 'disconnected' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface SocialPost {
  id: string;
  userId: string;
  workspaceId: string;
  accountId: string;
  platform: SocialPlatform;
  title?: string;
  text: string;
  hashtags: string[];
  media: MediaAsset[];
  metadata: Record<string, unknown>;
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublishStatus =
  'pending' | 'publishing' | 'published' | 'failed' | 'cancelled' | 'unknown';

export interface PublishRequest {
  id: string;
  userId: string;
  workspaceId: string;
  postId: string;
  accountId: string;
  status: PublishStatus;
  executionTaskId?: string;
  providerPostId?: string;
  publishedUrl?: string;
  error?: PlatformError;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformError {
  code: string;
  message: string;
  retryable: boolean;
  providerDetails?: unknown;
}

export interface PublishResult {
  status: PublishStatus;
  providerPostId?: string;
  publishedUrl?: string;
  error?: PlatformError;
}

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

export interface CampaignTarget {
  id: string;
  campaignId: string;
  userId: string;
  workspaceId: string;
  accountId: string;
  platform: SocialPlatform;
  publishRequestId: string;
  status: CampaignStatus;
  error?: PlatformError;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignRequest {
  contentItemId: string;
  accountIds: string[];
  scheduledFor?: string;
}
