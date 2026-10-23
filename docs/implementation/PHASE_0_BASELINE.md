# LEO Phase 0 Baseline Report

## Repository Context

- **Repository commit:** `eb4c27f29d4d12778621a83e49cd673cd8b62239` (ownpilot/OwnPilot)
- **Branch:** `main`
- **Package manager:** pnpm (>= 10.0.0)
- **Package versions:** 0.8.3

## Runtime Requirements

- **Node version:** `>=22.22.0`
- **pnpm version:** `>=10.0.0`
- **Database requirements:** PostgreSQL (with `pgvector` extension)
- **Redis requirements:** None configured in OwnPilot baseline (must be introduced for LEO queues)
- **Environment variables:** Available in `.env.example`, including fallback development secrets (e.g., `ownpilot_secret` for local postgres) and configurations for execution boundaries (`OWNPILOT_ALLOW_LOCAL_EXEC`, `LOCAL_EXEC_REQUIRE_APPROVAL`).

## Baseline Results

- **Build status:** FAIL (`@ownpilot/core` fails with TS2393: Duplicate function implementation in `src/scheduler/notifications.ts`)
- **Typecheck status:** FAIL (Same duplicate function implementation errors as build)
- **Lint status:** FAIL (Test suite failed to run cleanly due to build errors)
- **Test status:** FAIL (Tests execution aborted due to compilation errors; UI tests also emit `act` warnings)
- **Database result:** PASS (PostgreSQL configuration present via `docker-compose.db.yml`)
- **Redis result:** NOT AVAILABLE (Not present in baseline, gap identified)

## Known Discrepancies & Findings

- **Known failures / warnings:**
  - `@ownpilot/core` fails typecheck and build due to duplicate function implementations in `src/scheduler/notifications.ts`.
  - UI tests emit `act(...)` warnings in React components.
- **Architecture observations:**
  - OwnPilot operates via a Gateway that serves both API, WebSockets, and UI.
  - Agent logic, tool execution, memory, and sandboxing exist in `packages/core`.
  - Dynamic tools and registries are heavily utilized (`capability-registry.ts`, `packages/gateway/src/tools`).
- **Security observations:**
  - Has built-in SSRF protections, JWT/session authentication, and credential isolation.
  - Default database secrets are hardcoded in `docker-compose.db.yml` and bound only to `127.0.0.1`.
  - Docker is used for code execution sandboxing, but contains escape hatches like `OWNPILOT_ALLOW_LOCAL_EXEC` intended for local dev. These must be restricted or securely controlled in LEO.
