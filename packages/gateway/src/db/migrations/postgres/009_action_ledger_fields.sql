ALTER TABLE action_ledger ADD COLUMN IF NOT EXISTS execution_task_id TEXT;
ALTER TABLE action_ledger ADD COLUMN IF NOT EXISTS session_id TEXT;
