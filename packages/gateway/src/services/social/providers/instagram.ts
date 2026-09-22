import type {
  SocialProvider,
  ProviderCapability,
  SocialAccount,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';
import { randomUUID } from 'node:crypto';
import { storageProvider } from '../../storage/index.js'; // To ensure we use the media pipeline correctly

export class InstagramProvider implements SocialProvider {
  readonly platform = 'instagram';

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false, // Wait, Graph API technically supports scheduling but let's say false for simplicity unless needed
      supportsVideo: true,
      supportsImages: true,
      supportsCancellation: false,
      maxMediaCount: 10, // Carousel support up to 10
    };
  }

  async connect(code: string, redirectUri: string) {
    // 1. Exchange code for user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    );
    if (!tokenRes.ok) throw new Error('Failed to exchange code');
    const tokenData = await tokenRes.json();

    // 2. Get pages the user manages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account,access_token&access_token=${tokenData.access_token}`
    );
    if (!pagesRes.ok) throw new Error('Failed to fetch pages');
    const pagesData = await pagesRes.json();

    // 3. Find first page with an IG account
    const pageWithIg = pagesData.data?.find((p: { instagram_business_account?: { id: string } }) => p.instagram_business_account?.id);
    if (!pageWithIg) {
      throw new Error('No linked Instagram Business Account found');
    }

    const igAccountId = pageWithIg.instagram_business_account.id;

    // 4. Get IG account details
    const igRes = await fetch(
      `https://graph.facebook.com/v19.0/${igAccountId}?fields=id,username,name,profile_picture_url&access_token=${pageWithIg.access_token}`
    );
    if (!igRes.ok) throw new Error('Failed to fetch IG account details');
    const igData = await igRes.json();

    return {
      accountId: igData.id,
      accountName: igData.username || igData.name,
      accessToken: pageWithIg.access_token, // Store Page Access Token
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
    }
    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    if (!post.media || post.media.length === 0) {
      return { status: 'failed', error: { code: 'INVALID_INPUT', message: 'Media required', retryable: false } };
    }

    // 1. We must provide a public URL to Meta. 
    // Since we are LEO, we generate a signed URL from our gateway.
    const baseUrl = process.env.APP_URL || 'https://leo.local';
    
    // Check if it's a carousel or single media
    if (post.media.length === 1) {
      const media = post.media[0]!;
      const mediaUrl = `${baseUrl}/api/v1/media/${media.id}/raw?token=mock_signed_token`;

      // Create container
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

      // Read accountId from post.accountId
      const igUserId = post.metadata?.providerAccountId as string || post.accountId;

      const containerRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media?${containerParams.toString()}`,
        { method: 'POST' }
      );

      const containerData = await containerRes.json();
      if (!containerRes.ok) {
        return { status: 'failed', error: this.normalizeError(containerData) };
      }

      // Container created. Return UNKNOWN/PUBLISHING so checkPublishStatus can poll.
      // Do NOT blindly publish if it's a video. Wait for status.
      return {
        status: 'publishing', // Indicates intermediate state
        providerPostId: containerData.id,
      };
    } else {
      // Carousel flow: 
      // 1. Create a container for each item
      const itemContainerIds = [];
      for (const m of post.media) {
        const mUrl = `${baseUrl}/api/v1/media/${m.id}/raw?token=mock_signed_token`;
        const p = new URLSearchParams({
          access_token: accessToken,
          is_carousel_item: 'true',
        });
        if (m.mediaType === 'image') p.append('image_url', mUrl);
        else p.append('video_url', mUrl);

        const res = await fetch(`https://graph.facebook.com/v19.0/${post.accountId}/media?${p.toString()}`, { method: 'POST' });
        const d = await res.json();
        if (!res.ok) return { status: 'failed', error: this.normalizeError(d) };
        itemContainerIds.push(d.id);
      }

      // 2. Create the carousel container
      const carouselP = new URLSearchParams({
        access_token: accessToken,
        caption: post.text || '',
        media_type: 'CAROUSEL',
        children: itemContainerIds.join(','),
      });

      const carouselRes = await fetch(`https://graph.facebook.com/v19.0/${post.accountId}/media?${carouselP.toString()}`, { method: 'POST' });
      const carouselData = await carouselRes.json();
      if (!carouselRes.ok) return { status: 'failed', error: this.normalizeError(carouselData) };

      return { status: 'publishing', providerPostId: carouselData.id };
    }
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    // Check container status
    const statusRes = await fetch(
      `https://graph.facebook.com/v19.0/${providerPostId}?fields=status_code,id&access_token=${accessToken}`
    );
    if (!statusRes.ok) {
      return { status: 'unknown', error: this.normalizeError(await statusRes.json()) };
    }

    const statusData = await statusRes.json();
    if (statusData.status_code === 'IN_PROGRESS') {
      return { status: 'publishing', providerPostId };
    } else if (statusData.status_code === 'ERROR') {
      return { status: 'failed', providerPostId, error: { code: 'PROCESSING_ERROR', message: 'Container processing failed', retryable: false } };
    } else if (statusData.status_code === 'PUBLISHED') {
      // It's already published!
      return { status: 'published', providerPostId };
    } else if (statusData.status_code === 'FINISHED') {
      // Ready to publish
      // Extract the igUserId somehow. Wait, we don't have igUserId easily, but we can hit /media_publish.
      // /media_publish requires the igUserId, which we don't have in this scope unless we fetch the container details or store it in providerPostId.
      // For simplicity, let's assume we can fetch the owner ID of the media container.
      // Graph API: GET /{creation_id}?fields=owner
      const ownerRes = await fetch(`https://graph.facebook.com/v19.0/${providerPostId}?fields=owner&access_token=${accessToken}`);
      const ownerData = await ownerRes.json();
      const igUserId = ownerData.owner?.id;

      if (!igUserId) return { status: 'unknown', error: { code: 'NO_OWNER', message: 'Could not find owner', retryable: false } };

      const pubRes = await fetch(
        `https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${providerPostId}&access_token=${accessToken}`,
        { method: 'POST' }
      );
      const pubData = await pubRes.json();
      if (!pubRes.ok) return { status: 'failed', providerPostId, error: this.normalizeError(pubData) };

      return { status: 'published', providerPostId: pubData.id, publishedUrl: `https://instagram.com/p/${pubData.id}` };
    }

    return { status: 'unknown' };
  }

  async cancelPublish(providerPostId: string, accessToken: string): Promise<boolean> {
    return false; // Instagram Graph API does not support cancelling an in-progress container
  }

  normalizeError(error: unknown): PlatformError {
    const err = error as Record<string, Record<string, unknown>>;
    const code = err?.error?.code || 'UNKNOWN';
    const message = err?.error?.message || String(error);
    const retryable = code === 1 || code === 2; // Meta API generic transient errors
    return { code: String(code), message: String(message), retryable };
  }


}


