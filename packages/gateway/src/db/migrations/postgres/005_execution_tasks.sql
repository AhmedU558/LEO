
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE TABLE IF NOT EXISTS execution_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_run_id TEXT UNIQUE REFERENCES workflow_logs(id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('CREATED','PLANNING','READY','WAITING_APPROVAL','RUNNING','VERIFYING','COMPLETED','FAILED','RETRYING','PAUSED','CANCELLED','EXPIRED')),
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  inputs JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error TEXT,
  outcome TEXT CHECK(outcome IN ('UNKNOWN','SUCCESS','FAILURE','CANCELLED')),
  job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(user_id, workspace_id, request_key),
  CHECK(state <> 'COMPLETED' OR outcome = 'SUCCESS')
);
CREATE INDEX IF NOT EXISTS idx_execution_tasks_scope ON execution_tasks(user_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_tasks_active ON execution_tasks(state) WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED','EXPIRED');
