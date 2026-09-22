import { randomUUID, createHash } from 'node:crypto';
import type { MediaAsset, MediaType } from '@ownpilot/core/media';
import { storageProvider } from '../storage/index.js';
import { db } from '../../db/client.js';
import { mediaAssets } from '../../db/schema/media.js';
import { eq, and } from 'drizzle-orm';
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

      await db.insert(mediaAssets).values(asset);
      return asset;
    } catch (e: unknown) {
      log.error(`Upload failed: ${(e as Error).message}`);
      throw new Error(`Upload failed: ${(e as Error).message}`);
    }
  }

  async listMedia(): Promise<MediaAsset[]> {
    return db
      .select()
      .from(mediaAssets)
      .where(
        and(eq(mediaAssets.workspaceId, this.workspaceId), eq(mediaAssets.userId, this.userId))
      ) as Promise<MediaAsset[]>;
  }

  async getMedia(id: string): Promise<MediaAsset | undefined> {
    const res = await db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, id),
          eq(mediaAssets.workspaceId, this.workspaceId),
          eq(mediaAssets.userId, this.userId)
        )
      );
    return res[0] as MediaAsset | undefined;
  }

  async deleteMedia(id: string): Promise<void> {
    const asset = await this.getMedia(id);
    if (!asset) throw new Error('Not found');

    await storageProvider.delete(asset.storageKey);
    await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  }
}
