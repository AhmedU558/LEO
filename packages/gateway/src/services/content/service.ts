import { randomUUID } from 'node:crypto';
import type { ContentItem, PlatformVariant } from '@ownpilot/core/content';
import { db } from '../../db/client.js';
import { contentItems, platformVariants } from '../../db/schema/content.js';
import { eq, and } from 'drizzle-orm';

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
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(contentItems).values(item);
    return item;
  }

  async listContent(): Promise<ContentItem[]> {
    return db
      .select()
      .from(contentItems)
      .where(
        and(eq(contentItems.workspaceId, this.workspaceId), eq(contentItems.userId, this.userId))
      ) as Promise<ContentItem[]>;
  }

  async getContent(
    id: string
  ): Promise<{ item: ContentItem; variants: PlatformVariant[] } | undefined> {
    const res = await db
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.id, id),
          eq(contentItems.workspaceId, this.workspaceId),
          eq(contentItems.userId, this.userId)
        )
      );
    if (res.length === 0) return undefined;
    const item = res[0] as ContentItem;

    const variantsRes = await db
      .select()
      .from(platformVariants)
      .where(eq(platformVariants.contentId, id));
    return { item, variants: variantsRes as PlatformVariant[] };
  }

  async updateContent(id: string, data: Partial<ContentItem>): Promise<ContentItem> {
    const existing = await this.getContent(id);
    if (!existing) throw new Error('Not found');

    const updated = {
      ...existing.item,
      ...data,
      updatedAt: new Date(),
    };

    await db.update(contentItems).set(updated).where(eq(contentItems.id, id));
    return updated;
  }

  async setVariant(
    contentId: string,
    platform: string,
    data: Partial<PlatformVariant>
  ): Promise<PlatformVariant> {
    const existingContent = await this.getContent(contentId);
    if (!existingContent) throw new Error('Content not found');

    const existingVariant = existingContent.variants.find((v) => v.platform === platform);

    if (existingVariant) {
      const updated = {
        ...existingVariant,
        ...data,
        updatedAt: new Date(),
      };
      await db
        .update(platformVariants)
        .set(updated)
        .where(eq(platformVariants.id, existingVariant.id));
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
        validationState: 'unchecked',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db.insert(platformVariants).values(newVariant);
      return newVariant;
    }
  }
}
