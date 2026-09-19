export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'linkedin' | 'x';

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

export type ContentStatus =
  'draft' | 'pending_approval' | 'scheduled' | 'publishing' | 'published' | 'failed';

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
    tags?: string[];
    categoryId?: string;
    privacyStatus?: 'public' | 'unlisted' | 'private';
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
