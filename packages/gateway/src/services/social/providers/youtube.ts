import type {
  SocialProvider,
  ProviderCapability,
  SocialAccount,
  SocialPost,
  PublishResult,
  PlatformError,
} from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';
import { toWebByteStream } from '../../../utils/web-stream.js';

interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
}

export class YouTubeProvider implements SocialProvider {
  readonly platform = 'youtube';
  private config: YouTubeConfig;

  constructor() {
    this.config = {
      clientId: process.env.YOUTUBE_CLIENT_ID || '',
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    };
  }

  getCapabilities(): ProviderCapability {
    return {
      supportsScheduling: false, // YT API has publishAt, but we'll use execution task scheduling
      supportsVideo: true,
      supportsImages: false,
      supportsCancellation: true, // we can delete the video
      maxMediaCount: 1, // one video per post
    };
  }

  async connect(
    code: string,
    redirectUri: string
  ): Promise<
    Partial<SocialAccount> & { accessToken: string; refreshToken?: string; expiresAt?: Date }
  > {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to exchange code: ${err}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Get channel info to use as accountName/accountId
    const channelRes = await fetch(
      'https://youtube.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
      }
    );

    if (!channelRes.ok) {
      throw new Error(`Failed to fetch channel info: ${await channelRes.text()}`);
    }

    const channelData = (await channelRes.json()) as {
      items?: Array<{ id: string; snippet: { title: string } }>;
    };

    const channel = channelData?.items?.[0];
    if (!channel) {
      throw new Error('No YouTube channel found for this account.');
    }

    return {
      accountId: channel.id,
      accountName: channel.snippet.title,
      profileUrl: `https://youtube.com/channel/${channel.id}`,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async getConnectionStatus(accessToken: string): Promise<'active' | 'disconnected' | 'error'> {
    try {
      const res = await fetch(
        'https://youtube.googleapis.com/youtube/v3/channels?part=id&mine=true',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (res.status === 401) return 'disconnected';
      if (!res.ok) return 'error';
      return 'active';
    } catch {
      return 'error';
    }
  }

  async validateMedia(media: MediaAsset[]): Promise<{ valid: boolean; error?: string }> {
    if (media.length === 0) return { valid: false, error: 'YouTube requires exactly 1 video' };
    if (media.length > 1) return { valid: false, error: 'YouTube supports only 1 video per post' };

    const asset = media[0]!;
    if (asset.mediaType !== 'video')
      return { valid: false, error: 'YouTube requires a video asset' };

    return { valid: true };
  }

  async publish(post: SocialPost, accessToken: string): Promise<PublishResult> {
    try {
      const videoAsset = post.media[0]!;
      const metadata = post.metadata || {};
      const privacyStatus = (metadata.privacyStatus as string) || 'private';

      const { storageProvider } = await import('../../storage/index.js');
      const mediaStream = await storageProvider.download(videoAsset.storageKey);

      // 2. Start resumable upload session
      const snippet = {
        title: post.title || 'Untitled',
        description: post.text || '',
        tags: post.hashtags || [],
        categoryId: (metadata.categoryId as string) || '22', // 22 = People & Blogs
      };

      const initRes = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': videoAsset.mimeType || 'video/mp4',
            'X-Upload-Content-Length': videoAsset.sizeBytes ? videoAsset.sizeBytes.toString() : '',
          },
          body: JSON.stringify({
            snippet,
            status: { privacyStatus, selfDeclaredMadeForKids: false },
          }),
        }
      );

      if (!initRes.ok) {
        const errText = await initRes.text();
        return {
          status: 'failed',
          error: {
            code: 'INIT_UPLOAD_FAILED',
            message: `Failed to initialize upload: ${errText}`,
            retryable: true,
          },
        };
      }

      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) {
        return {
          status: 'failed',
          error: { code: 'NO_LOCATION', message: 'No upload location returned', retryable: true },
        };
      }

      // 3. Upload the actual video data
      const uploadOptions: RequestInit & { duplex: 'half' } = {
        method: 'PUT',
        headers: { 'Content-Type': videoAsset.mimeType || 'video/mp4' },
        body: toWebByteStream(mediaStream),
        duplex: 'half',
      };
      const uploadRes = await fetch(uploadUrl, uploadOptions);

      if (!uploadRes.ok) {
        // If upload fails in the middle or returns 500, we don't know if YT processed it
        if (uploadRes.status >= 500) {
          return {
            status: 'unknown',
            error: {
              code: 'UPLOAD_UNCERTAIN',
              message: `YouTube returned ${uploadRes.status}`,
              retryable: false,
            },
          };
        }
        const errText = await uploadRes.text();
        return {
          status: 'failed',
          error: { code: 'UPLOAD_FAILED', message: `Upload failed: ${errText}`, retryable: true },
        };
      }

      const resultData = (await uploadRes.json()) as { id: string };

      return {
        status: 'published',
        providerPostId: resultData.id,
        publishedUrl: `https://youtu.be/${resultData.id}`,
      };
    } catch (err: unknown) {
      return {
        status: 'unknown',
        error: this.normalizeError(err),
      };
    }
  }

  async checkPublishStatus(providerPostId: string, accessToken: string): Promise<PublishResult> {
    const res = await fetch(
      `https://youtube.googleapis.com/youtube/v3/videos?part=status&id=${providerPostId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok) {
      return {
        status: 'unknown',
        error: { code: 'STATUS_CHECK_FAILED', message: 'API error', retryable: true },
      };
    }

    const data = (await res.json()) as {
      items?: Array<{ status: { uploadStatus: string; failureReason?: string } }>;
    };

    if (!data?.items || data?.items.length === 0) {
      return {
        status: 'failed',
        error: { code: 'NOT_FOUND', message: 'Video not found', retryable: false },
      };
    }

    const uploadStatus = data.items[0]!.status.uploadStatus;
    if (uploadStatus === 'rejected' || uploadStatus === 'failed') {
      return {
        status: 'failed',
        providerPostId,
        error: {
          code: 'YT_PROCESSING_FAILED',
          message: data.items[0]!.status.failureReason || 'Failed',
          retryable: false,
        },
      };
    }

    return {
      status: 'published',
      providerPostId,
      publishedUrl: `https://youtu.be/${providerPostId}`,
    };
  }

  async cancelPublish(providerPostId: string, accessToken: string): Promise<boolean> {
    const res = await fetch(
      `https://youtube.googleapis.com/youtube/v3/videos?id=${providerPostId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    // 204 No Content is success for DELETE
    if (res.status === 204) return true;
    if (res.status === 404) return true; // Already gone

    return false;
  }

  normalizeError(error: unknown): PlatformError {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      code: 'YOUTUBE_ERROR',
      message: msg,
      retryable: msg.includes('network') || msg.includes('timeout'),
    };
  }
}
