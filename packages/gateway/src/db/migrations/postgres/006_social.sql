CREATE TABLE IF NOT EXISTS social_accounts (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  profile_url TEXT,
  status VARCHAR(50) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, workspace_id, platform, account_id)
);

CREATE TABLE IF NOT EXISTS social_posts (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  account_id VARCHAR(255) NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  hashtags JSONB NOT NULL DEFAULT '[]',
  media JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  scheduled_for TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_publish_requests (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  post_id VARCHAR(255) NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL,
  execution_task_id VARCHAR(255),
  provider_post_id VARCHAR(255),
  published_url TEXT,
  error JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user_workspace ON social_accounts(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_user_workspace ON social_posts(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_publish_requests_user_workspace ON social_publish_requests(user_id, workspace_id);
