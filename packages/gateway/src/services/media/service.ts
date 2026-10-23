import { randomUUID, createHash, createHmac } from 'node:crypto';
import type { MediaAsset, MediaType } from '@ownpilot/core/media';
import { storageProvider } from '../storage/index.js';
import { createMediaRepository } from '../../db/repositories/media.js';
import type { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { getLog } from '../log.js';

const log = getLog('MediaService');

export class MediaService {
  constructor(
    private userId: string,
    private workspaceId: string
  ) {}

  async uploadMedia(filename: string, mimeType: string, stream: Readable): Promise<MediaAsset> {
    let mediaType: MediaType = 'unknown';
    if (mimeType.startsWith('video/')) mediaType = 'video';
    else if (mimeType.startsWith('image/')) mediaType = 'image';
    else if (mimeType.startsWith('audio/')) mediaType = 'audio';

    if (mediaType === 'unknown') {
      throw new Error(`Unsupported MIME type: ${mimeType}`);
    }

    const id = `media_${randomUUID()}`;

    // Create a pass-through to calculate checksum and size on the fly
    const hash = createHash('sha256');
    let sizeBytes = 0;

    const monitorStream = new PassThrough();
    monitorStream.on('data', (chunk) => {
      hash.update(chunk);
      sizeBytes += chunk.length;
      if (sizeBytes > 1024 * 1024 * 500) {
        // 500MB limit
        monitorStream.destroy(new Error('Media exceeds 500MB limit'));
      }
    });

    // Pipe the input stream through the monitor, then to storage
    stream.pipe(monitorStream);

    try {
      const storageKey = await storageProvider.upload(
        this.workspaceId,
        filename,
        monitorStream,
        mimeType
      );

      const checksum = hash.digest('hex');

      const asset: MediaAsset = {
        id,
        userId: this.userId,
        workspaceId: this.workspaceId,
        filename,
        mimeType,
        mediaType,
        sizeBytes,
        storageKey,
        checksum,
        metadata: {},
        status: 'READY',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const repo = createMediaRepository();
      await repo.insert(asset);
      return asset;
    } catch (e: unknown) {
      log.error(`Upload failed: ${(e as Error).message}`);
      throw new Error(`Upload failed: ${(e as Error).message}`);
    }
  }

  async listMedia(): Promise<MediaAsset[]> {
    const repo = createMediaRepository();
    return repo.list(this.workspaceId, this.userId);
  }

  async getMedia(id: string): Promise<MediaAsset | undefined> {
    const repo = createMediaRepository();
    return repo.get(id, this.workspaceId, this.userId);
  }

  async deleteMedia(id: string): Promise<void> {
    const asset = await this.getMedia(id);
    if (!asset) throw new Error('Not found');

    await storageProvider.delete(asset.storageKey);
    const repo = createMediaRepository();
    await repo.deleteAsset(id);
  }

  createDeliveryUrl(assetId: string, ttlMs: number = 24 * 60 * 60 * 1000): string {
    const expiresAt = Date.now() + ttlMs;
    const data = `${this.workspaceId}:${assetId}:${expiresAt}`;
    const signature = createHmac('sha256', process.env.APP_SECRET || 'dev_secret')
      .update(data)
      .digest('hex');

    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    return `${baseUrl}/api/v1/media/delivery/${this.workspaceId}/${assetId}?expiresAt=${expiresAt}&signature=${signature}`;
  }

  static validateDeliverySignature(
    workspaceId: string,
    assetId: string,
    expiresAt: number,
    signature: string
  ): boolean {
    if (Date.now() > expiresAt) return false;
    const data = `${workspaceId}:${assetId}:${expiresAt}`;
    const expected = createHmac('sha256', process.env.APP_SECRET || 'dev_secret')
      .update(data)
      .digest('hex');
    return expected === signature;
  }
}
