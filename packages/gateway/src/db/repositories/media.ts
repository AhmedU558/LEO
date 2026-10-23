import { BaseRepository } from './base.js';
import type { MediaAsset } from '@ownpilot/core/media';

export class MediaRepository extends BaseRepository {
  async insert(asset: MediaAsset): Promise<void> {
    await this.execute(
      `INSERT INTO media_assets (
        id, user_id, workspace_id, filename, mime_type, media_type,
        size_bytes, storage_key, checksum, metadata, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        asset.id,
        asset.userId,
        asset.workspaceId,
        asset.filename,
        asset.mimeType,
        asset.mediaType,
        asset.sizeBytes,
        asset.storageKey,
        asset.checksum,
        JSON.stringify(asset.metadata || {}),
        asset.status,
        asset.createdAt.toISOString(),
        asset.updatedAt.toISOString(),
      ]
    );
  }

  async list(workspaceId: string, userId: string): Promise<MediaAsset[]> {
    const rows = await this.query<MediaAsset>(
      `SELECT
        id, user_id as "userId", workspace_id as "workspaceId", filename,
        mime_type as "mimeType", media_type as "mediaType", size_bytes as "sizeBytes",
        storage_key as "storageKey", checksum, metadata, status,
        created_at as "createdAt", updated_at as "updatedAt"
       FROM media_assets
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [workspaceId, userId]
    );
    return rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
  }

  async get(id: string, workspaceId: string, userId: string): Promise<MediaAsset | undefined> {
    const rows = await this.query<MediaAsset>(
      `SELECT
        id, user_id as "userId", workspace_id as "workspaceId", filename,
        mime_type as "mimeType", media_type as "mediaType", size_bytes as "sizeBytes",
        storage_key as "storageKey", checksum, metadata, status,
        created_at as "createdAt", updated_at as "updatedAt"
       FROM media_assets
       WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
      [id, workspaceId, userId]
    );
    const r = rows[0];
    if (!r) return undefined;
    return { ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) };
  }

  async getPublicAsset(id: string, workspaceId: string): Promise<MediaAsset | undefined> {
    const rows = await this.query<MediaAsset>(
      `SELECT
        id, user_id as "userId", workspace_id as "workspaceId", filename,
        mime_type as "mimeType", media_type as "mediaType", size_bytes as "sizeBytes",
        storage_key as "storageKey", checksum, metadata, status,
        created_at as "createdAt", updated_at as "updatedAt"
       FROM media_assets
       WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );
    const r = rows[0];
    if (!r) return undefined;
    return { ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) };
  }

  async deleteAsset(id: string): Promise<void> {
    await this.execute(`DELETE FROM media_assets WHERE id = $1`, [id]);
  }
}

export function createMediaRepository(): MediaRepository {
  return new MediaRepository();
}
