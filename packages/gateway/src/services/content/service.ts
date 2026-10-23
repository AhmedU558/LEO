import { randomUUID } from 'node:crypto';
import type { ContentItem, PlatformVariant } from '@ownpilot/core/content';
import { createContentRepository } from '../../db/repositories/content.js';

export class ContentService {
  constructor(
    private userId: string,
    private workspaceId: string
  ) {}

  async createContent(data: Partial<ContentItem>): Promise<ContentItem> {
    const id = `content_${randomUUID()}`;
    const item: ContentItem = {
      id,
      userId: this.userId,
      workspaceId: this.workspaceId,
      title: data.title,
      description: data.description,
      caption: data.caption,
      hashtags: data.hashtags || [],
      tags: data.tags || [],
      mediaAssetIds: data.mediaAssetIds || [],
      scheduledFor: data.scheduledFor,
      status: data.status || 'DRAFT',
      executionTaskId: data.executionTaskId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const repo = createContentRepository();
    await repo.insertItem(item);
    return item;
  }

  async listContent(): Promise<ContentItem[]> {
    const repo = createContentRepository();
    return repo.listItems(this.workspaceId, this.userId);
  }

  async getContent(
    id: string
  ): Promise<{ item: ContentItem; variants: PlatformVariant[] } | undefined> {
    const repo = createContentRepository();
    const item = await repo.getItem(id, this.workspaceId, this.userId);
    if (!item) return undefined;

    const variants = await repo.getVariants(id);
    return { item, variants };
  }

  async updateContent(id: string, data: Partial<ContentItem>): Promise<ContentItem> {
    const existing = await this.getContent(id);
    if (!existing) throw new Error('Not found');

    const updated: ContentItem = {
      ...existing.item,
      ...data,
      updatedAt: new Date(),
    };

    const repo = createContentRepository();
    await repo.updateItem(id, updated);
    return updated;
  }

  async setVariant(
    contentId: string,
    platform: string,
    data: Partial<PlatformVariant>
  ): Promise<PlatformVariant> {
    const existing = await this.getContent(contentId);
    if (!existing) throw new Error('Content not found');

    const repo = createContentRepository();
    const variants = existing.variants;
    const existingVariant = variants.find((v) => v.platform === platform);

    if (existingVariant) {
      const updated: PlatformVariant = {
        ...existingVariant,
        ...data,
        updatedAt: new Date(),
      };
      await repo.updateVariant(existingVariant.id, updated);
      return updated;
    } else {
      const newVariant: PlatformVariant = {
        id: `var_${randomUUID()}`,
        contentId,
        platform,
        title: data.title,
        caption: data.caption,
        description: data.description,
        hashtags: data.hashtags || [],
        tags: data.tags || [],
        privacyStatus: data.privacyStatus,
        metadata: data.metadata || {},
        validationState: data.validationState || 'unchecked',
        validationErrors: data.validationErrors || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await repo.insertVariant(newVariant);
      return newVariant;
    }
  }
}
