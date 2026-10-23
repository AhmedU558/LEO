CREATE TABLE IF NOT EXISTS action_ledger (
  action_id TEXT PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT,
  task_id TEXT,
  run_id TEXT,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  credential_id TEXT,
  capability TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_id TEXT,
  approval_status TEXT,
  execution_environment TEXT NOT NULL,
  result TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  cost_usd NUMERIC,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_ledger_user ON action_ledger(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_action_ledger_workspace ON action_ledger(workspace_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_action_ledger_hash ON action_ledger(hash);

-- Sequence table to manage hash chain safely for concurrency
CREATE TABLE IF NOT EXISTS action_ledger_tail (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_hash TEXT NOT NULL
);

INSERT INTO action_ledger_tail (id, last_hash)
VALUES (1, 'genesis')
ON CONFLICT (id) DO NOTHING;
