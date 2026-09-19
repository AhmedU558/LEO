# Release Checklist

## Pre-Release Validation

- [x] All automated tests pass (\ urbo test run\)
- [x] Linting and typechecks pass (\ urbo lint\ / \ urbo typecheck\)
- [x] Dependency audit shows zero high vulnerabilities (\pnpm audit --prod --audit-level high\)
- [x] Environment configuration validates strictly (Zod)

## Security

- [x] ActionLedger records all actions
- [x] Unsafe executions (shell, app_control) default to READ_ONLY
- [x] Cross-workspace isolation verified
- [x] No secrets are exposed or checked into version control

## Deployment

- [x] Migrations run successfully
- [x] Graceful shutdown mechanisms drain active connections
- [x] Analytics and Telemetry enabled safely
