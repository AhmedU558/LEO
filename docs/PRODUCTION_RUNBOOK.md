# LEO Production Runbook

## Health Checks

- Readiness: \GET /health\ (HTTP 200 means app is up)
- Deep Health: \GET /api/v1/health\ (Requires Admin API keys, checks DB + Sandboxes)

## Common Issues & Remediation

### 1. Database Connection Failures

- **Symptom**: 500 errors, logs indicate "Connection timeout"
- **Fix**: Check DATABASE_URL validity. Verify Postgres is accepting connections.

### 2. High CPU / Worker Saturation

- **Symptom**: Tasks are delayed, high node CPU usage.
- **Fix**: Scale out gateway instances horizontally. The embedded scheduler supports lock-based concurrency.

### 3. Graceful Shutdown Hanging

- **Symptom**: Container takes > 30s to terminate.
- **Fix**: Send SIGTERM. The application calls stopScheduler() and closeAdapter(). Allow up to 15s for active tasks to yield.

## Backup and Restore

- Run daily pg_dump.
- Workspaces contain state inside SQLite/files (if not fully migrated to PG). Ensure DATA_DIR is backed up.
