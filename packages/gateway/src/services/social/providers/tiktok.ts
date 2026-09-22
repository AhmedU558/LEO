import type {
  SocialProvider,
  ProviderCapability,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';

export class TikTokProvider implements SocialProvider {
  readonly platform = 'tiktok';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false, // TikTok Direct Post API doesn't support scheduling (only Drafts or immediate publish)
      supportsVideo: true,
      supportsImages: false, // Currently the TikTok Content Posting API is for Video (there is a Photo Carousel API but let's stick to video for standard direct post)
      supportsCancellation: false,
      maxMediaCount: 1, // Single video
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

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(`Failed to exchange code: ${tokenData.error || tokenData.message}`);
    }

    const { access_token, refresh_token, open_id } = tokenData;

    // Fetch user info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const userData = await userRes.json();
    if (!userRes.ok || userData.error?.code !== 'ok') {
      throw new Error(`Failed to fetch user info: ${userData.error?.message}`);
    }

    const info = userData.data?.user || {};

    return {
      accountId: open_id, // For TikTok, the unique identifier per user per app is usually open_id
      accountName: info.display_name || 'TikTok User',
      profileUrl: info.avatar_url, // TikTok doesn't easily return the profile URL, avatar_url is just image
      accessToken: access_token,
      refreshToken: refresh_token,
    };
  }

  async getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'> {
    try {
      const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok || data.error?.code !== 'ok') return 'disconnected';
      return 'active';
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
    if (media[0]!.mediaType !== 'video') {
      return { valid: false, error: 'Only video media is supported by this provider' };
    }
    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    if (!post.media || post.media.length === 0) {
      return { status: 'failed', error: { code: 'INVALID_INPUT', message: 'Media required', retryable: false } };
    }

    const baseUrl = process.env.APP_URL || 'https://leo.local';
    const media = post.media[0]!;
    const mediaUrl = `${baseUrl}/api/v1/media/${media.id}/raw?token=mock_signed_token`;

    const body = {
      post_info: {
        title: post.text || '', // title acts as caption
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

    const data = await res.json();
    if (!res.ok || data.error?.code !== 'ok') {
      return { status: 'failed', error: this.normalizeError(data) };
    }

    // data.data.publish_id is what we need to poll
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

    const data = await res.json();
    if (!res.ok || data.error?.code !== 'ok') {
      return { status: 'unknown', error: this.normalizeError(data) };
    }

    const status = data.data?.status;
    if (status === 'PUBLISH_COMPLETE') {
      const publicUrl = data.data?.public_url;
      return { status: 'published', providerPostId, publishedUrl: publicUrl };
    } else if (status === 'FAILED') {
      const failReason = data.data?.fail_reason || 'Unknown processing error';
      return { status: 'failed', providerPostId, error: { code: 'PROCESSING_ERROR', message: failReason, retryable: false } };
    } else if (status === 'PROCESSING_DOWNLOAD' || status === 'PROCESSING_UPLOAD') {
      return { status: 'publishing', providerPostId };
    }

    return { status: 'unknown' };
  }

  async cancelPublish(_providerPostId: string, _accessToken: string): Promise<boolean> {
    return false; // TikTok API does not support cancelling an already initialized PULL_FROM_URL publish
  }

  normalizeError(error: unknown): PlatformError {
    const err = error as Record<string, Record<string, unknown>>;
    const code = String(err?.error?.code || 'UNKNOWN');
    const message = String(err?.error?.message || String(error));
    // TikTok returns "ok" as code when successful, but error codes are strings (e.g., 'invalid_param', 'spam_risk')
    // Transient errors typically include internal server error
    const retryable = code === 'internal_error' || code === 'rate_limit_exceeded';
    return { code, message, retryable };
  }
}


