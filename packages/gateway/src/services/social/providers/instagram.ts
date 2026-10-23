import type {
  SocialProvider,
  ProviderCapability,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';
import { MediaService } from '../../media/service.js';

export class InstagramProvider implements SocialProvider {
  readonly platform = 'instagram';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false,
      supportsVideo: true,
      supportsImages: true,
      supportsCancellation: false,
      maxMediaCount: 10,
    };
  }

  async connect(code: string, redirectUri: string) {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    );
    if (!tokenRes.ok) throw new Error('Failed to exchange code');
    const tokenData = (await tokenRes.json()) as any;

    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account,access_token&access_token=${tokenData.access_token}`
    );
    if (!pagesRes.ok) throw new Error('Failed to fetch pages');
    const pagesData = (await pagesRes.json()) as any;

    const pageWithIg = pagesData.data?.find((p: any) => p.instagram_business_account?.id);
    if (!pageWithIg) {
      throw new Error('No linked Instagram Business Account found');
    }

    const igAccountId = pageWithIg.instagram_business_account.id;

    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${igAccountId}?fields=id,username,name,profile_picture_url&access_token=${pageWithIg.access_token}`
    );
    if (!igRes.ok) throw new Error('Failed to fetch IG account details');
    const igData = (await igRes.json()) as any;

    return {
      accountId: igData.id,
      accountName: igData.username || igData.name,
      accessToken: pageWithIg.access_token,
    };
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
      return { valid: false, error: 'Instagram requires at least one image or video' };
    }
    if (media.length > 10) {
      return { valid: false, error: 'Maximum 10 media items allowed' };
    }
    for (const m of media) {
      if (m.mediaType !== 'image' && m.mediaType !== 'video') {
        return { valid: false, error: `Unsupported media type: ${m.mediaType}` };
      }
      if (m.mediaType === 'image') {
        if (m.sizeBytes > 8 * 1024 * 1024)
          return { valid: false, error: 'Image exceeds 8MB limit' };
        if (!['image/jpeg', 'image/png'].includes(m.mimeType))
          return { valid: false, error: 'Image must be JPEG or PNG' };
      } else {
        if (m.sizeBytes > 100 * 1024 * 1024)
          return { valid: false, error: 'Video exceeds 100MB limit' };
        if (m.mimeType !== 'video/mp4') return { valid: false, error: 'Video must be MP4' };
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

    const mediaService = new MediaService('system', post.workspaceId);

    if (post.media.length === 1) {
      const media = post.media[0]!;
      const mediaUrl = mediaService.createDeliveryUrl(media.id);

      const containerParams = new URLSearchParams({
        access_token: accessToken,
        caption: post.text || '',
      });

      if (media.mediaType === 'image') {
        containerParams.append('image_url', mediaUrl);
      } else {
        containerParams.append('video_url', mediaUrl);
        containerParams.append('media_type', 'REELS');
      }

      const igUserId = (post.metadata?.providerAccountId as string) || post.accountId;

      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media?${containerParams.toString()}`,
        { method: 'POST' }
      );

      const containerData = (await containerRes.json()) as any;
      if (!containerRes.ok) {
        return { status: 'failed', error: this.normalizeError(containerData) };
      }

      return {
        status: 'publishing',
        providerPostId: containerData.id,
      };
    } else {
      const itemContainerIds = [];
      for (const m of post.media) {
        const mUrl = mediaService.createDeliveryUrl(m.id);
        const p = new URLSearchParams({
          access_token: accessToken,
          is_carousel_item: 'true',
        });
        if (m.mediaType === 'image') p.append('image_url', mUrl);
        else p.append('video_url', mUrl);

        const res = await fetch(
          `https://graph.facebook.com/v19.0/${post.accountId}/media?${p.toString()}`,
          { method: 'POST' }
        );
        const d = (await res.json()) as any;
        if (!res.ok) return { status: 'failed', error: this.normalizeError(d) };
        itemContainerIds.push(d.id);
      }

      const carouselP = new URLSearchParams({
        access_token: accessToken,
        caption: post.text || '',
        media_type: 'CAROUSEL',
        children: itemContainerIds.join(','),
      });

      const carouselRes = await fetch(
        `https://graph.facebook.com/v19.0/${post.accountId}/media?${carouselP.toString()}`,
        { method: 'POST' }
      );
      const carouselData = (await carouselRes.json()) as any;
      if (!carouselRes.ok) return { status: 'failed', error: this.normalizeError(carouselData) };

      return { status: 'publishing', providerPostId: carouselData.id };
    }
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    const statusRes = await fetch(
      `https://graph.facebook.com/v19.0/${providerPostId}?fields=status_code,id&access_token=${accessToken}`
    );
    if (!statusRes.ok) {
      return { status: 'unknown', error: this.normalizeError(await statusRes.json()) };
    }

    const statusData = (await statusRes.json()) as any;
    if (statusData.status_code === 'IN_PROGRESS') {
      return { status: 'publishing', providerPostId };
    } else if (statusData.status_code === 'ERROR') {
      return {
        status: 'failed',
        providerPostId,
        error: {
          code: 'PROCESSING_ERROR',
          message: 'Container processing failed',
          retryable: false,
        },
      };
    } else if (statusData.status_code === 'PUBLISHED') {
      return { status: 'published', providerPostId };
    } else if (statusData.status_code === 'FINISHED') {
      const ownerRes = await fetch(
        `https://graph.facebook.com/v19.0/${providerPostId}?fields=owner&access_token=${accessToken}`
      );
      const ownerData = (await ownerRes.json()) as any;
      const igUserId = ownerData.owner?.id;

      if (!igUserId)
        return {
          status: 'unknown',
          error: { code: 'NO_OWNER', message: 'Could not find owner', retryable: false },
        };

      const pubRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${providerPostId}&access_token=${accessToken}`,
        { method: 'POST' }
      );
      const pubData = (await pubRes.json()) as any;
      if (!pubRes.ok)
        return { status: 'failed', providerPostId, error: this.normalizeError(pubData) };

      return {
        status: 'published',
        providerPostId: pubData.id,
        publishedUrl: `https://instagram.com/p/${pubData.id}`,
      };
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
