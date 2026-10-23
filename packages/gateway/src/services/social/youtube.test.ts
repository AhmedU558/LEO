import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YouTubeProvider } from './providers/youtube.js';
import type { SocialPost } from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = vi.hoisted(() => ({ storage: '' }));
vi.mock('../storage/index.js', async () => {
  const { LocalStorageProvider } = await import('../storage/local-provider.js');
  return {
    get storageProvider() {
      return new LocalStorageProvider(fixture.storage);
    },
  };
});

describe('YouTubeProvider', () => {
  let provider: YouTubeProvider;
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'leo-youtube-'));
    fixture.storage = join(fixtureRoot, '.ownpilot', 'storage');
    await mkdir(fixture.storage, { recursive: true });
    await writeFile(join(fixture.storage, 'k1'), 'fake_data');
    provider = new YouTubeProvider();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it('connect: exchanges code for tokens and fetches channel', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 }),
    } as any);
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

  it('validateMedia: rejects non-video', async () => {
    const res = await provider.validateMedia([{ id: '1', mediaType: 'image' } as MediaAsset]);
    expect(res.valid).toBe(false);
  });

  it('publish: uploads video using resumable upload', async () => {
    const fetchMock = vi.mocked(fetch);

    const mockHeaders = new Headers();
    mockHeaders.set('Location', 'https://upload.url');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: mockHeaders,
    } as any);

    fetchMock.mockImplementationOnce(async (_url, init) => {
      expect(await new Response(init?.body).text()).toBe('fake_data');
      return new Response(JSON.stringify({ id: 'vid123' }));
    });

    const post: SocialPost = {
      id: 'p1',
      userId: 'u1',
      workspaceId: 'w1',
      accountId: 'a1',
      platform: 'youtube',
      text: 'desc',
      hashtags: ['tag'],
      metadata: {},
      media: [
        { id: 'm1', storageKey: 'k1', mediaType: 'video', mimeType: 'video/mp4' } as MediaAsset,
      ],
    };

    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('published');
    expect(res.providerPostId).toBe('vid123');
    expect(res.publishedUrl).toBe('https://youtu.be/vid123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('publish: returns unknown if upload returns 500', async () => {
    const fetchMock = vi.mocked(fetch);

    const mockHeaders = new Headers();
    mockHeaders.set('Location', 'https://upload.url');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: mockHeaders,
    } as any);

    fetchMock.mockImplementationOnce(async (_url, init) => {
      expect(await new Response(init?.body).text()).toBe('fake_data');
      return new Response('Internal Server Error', { status: 500 });
    });

    const post: SocialPost = {
      id: 'p1',
      userId: 'u1',
      workspaceId: 'w1',
      accountId: 'a1',
      platform: 'youtube',
      text: 'desc',
      hashtags: ['tag'],
      metadata: {},
      media: [
        { id: 'm1', storageKey: 'k1', mediaType: 'video', mimeType: 'video/mp4' } as MediaAsset,
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
