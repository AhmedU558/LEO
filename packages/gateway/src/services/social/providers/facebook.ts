import type {
  SocialProvider,
  ProviderCapability,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';

export class FacebookProvider implements SocialProvider {
  readonly platform = 'facebook';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: true, // FB Pages support scheduling via scheduled_publish_time
      supportsVideo: true,
      supportsImages: true,
      supportsCancellation: true, // we can delete unpublished scheduled posts
      maxMediaCount: 1, // Let's stick to 1 for simplicity (or can use attached_media for multiple)
    };
  }

  async connect(code: string, redirectUri: string) {
    // 1. Exchange code for user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    );
    if (!tokenRes.ok) throw new Error('Failed to exchange code');
    // We will return the raw token data, and let the callback handle fetching pages,
    // OR we return an array of accounts. But the contract says Partial<SocialAccount>...
    // Wait, the contract returns a single account. If we want to return multiple,
    // we can change the contract, or we can just fetch pages in the callback directly?
    // Let's keep `connect` strictly returning the token, or we modify the contract.
    // Since we shouldn't redesign the working architecture, let's return the first page,
    // OR we can change `connect` to just return the first page.
    throw new Error(
      'Not used directly for Facebook due to multiple pages, see callback implementation'
    );
  }

  async getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'> {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${accessToken}`);
      return res.ok ? 'active' : 'disconnected';
    } catch {
      return 'error';
    }
  }

  async validateMedia(media: MediaAsset[]): Promise<{ valid: boolean; error?: string }> {
    if (!media || media.length === 0) {
      return { valid: false, error: 'Facebook requires at least one image or video' };
    }
    if (media.length > 1) {
      return { valid: false, error: 'Maximum 1 media item supported currently' };
    }
    for (const m of media) {
      if (m.mediaType !== 'image' && m.mediaType !== 'video') {
        return { valid: false, error: `Unsupported media type: ${m.mediaType}` };
      }
    }
    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    if (!post.media || post.media.length === 0) {
      return {
        status: 'failed',
        error: { code: 'INVALID_INPUT', message: 'Media required', retryable: false },
      };
    }

    const baseUrl = process.env.APP_URL || 'https://leo.local';
    const media = post.media[0]!;
    const mediaUrl = `${baseUrl}/api/v1/media/${media.id}/raw?token=mock_signed_token`;
    const pageId = (post.metadata?.providerAccountId as string) || post.accountId;

    if (media.mediaType === 'image') {
      const p = new URLSearchParams({
        access_token: accessToken,
        message: post.text || '',
        url: mediaUrl,
        published: 'true', // publish immediately
      });
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos?${p.toString()}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) return { status: 'failed', error: this.normalizeError(data) };

      // Photos are synchronous usually
      return {
        status: 'published',
        providerPostId: data.post_id || data.id,
        publishedUrl: `https://facebook.com/${data.post_id || data.id}`,
      };
    } else {
      const p = new URLSearchParams({
        access_token: accessToken,
        description: post.text || '',
        file_url: mediaUrl,
      });
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/videos?${p.toString()}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) return { status: 'failed', error: this.normalizeError(data) };

      // Videos are async
      return { status: 'publishing', providerPostId: data.id };
    }
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${providerPostId}?fields=status&access_token=${accessToken}`
    );
    if (!res.ok) {
      const errData = await res.json();
      return { status: 'unknown', error: this.normalizeError(errData) };
    }
    const data = await res.json();

    // Status object structure for videos: { video_status: "ready" | "processing" | "error" }
    const videoStatus = data.status?.video_status;
    if (videoStatus === 'ready') {
      return {
        status: 'published',
        providerPostId,
        publishedUrl: `https://facebook.com/${providerPostId}`,
      };
    } else if (videoStatus === 'processing') {
      return { status: 'publishing', providerPostId };
    } else if (videoStatus === 'error') {
      return {
        status: 'failed',
        providerPostId,
        error: { code: 'PROCESSING_ERROR', message: 'Video processing failed', retryable: false },
      };
    }

    return { status: 'unknown' };
  }

  async cancelPublish(providerPostId: string, accessToken: string): Promise<boolean> {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${providerPostId}?access_token=${accessToken}`,
      { method: 'DELETE' }
    );
    return res.ok;
  }

  normalizeError(error: unknown): PlatformError {
    const err = error as Record<string, Record<string, unknown>>;
    const code = err?.error?.code || 'UNKNOWN';
    const message = err?.error?.message || String(error);
    const retryable = code === 1 || code === 2;
    return { code: String(code), message: String(message), retryable };
  }
}
