import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from './service.js';
import { storageProvider } from '../storage/index.js';
import { Readable } from 'node:stream';

vi.mock('../../db/repositories/media.js', () => ({
  createMediaRepository: vi.fn(() => ({
    insert: vi.fn(),
    list: vi.fn(() => []),
    get: vi.fn(() => ({})),
    deleteAsset: vi.fn(),
  })),
}));

vi.mock('../storage/index.js', () => ({
  storageProvider: {
    upload: vi.fn(async (workspaceId, filename, stream) => {
      for await (const chunk of stream) {}
      return 'test_key';
    }),
    download: vi.fn(),
    delete: vi.fn(),
    init: vi.fn(),
  },
}));

describe('MediaService', () => {
  let service: MediaService;

  beforeEach(() => {
    service = new MediaService('user1', 'ws1');
    vi.clearAllMocks();
    process.env.APP_SECRET = 'test_secret';
    process.env.APP_URL = 'http://test.local';
  });

  it('rejects unsupported mime types', async () => {
    const stream = Readable.from(['data']);
    await expect(service.uploadMedia('test.txt', 'text/plain', stream)).rejects.toThrow(
      /Unsupported MIME type/
    );
  });

  it('uploads video and stores asset', async () => {
    const stream = Readable.from(['video_data']);
    const asset = await service.uploadMedia('video.mp4', 'video/mp4', stream);

    expect(asset.mediaType).toBe('video');
    expect(asset.mimeType).toBe('video/mp4');
    expect(asset.storageKey).toBe('test_key');
    expect(asset.status).toBe('READY');
    expect(storageProvider.upload).toHaveBeenCalled();
  });

  it('creates valid delivery URLs', () => {
    const url = service.createDeliveryUrl('asset_123', 1000);
    expect(url).toContain('http://test.local/api/v1/media/delivery/ws1/asset_123');
    expect(url).toContain('signature=');
    expect(url).toContain('expiresAt=');
  });

  it('validates authentic signatures', () => {
    const url = service.createDeliveryUrl('asset_123', 1000);
    const urlObj = new URL(url);
    const expiresAt = parseInt(urlObj.searchParams.get('expiresAt')!, 10);
    const signature = urlObj.searchParams.get('signature')!;

    const isValid = MediaService.validateDeliverySignature('ws1', 'asset_123', expiresAt, signature);
    expect(isValid).toBe(true);
  });

  it('rejects expired signatures', () => {
    const url = service.createDeliveryUrl('asset_123', -1000); // Already expired
    const urlObj = new URL(url);
    const expiresAt = parseInt(urlObj.searchParams.get('expiresAt')!, 10);
    const signature = urlObj.searchParams.get('signature')!;

    const isValid = MediaService.validateDeliverySignature('ws1', 'asset_123', expiresAt, signature);
    expect(isValid).toBe(false); // Should be false because Date.now() > expiresAt
  });

  it('rejects tampered signatures or wrong workspace isolation', () => {
    const url = service.createDeliveryUrl('asset_123', 10000);
    const urlObj = new URL(url);
    const expiresAt = parseInt(urlObj.searchParams.get('expiresAt')!, 10);
    const signature = urlObj.searchParams.get('signature')!;

    const isValid = MediaService.validateDeliverySignature('ws2', 'asset_123', expiresAt, signature);
    expect(isValid).toBe(false);
  });
});
