export type ContentStatus =
  'DRAFT' | 'READY' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'UNKNOWN';

export interface PlatformVariant {
  id: string;
  contentId: string;
  platform: string; // 'youtube', 'instagram', etc.
  title?: string;
  caption?: string;
  description?: string;
  hashtags: string[];
  tags: string[];
  privacyStatus?: string; // 'public', 'private', 'unlisted'
  metadata: Record<string, unknown>; // platform-specific extra data
  validationState: 'valid' | 'invalid' | 'unchecked';
  validationErrors?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ContentItem {
  id: string;
  userId: string;
  workspaceId: string;
  title?: string;
  description?: string;
  caption?: string;
  hashtags: string[];
  tags: string[];
  mediaAssetIds: string[]; // references to MediaAsset ids
  scheduledFor?: Date;
  status: ContentStatus;
  executionTaskId?: string; // linkage for idempotency/publishing state
  createdAt: Date;
  updatedAt: Date;
}
