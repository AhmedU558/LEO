import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InstagramProvider } from './instagram.js';

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string) => {
    if (url.includes('oauth/access_token')) {
      return { ok: true, json: async () => ({ access_token: 'mock_user_token' }) };
    }
    if (url.includes('/me/accounts')) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'page1',
              name: 'Test Page',
              access_token: 'mock_page_token',
              instagram_business_account: { id: 'ig1' },
            },
          ],
        }),
      };
    }
    if (url.includes('ig1?fields=')) {
      return { ok: true, json: async () => ({ id: 'ig1', username: 'testig' }) };
    }
    if (url.includes('/media?') && url.includes('POST')) {
      return { ok: true, json: async () => ({ id: 'container_1' }) };
    }
    if (url.includes('status_code')) {
      return { ok: true, json: async () => ({ status_code: 'IN_PROGRESS' }) };
    }
    return { ok: true, json: async () => ({}) };
  })
);

describe('InstagramProvider', () => {
  let provider: InstagramProvider;

  beforeEach(() => {
    provider = new InstagramProvider();
    vi.clearAllMocks();
  });

  it('connect: exchanges code and finds IG account', async () => {
    const res = await provider.connect('code123', 'http://cb');
    expect(res.accountId).toBe('ig1');
    expect(res.accountName).toBe('testig');
    expect(res.accessToken).toBe('mock_page_token');
  });

  it('validateMedia: rejects empty media', async () => {
    const res = await provider.validateMedia([]);
    expect(res.valid).toBe(false);
  });

  it('validateMedia: accepts images and videos', async () => {
    const res = await provider.validateMedia([
      { id: '1', userId: 'u', workspaceId: 'w', storageKey: 'k', checksum: 'c', mediaType: 'image', status: 'READY', filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 10, createdAt: new Date(), updatedAt: new Date() },
    ]);
    expect(res.valid).toBe(true);
  });
  it('publish: single image creates immediate container', async () => {
    const post = {
      id: 'p1', userId: 'u', workspaceId: 'w', accountId: 'ig1', platform: 'instagram' , text: 'hi', hashtags: [], metadata: {},
      media: [{ id: 'm1', userId: 'u', workspaceId: 'w', storageKey: 'k', checksum: 'c', mediaType: 'image' , status: 'READY' , filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 10, createdAt: new Date(), updatedAt: new Date() }]
    };
    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('publishing');
    expect(res.providerPostId).toBe('container_1');
  });

  it('publish: carousel creates children and parent container', async () => {
    const post = {
      id: 'p1', userId: 'u', workspaceId: 'w', accountId: 'ig1', platform: 'instagram' , text: 'hi', hashtags: [], metadata: {},
      media: [
        { id: 'm1', userId: 'u', workspaceId: 'w', storageKey: 'k1', checksum: 'c1', mediaType: 'image' , status: 'READY' , filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 10, createdAt: new Date(), updatedAt: new Date() },
        { id: 'm2', userId: 'u', workspaceId: 'w', storageKey: 'k2', checksum: 'c2', mediaType: 'video' , status: 'READY' , filename: '2.mp4', mimeType: 'video/mp4', sizeBytes: 10, createdAt: new Date(), updatedAt: new Date() }
      ]
    };
    const res = await provider.publish(post, 'token');
    expect(res.status).toBe('publishing');
    expect(res.providerPostId).toBe('container_1'); // our mock returns this
  });

  it('checkPublishStatus: handles IN_PROGRESS', async () => {
    const res = await provider.checkPublishStatus('cid_prog', 'tok');
    expect(res.status).toBe('publishing');
  });

  it('checkPublishStatus: handles FINISHED and publishes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('status_code')) return { ok: true, json: async () => ({ status_code: 'FINISHED' }) };
      if (url.includes('fields=owner')) return { ok: true, json: async () => ({ owner: { id: 'ig1' } }) };
      if (url.includes('media_publish')) return { ok: true, json: async () => ({ id: 'pub1' }) };
      return { ok: true, json: async () => ({}) };
    }));
    
    const res = await provider.checkPublishStatus('cid_fin', 'tok');
    expect(res.status).toBe('published');
    expect(res.providerPostId).toBe('pub1');
    expect(res.publishedUrl).toContain('instagram.com/p/pub1');
  });

});
