export const MEDIA_CONTENT_SQL = `
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  checksum TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  dimensions JSONB,
  duration_seconds INTEGER,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_user_workspace ON media_assets (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_checksum ON media_assets (checksum);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  caption TEXT,
  hashtags JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  media_asset_ids JSONB DEFAULT '[]',
  scheduled_for TIMESTAMP,
  status TEXT NOT NULL,
  execution_task_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_items_user_workspace ON content_items (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS platform_variants (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  title TEXT,
  caption TEXT,
  description TEXT,
  hashtags JSONB DEFAULT '[]',
  tags JSONB DEFAULT '[]',
  privacy_status TEXT,
  metadata JSONB DEFAULT '{}',
  validation_state TEXT NOT NULL DEFAULT 'unchecked',
  validation_errors JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_variants_content_id ON platform_variants (content_id);
`;
