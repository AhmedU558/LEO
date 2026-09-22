import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeProvider } from './providers/youtube.js';
import type { SocialPost, MediaAsset } from '@ownpilot/core/social';

describe('YouTubeProvider', () => {
  let provider: YouTubeProvider;

  beforeEach(() => {
    provider = new YouTubeProvider();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('connect: exchanges code for tokens and fetches channel', async () => {
    const fetchMock = vi.mocked(fetch);

    // Token response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }),
    } as any);

    // Channel response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ id: 'ch1', snippet: { title: 'My Channel' } }] }),
    } as any);

    const result = await provider.connect('code123', 'http://localhost');
    expect(result.accountId).toBe('ch1');
    expect(result.accountName).toBe('My Channel');
    expect(result.accessToken).toBe('acc');
    expect(result.refreshToken).toBe('ref');
  });

  it('validateMedia: rejects missing video', async () => {
    const res = await provider.validateMedia([]);
    expect(res.valid).toBe(false);
  });

  it('validateMedia: rejects multiple videos', async () => {
    const media: MediaAsset[] = [
      { id: '1', url: 'x', type: 'video', mimeType: 'video/mp4', sizeBytes: 1 },
      { id: '2', url: 'y', type: 'video', mimeType: 'video/mp4', sizeBytes: 1 },
    ];
    const res = await provider.validateMedia(media);
    expect(res.valid).toBe(false);
  });

  it('validateMedia: accepts one video', async () => {
    const media: MediaAsset[] = [
      { id: '1', url: 'x', type: 'video', mimeType: 'video/mp4', sizeBytes: 1 },
    ];
    const res = await provider.validateMedia(media);
    expect(res.valid).toBe(true);
  });

  it('publish: uploads video using resumable upload', async () => {
    const fetchMock = vi.mocked(fetch);

    // 1. Download media
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: 'media_stream',
    } as any);

    // 2. Init upload
    const mockHeaders = new Headers();
    mockHeaders.set('Location', 'https://upload.url');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: mockHeaders,
    } as any);

    // 3. Upload chunks
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'vid123' }),
    } as any);

    const post: SocialPost = {
      id: 'p1',
      userId: 'u1',
      workspaceId: 'w1',
      accountId: 'a1',
      platform: 'youtube',
      text: 'desc',
      hashtags: ['tag'],
      metadata: {},
      createdAt: '',
      updatedAt: '',
      media: [
        { id: '1', url: 'https://video.url', type: 'video', mimeType: 'video/mp4', sizeBytes: 100 },
      ],
    };

    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('published');
    expect(res.providerPostId).toBe('vid123');
    expect(res.publishedUrl).toBe('https://youtu.be/vid123');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"privacyStatus":"private"'); // default privacy
  });

  it('publish: returns unknown if upload returns 500', async () => {
    const fetchMock = vi.mocked(fetch);

    // 1. Download media
    fetchMock.mockResolvedValueOnce({
      ok: true,
      body: 'media_stream',
    } as any);

    // 2. Init upload
    const mockHeaders = new Headers();
    mockHeaders.set('Location', 'https://upload.url');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: mockHeaders,
    } as any);

    // 3. Upload chunks (500 error)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    const post: SocialPost = {
      id: 'p1',
      userId: 'u1',
      workspaceId: 'w1',
      accountId: 'a1',
      platform: 'youtube',
      text: 'desc',
      hashtags: ['tag'],
      metadata: {},
      createdAt: '',
      updatedAt: '',
      media: [
        { id: '1', url: 'https://video.url', type: 'video', mimeType: 'video/mp4', sizeBytes: 100 },
      ],
    };

    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('unknown');
    expect(res.error?.code).toBe('UPLOAD_UNCERTAIN');
  });

  it('checkPublishStatus: verifies status', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [{ status: { uploadStatus: 'processed' } }] }),
    } as any);

    const res = await provider.checkPublishStatus('vid123', 'token');
    expect(res.status).toBe('published');
    expect(res.providerPostId).toBe('vid123');
  });

  it('cancelPublish: calls DELETE', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
    } as any);

    const res = await provider.cancelPublish('vid123', 'token');
    expect(res).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
