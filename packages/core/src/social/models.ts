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

export interface MediaAsset {
  id: string;
  url: string;
  type: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
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
  metadata: Record<string, unknown>; // Provider/Platform strategy data (SEO format etc.)
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
