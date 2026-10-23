CREATE TABLE IF NOT EXISTS social_campaigns (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  content_item_id VARCHAR(255) NOT NULL,
  execution_task_id VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  scheduled_for TIMESTAMP WITH TIME ZONE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_campaign_targets (
  id VARCHAR(255) PRIMARY KEY,
  campaign_id VARCHAR(255) NOT NULL REFERENCES social_campaigns(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  workspace_id VARCHAR(255) NOT NULL,
  account_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  publish_request_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  error JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_user_workspace ON social_campaigns(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_campaign_targets_campaign ON social_campaign_targets(campaign_id);

