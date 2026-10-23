import { pgTable, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const mediaAssets = pgTable('media_assets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  mediaType: text('media_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  checksum: text('checksum').notNull(),
  metadata: jsonb('metadata').default('{}'),
  dimensions: jsonb('dimensions'),
  durationSeconds: integer('duration_seconds'),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
