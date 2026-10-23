import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TikTokProvider } from './tiktok.js';

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    if (url.includes('oauth/token')) {
      return {
        ok: true,
        json: async () => ({
          access_token: 'mock_token',
          refresh_token: 'mock_ref',
          open_id: 'tiktok_user',
        }),
      };
    }
    if (url.includes('user/info')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            user: {
              open_id: 'tiktok_user',
              display_name: 'TikTok User Test',
              avatar_url: 'http://img',
            },
          },
          error: { code: 'ok' },
        }),
      };
    }
    if (url.includes('post/publish/video/init')) {
      return {
        ok: true,
        json: async () => ({ data: { publish_id: 'pub_123' }, error: { code: 'ok' } }),
      };
    }
    if (url.includes('post/publish/status/fetch')) {
      return {
        ok: true,
        json: async () => ({
          data: { status: 'PUBLISH_COMPLETE', public_url: 'http://tiktok.com/v' },
          error: { code: 'ok' },
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  })
);

describe('TikTokProvider', () => {
  let provider: TikTokProvider;

  beforeEach(() => {
    provider = new TikTokProvider();
    process.env.APP_SECRET = 'test_secret';
    vi.clearAllMocks();
  });

  it('connect: exchanges code and fetches identity', async () => {
    const res = await provider.connect('code', 'uri');
    expect(res.accountId).toBe('tiktok_user');
    expect(res.accountName).toBe('TikTok User Test');
  });

  it('validateMedia: rejects empty', async () => {
    const res = await provider.validateMedia([]);
    expect(res.valid).toBe(false);
  });

  it('validateMedia: rejects image', async () => {
    const res = await provider.validateMedia([
      {
        id: 'm1',
        userId: 'u',
        workspaceId: 'w',
        storageKey: 'k',
        checksum: 'c',
        mediaType: 'image',
        status: 'READY',
        filename: '1.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    expect(res.valid).toBe(false);
  });

  it('validateMedia: accepts video', async () => {
    const res = await provider.validateMedia([
      {
        id: 'm1',
        userId: 'u',
        workspaceId: 'w',
        storageKey: 'k',
        checksum: 'c',
        mediaType: 'video',
        status: 'READY',
        filename: '1.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    expect(res.valid).toBe(true);
  });

  it('publish: single video calls init and returns publishing', async () => {
    const post = {
      id: 'p1',
      userId: 'u',
      workspaceId: 'w',
      accountId: 't1',
      platform: 'tiktok' as const,
      text: 'hi',
      hashtags: [],
      metadata: {},
      media: [
        {
          id: 'm1',
          userId: 'u',
          workspaceId: 'w',
          storageKey: 'k',
          checksum: 'c',
          mediaType: 'video' as const,
          status: 'READY' as const,
          filename: '1.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 10,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('publishing');
    expect(res.providerPostId).toBe('pub_123');
  });

  it('checkPublishStatus: handles complete', async () => {
    const res = await provider.checkPublishStatus('v1', 'tok');
    expect(res.status).toBe('published');
    expect(res.publishedUrl).toBe('http://tiktok.com/v');
  });
});
