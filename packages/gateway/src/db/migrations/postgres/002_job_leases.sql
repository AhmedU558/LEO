-- Additive migration; existing active jobs have uncertain outcomes and must not
-- be automatically replayed. Preserve their payload/result for reconciliation.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
UPDATE jobs SET status = 'failed', result = COALESCE(result, '{}'::jsonb) ||
  '{"outcome":"unknown","error":"Legacy active job requires reconciliation"}'::jsonb
WHERE status = 'active' AND lease_token IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_queue_lease ON jobs(queue, lease_expires_at)
  WHERE status = 'active';

-- Rollback requires stopping every worker first. Do not replay unknown effects.
-- DROP INDEX IF EXISTS idx_jobs_queue_lease;
-- ALTER TABLE jobs DROP COLUMN lease_expires_at, DROP COLUMN lease_token;
