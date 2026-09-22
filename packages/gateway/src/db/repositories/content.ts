import { BaseRepository } from './base.js';
import type { ContentItem, PlatformVariant } from '@ownpilot/core/content';

export class ContentRepository extends BaseRepository {
  async insertItem(item: ContentItem): Promise<void> {
    await this.execute(
      `INSERT INTO content_items (
        id, user_id, workspace_id, title, description, caption,
        hashtags, tags, media_asset_ids, scheduled_for, status, execution_task_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        item.id,
        item.userId,
        item.workspaceId,
        item.title,
        item.description,
        item.caption,
        JSON.stringify(item.hashtags || []),
        JSON.stringify(item.tags || []),
        JSON.stringify(item.mediaAssetIds || []),
        item.scheduledFor ? item.scheduledFor.toISOString() : null,
        item.status,
        item.executionTaskId,
        item.createdAt.toISOString(),
        item.updatedAt.toISOString(),
      ]
    );
  }

  async listItems(workspaceId: string, userId: string): Promise<ContentItem[]> {
    const rows = await this.query<ContentItem>(
      `SELECT
        id, user_id as "userId", workspace_id as "workspaceId", title, description, caption,
        hashtags, tags, media_asset_ids as "mediaAssetIds", scheduled_for as "scheduledFor", status, execution_task_id as "executionTaskId",
        created_at as "createdAt", updated_at as "updatedAt"
       FROM content_items
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [workspaceId, userId]
    );
    return rows.map((r) => ({
      ...r,
      scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : undefined,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
  }

  async getItem(id: string, workspaceId: string, userId: string): Promise<ContentItem | undefined> {
    const rows = await this.query<ContentItem>(
      `SELECT
        id, user_id as "userId", workspace_id as "workspaceId", title, description, caption,
        hashtags, tags, media_asset_ids as "mediaAssetIds", scheduled_for as "scheduledFor", status, execution_task_id as "executionTaskId",
        created_at as "createdAt", updated_at as "updatedAt"
       FROM content_items
       WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
      [id, workspaceId, userId]
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      ...r,
      scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : undefined,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    };
  }

  async getVariants(contentId: string): Promise<PlatformVariant[]> {
    const rows = await this.query<PlatformVariant>(
      `SELECT
        id, content_id as "contentId", platform, title, caption, description,
        hashtags, tags, privacy_status as "privacyStatus", metadata, validation_state as "validationState", validation_errors as "validationErrors",
        created_at as "createdAt", updated_at as "updatedAt"
       FROM platform_variants
       WHERE content_id = $1`,
      [contentId]
    );
    return rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
  }

  async updateItem(id: string, item: ContentItem): Promise<void> {
    await this.execute(
      `UPDATE content_items SET
        title = $1, description = $2, caption = $3, hashtags = $4, tags = $5, media_asset_ids = $6,
        scheduled_for = $7, status = $8, execution_task_id = $9, updated_at = $10
       WHERE id = $11`,
      [
        item.title,
        item.description,
        item.caption,
        JSON.stringify(item.hashtags || []),
        JSON.stringify(item.tags || []),
        JSON.stringify(item.mediaAssetIds || []),
        item.scheduledFor ? item.scheduledFor.toISOString() : null,
        item.status,
        item.executionTaskId,
        item.updatedAt.toISOString(),
        id,
      ]
    );
  }

  async updateVariant(id: string, variant: PlatformVariant): Promise<void> {
    await this.execute(
      `UPDATE platform_variants SET
        title = $1, caption = $2, description = $3, hashtags = $4, tags = $5, privacy_status = $6,
        metadata = $7, validation_state = $8, validation_errors = $9, updated_at = $10
       WHERE id = $11`,
      [
        variant.title,
        variant.caption,
        variant.description,
        JSON.stringify(variant.hashtags || []),
        JSON.stringify(variant.tags || []),
        variant.privacyStatus,
        JSON.stringify(variant.metadata || {}),
        variant.validationState,
        JSON.stringify(variant.validationErrors || []),
        variant.updatedAt.toISOString(),
        id,
      ]
    );
  }

  async insertVariant(variant: PlatformVariant): Promise<void> {
    await this.execute(
      `INSERT INTO platform_variants (
        id, content_id, platform, title, caption, description, hashtags, tags,
        privacy_status, metadata, validation_state, validation_errors, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        variant.id,
        variant.contentId,
        variant.platform,
        variant.title,
        variant.caption,
        variant.description,
        JSON.stringify(variant.hashtags || []),
        JSON.stringify(variant.tags || []),
        variant.privacyStatus,
        JSON.stringify(variant.metadata || {}),
        variant.validationState,
        JSON.stringify(variant.validationErrors || []),
        variant.createdAt.toISOString(),
        variant.updatedAt.toISOString(),
      ]
    );
  }
}

export function createContentRepository(): ContentRepository {
  return new ContentRepository();
}
