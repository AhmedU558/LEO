import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const contentItems = pgTable('content_items', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title'),
  description: text('description'),
  caption: text('caption'),
  hashtags: jsonb('hashtags').default('[]'),
  tags: jsonb('tags').default('[]'),
  mediaAssetIds: jsonb('media_asset_ids').default('[]'),
  scheduledFor: timestamp('scheduled_for'),
  status: text('status').notNull(),
  executionTaskId: text('execution_task_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const platformVariants = pgTable('platform_variants', {
  id: text('id').primaryKey(),
  contentId: text('content_id')
    .notNull()
    .references(() => contentItems.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  title: text('title'),
  caption: text('caption'),
  description: text('description'),
  hashtags: jsonb('hashtags').default('[]'),
  tags: jsonb('tags').default('[]'),
  privacyStatus: text('privacy_status'),
  metadata: jsonb('metadata').default('{}'),
  validationState: text('validation_state').notNull().default('unchecked'),
  validationErrors: jsonb('validation_errors').default('[]'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
