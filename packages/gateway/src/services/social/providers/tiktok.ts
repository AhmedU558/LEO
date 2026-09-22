import type {
  SocialProvider,
  ProviderCapability,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';
import { MediaService } from '../../media/service.js';

export class TikTokProvider implements SocialProvider {
  readonly platform = 'tiktok';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false,
      supportsVideo: true,
      supportsImages: false,
      supportsCancellation: false,
      maxMediaCount: 1,
    };
  }

  async connect(code: string, redirectUri: string) {
    const p = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY || '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: p.toString(),
    });

    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(`Failed to exchange code: ${tokenData.error || tokenData.message}`);
    }

    const { access_token, refresh_token } = tokenData;

    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const userData = await userRes.json() as any;
    if (!userRes.ok || userData.error?.code !== 'ok') {
      throw new Error(`Failed to fetch user: ${userData.error?.message || 'unknown'}`);
    }

    return {
      accountId: userData.data.user.open_id,
      accountName: userData.data.user.display_name,
      accessToken: access_token,
      refreshToken: refresh_token,
    };
  }

  async getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'> {
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.ok ? 'active' : 'disconnected';
    } catch {
      return 'error';
    }
  }

  async validateMedia(media: MediaAsset[]): Promise<{ valid: boolean; error?: string }> {
    if (!media || media.length === 0) {
      return { valid: false, error: 'TikTok requires a video' };
    }
    if (media.length > 1) {
      return { valid: false, error: 'Maximum 1 video supported' };
    }
    const m = media[0]!;
    if (m.mediaType !== 'video') {
      return { valid: false, error: 'Only video media is supported by this provider' };
    }
    if (m.sizeBytes > 4 * 1024 * 1024 * 1024) {
      return { valid: false, error: 'Video exceeds 4GB limit' };
    }
    if (!['video/mp4', 'video/webm'].includes(m.mimeType)) {
      return { valid: false, error: 'Video must be MP4 or WEBM' };
    }
    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    if (!post.media || post.media.length === 0) {
      return { status: 'failed', error: { code: 'INVALID_INPUT', message: 'Media required', retryable: false } };
    }

    const media = post.media[0]!;
    const mediaService = new MediaService('system', post.workspaceId);
    const mediaUrl = mediaService.createDeliveryUrl(media.id);

    const body = {
      post_info: {
        title: post.text || '',
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: mediaUrl,
      },
    };

    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!res.ok || data.error?.code !== 'ok') {
      return { status: 'failed', error: this.normalizeError(data) };
    }

    const publishId = data.data?.publish_id;
    if (!publishId) {
      return { status: 'unknown', error: { code: 'NO_PUBLISH_ID', message: 'No publish ID returned', retryable: false } };
    }

    return { status: 'publishing', providerPostId: publishId };
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    const body = { publish_id: providerPostId };
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;
    if (!res.ok || data.error?.code !== 'ok') {
      return { status: 'unknown', error: this.normalizeError(data) };
    }

    const status = data.data?.status;
    if (status === 'PUBLISH_SUCCESS' || status === 'PUBLISH_COMPLETE') {
      return { status: 'published', providerPostId, publishedUrl: data.data?.public_url };
    } else if (status === 'PUBLISH_PROCESSING') {
      return { status: 'publishing', providerPostId };
    } else if (status === 'PUBLISH_FAILED') {
      return { status: 'failed', providerPostId, error: { code: 'PUBLISH_FAILED', message: data.data?.fail_reason || 'Publish failed', retryable: false } };
    }

    return { status: 'unknown' };
  }

  async cancelPublish(_providerPostId: string, _accessToken: string): Promise<boolean> {
    return false;
  }

  normalizeError(error: unknown): PlatformError {
    const err = error as Record<string, any>;
    const code = err?.error?.code || 'UNKNOWN';
    const message = err?.error?.message || String(error);
    const retryable = code === 1 || code === 2;
    return { code: String(code), message: String(message), retryable };
  }
}



