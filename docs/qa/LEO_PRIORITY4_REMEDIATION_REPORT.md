# LEO Priority 4 remediation - incomplete draft

Date: 2026-09-20. Base commit: `ce20411f7e144edd239ab3656a59a61e306994bb`.

This is an implementation and verification report, not a replacement for the historical full QA report or matrix. Existing uncommitted remediation work was preserved. No commits, dependency changes, production database changes, or new product features were made.

**Do not merge or deploy this draft.** Targeted checks demonstrate several repairs, but Priority 4 is not complete. In particular, the sandbox migration denies previously supported host callbacks, existing worker/dynamic-tool compatibility tests fail, and arbitrary external side effects do not have an end-to-end fencing guarantee. Passing selected tests does not resolve those failures.

## QA-009

**Status: FAIL overall; selected isolation regressions PASS.**

- Original failure/root cause: custom tools defaulted to the core process's `node:vm`; workflow and claw expressions also ran there. Memory limits were nominal. Worker threads shared the process, and the Docker executor silently relaxed security and killed the Docker client without reliably removing its container.
- Implementation: dynamic tools, the `SandboxExecutor`/`WorkerSandbox` public APIs, extension tools, workflow expressions, and claw ephemeral tools now use the existing Docker infrastructure with a JSON-only boundary. There is no VM fallback in these entry points. Mandatory capability-drop and no-new-privileges flags remain enabled. Container execution is bounded by memory, CPU, process-count, output, and wall-time limits. Cancellation addresses a uniquely named container and awaits final cleanup. Host functions cannot be serialized across the boundary.
- Workflow expression callers and their existing tests were made asynchronous. Filter/map evaluation batches the array inside one container rather than starting a container for every item.
- Tests: real-container dynamic-tool arithmetic, denied host globals/constructor escape, denied host-function transfer, synchronous/asynchronous timeout, cancellation, and no surviving containers. A separate unavailable-runtime test proves failure without a local fallback. Existing workflow evaluator/node regressions: 105 passed. Docker unit regressions: 96 passed after updating obsolete relaxed-security expectations to require strict flags.
- **Compatibility limitation introduced by this draft:** custom tools requesting network/local/filesystem/shell capabilities are denied. Extension tools with granted permissions are denied. Config/credential helpers, nested tool callbacks, timer/crypto helper parity, and worker initialization/message protocol compatibility have not been restored through a policy-enforced container bridge. Existing tests for these contracts still fail; they were not deleted or disabled.
- **Not verified:** every native plugin/import and local code-execution path; cancellation of non-job workflow expressions and arbitrary trusted handlers; runtime-unavailable recovery without restarting the process; all PolicyEngine/ActionLedger invariants at an eventual host bridge. Docker preparation/image acquisition is outside the execution timeout. The image is tag-based, not digest-pinned.

## QA-016

**Status: FAIL overall; atomic repository claims PASS.**

- Original failure/root cause: a `user + tool + args` result cache conflated distinct operations, used a check-then-write race, ignored storage failures, and stored failures as reusable responses.
- Implementation: the existing idempotency repository now atomically inserts operation claims using its primary key and `ON CONFLICT DO NOTHING`. Keys encode user and operation separately; a request fingerprint detects reusing an operation with different arguments. Records distinguish pending/success/failed/cancelled/unknown. Effect records use an infinite expiry to prevent unsafe automatic replay after a cache TTL. Only successful operation results are replayed. Claim/persistence failures fail closed or return an uncertain outcome.
- The tool execution context accepts an operation ID and abort signal. Job handlers and their nested tool effects have durable identities. Direct workflow tool/code nodes use workflow-log/node IDs. Plan tool/parallel/loop calls use plan/step/iteration IDs. Calls without an operation ID receive a new identity, so intentionally identical independent operations remain independent.
- Tests: real PostgreSQL concurrent claims (12 contenders), different operation IDs, user separation, terminal-state replay denial, and repository reconstruction. Existing shared-tool executor tests pass with the new repository contract.
- **Not verified:** end-to-end duplicate HTTP requests; complete trigger/agentic/foreach identity propagation; actual process crash/restart; provider-side idempotency; workspace identity where one user owns multiple workspaces. A new repository instance is not equivalent to a process-restart test. Persistent pending claims require reconciliation; this draft provides no reconciliation workflow. At-most-once admission does not prove exactly-once external delivery.

## QA-017

**Status: FAIL overall; database fencing and cooperative cancellation checks PASS.**

- Original failure/root cause: active jobs lacked leases; completion/failure were not conditional on ownership; cancellation could be overwritten; stopping workers neither aborted nor drained handlers.
- Implementation: additive lease token/expiry columns, atomic expired-lease reclaim, token/status/expiry checks for completion and failure, lease renewal, terminal cancellation, and a transaction-locked ownership check around effect claims. Legacy active rows are retained as failed with an explicit unknown outcome. Exhausted expired leases are marked failed/unknown instead of remaining active forever.
- Workers receive an AbortSignal, renew leases, abort on ownership-check failure, and avoid finalizing cancelled work. Local cancellation immediately signals the handler; remote cancellation is observed by the heartbeat. Shutdown aborts and waits up to five seconds. A durable whole-job claim prevents automatic replay of an uncertain handler. Successful durable handler results can be recovered before job finalization.
- Also repaired `listByStatus` SQL, whose LIMIT clause was incorrectly embedded in WHERE before ORDER BY.
- Tests: actual PostgreSQL concurrent claims, forced lease expiry/reclaim, rejection of old-owner completion/failure, terminal cancellation, and queue listing; unit tests verify abort/drain and rejection before handler invocation when ownership is lost.
- **Known limits:** the DB fence is checked before effect admission, not enforced by arbitrary external providers. A paused stale handler can still continue an already-admitted external operation. A trusted handler that ignores AbortSignal can outlive the five-second drain bound. Failed/uncertain handlers are conservatively blocked from replay, so general safe retry/reconciliation is incomplete. Cross-process cancellation latency, process-kill recovery, lease-loss during an external call, and completion/cancellation races under sustained load are not fully tested. This does not meet the user's complete lifecycle guarantee.

## QA-018

**Status: PASS for the demonstrated queue-selection behavior.**

- Original failure/root cause: workers called `claimJob(queue, 0)`, and SQL required `priority <= 0`, excluding system jobs at priority 100.
- Implementation: removed the priority ceiling and the caller argument. Larger priority values sort first. Jobs eligible for at least five minutes precede fresh jobs and are ordered by eligibility time, then priority/creation time/ID. This prevents an ongoing stream of fresh high-priority jobs from indefinitely overtaking old work. Queue isolation and SKIP LOCKED remain intact.
- Tests: real PostgreSQL selection of positive, zero, and negative priorities; priority-100 precedence; aged negative-priority work preceding fresh high-priority work; separate queue selection; deterministic SQL tie-breakers.
- Limits: five minutes bounds overtaking by new jobs, not total completion latency with an overloaded queue or stalled workers. No throughput benchmark or long-duration fairness/load test was performed.

## Verification

All commands ran against local/test resources. PostgreSQL ran in a disposable `postgres:16` container bound to `127.0.0.1:55439`; tests create/drop a uniquely named database. Container isolation tests use `node:20-slim` and local synthetic data.

Commands (from the relevant package directory unless stated otherwise):

```text
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2
node ../../node_modules/vitest/vitest.mjs run src/db/repositories/priority4.integration.test.ts --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run src/sandbox/priority4-isolation.integration.test.ts src/sandbox/priority4-unavailable.test.ts --maxWorkers=1
node ../../node_modules/vitest/vitest.mjs run src/services/workflow/executors/utils.test.ts src/services/workflow/node-executors.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/gateway/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/cli/tsconfig.json
node ../../node_modules/typescript/bin/tsc -b
node node_modules/eslint/bin/eslint.js packages
```

The integration switches are `LEO_QA_POSTGRES_URL` for PostgreSQL and `LEO_QA_DOCKER=1` for the container integration file. Without those switches, skipped integration tests are NOT VERIFIED, never PASS.

| Check                                               | Result                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full core suite, first broad run                    | FAIL: 224 failed, 9,735 passed, 8 skipped; 41 unhandled errors. Historical pre-cleanup run; not a final-patch pass.                              |
| Full gateway suite, first broad run                 | FAIL: 228 failed, 17,814 passed, 4 skipped; 7 unhandled errors. Historical run before async-test/fixture corrections.                            |
| Full core suite, rerun                              | FAIL: 174 failed, 9,785 passed, 8 skipped; 8 failed/155 passed/1 skipped files. No unhandled errors reported.                                    |
| Full gateway suite, rerun                           | FAIL: 195 failed, 17,847 passed, 4 skipped; 21 failed/458 passed/1 skipped files; 3 unhandled errors.                                            |
| Full UI suite                                       | FAIL: 6 failed, 2,100 passed, 1 skipped; AnalyticsPage provider/render failures.                                                                 |
| Full CLI suite                                      | FAIL: 422 tests passed but two suites failed to load.                                                                                            |
| Targeted shared-tool/worker/control-flow            | PASS: 97 tests.                                                                                                                                  |
| PostgreSQL integration                              | PASS: 4 tests after recreating the disposable database container. An intervening attempt failed with ECONNREFUSED; it was not counted as a pass. |
| Docker unit tests                                   | PASS: 96 tests, including strict-security expectations.                                                                                          |
| Container isolation/unavailable checks              | PASS: final 7 tests, including a real cgroup native-buffer memory-limit kill followed by successful execution in another container.              |
| Existing workflow runtime checks                    | PASS: 105 tests using real containers.                                                                                                           |
| Core security directory                             | PASS: 287 tests across 4 files; this is not complete PolicyEngine/RiskEngine/ActionLedger coverage.                                              |
| Gateway MCP/browser/middleware regression selection | FAIL: 34 failed, 863 passed; 4 failed/18 passed files.                                                                                           |
| Core and CLI compilation                            | PASS with installed TypeScript binaries.                                                                                                         |
| Gateway typecheck                                   | FAIL: 10 errors in analytics/autonomy/computer/social/voice contracts; includes undefined `account`.                                             |
| UI build/typecheck                                  | FAIL: unresolved core computer/social/voice subpaths and associated type/unused-variable errors.                                                 |
| ESLint across packages                              | PASS at ESLint's default exit threshold: 0 errors, 5 warnings. A zero-warning gate is not satisfied.                                             |
| Full application/E2E                                | NOT VERIFIED: no passing complete build/startup/E2E sequence.                                                                                    |

`pnpm run test`, `typecheck`, `build`, and `lint` were attempted. The installed pnpm tried an implicit install and failed with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. With its dependency preflight disabled only in the command environment, wrappers printed `$ turbo ...` without authoritative task results. The build then spawned many copies of the repository's Turbo executable; those QA-started processes were stopped. Do not interpret wrapper exit code zero as successful build/typecheck/lint. No dependency purge was approved or performed. Package binaries were used for substantive verification. The cause of Turbo recursion and the earlier reported pre-commit heap OOM were not resolved by this pass.

Across the latest complete package runs: **30,154 passed, 375 failed, 13 skipped**, plus two CLI suite-load failures and three gateway unhandled errors. The core/gateway reruns preceded the last formatting-only changes and additional memory-limit test; the latter was separately verified. These numbers are not a passing release gate.

## Remaining QA findings

Only the demonstrated QA-018 queue-selection defect is closed here. All others remain unresolved or require renewed verification; previous remediation claims are not evidence of resolution:

- QA-001 authentication/session bypass; QA-002 gateway build/startup; QA-003 UI build/UX; QA-004 service/capability/ledger contracts.
- QA-005 user/workspace isolation; QA-006 PolicyEngine enforcement; QA-007 tool policy/risk bypass; QA-008 credential declaration/access.
- QA-009 isolation completeness and compatibility; QA-010 ledger integrity/durability; QA-011 ledger hash growth; QA-012 approval replay/cancellation; QA-013 workflow approval liveness.
- QA-014 voice/autonomy contract regression; QA-015 agent cache consistency; QA-016 operation identity/retry coverage; QA-017 full lifecycle and external-effect fencing.
- QA-019 browser isolation; QA-020 domain policy; QA-021 proxy/rate-limit/CSRF trust; QA-022 fabricated analytics/provider success.
- QA-023 database URL configuration; QA-024 development dependency vulnerabilities; QA-025 MCP environment isolation; QA-026 MCP error status; QA-027 autonomous resource limits; QA-028 documentation drift.

Passing existing MCP/browser tests in this pass does not independently prove all prior security invariants.

## Important files changed in this pass

- Core: `src/agent/tools/dynamic-tool-executor.ts`; `src/sandbox/{docker,executor,worker-sandbox,index,types}.ts`; `src/services/tool-service.ts`.
- Gateway data: `src/db/repositories/{jobs,idempotency-keys}.ts`; `src/db/schema/core.ts`.
- Gateway execution: `src/services/job-queue-service.ts`; `src/services/tool/{executor,service}.ts`; `src/services/permission/utils.ts`; `src/plans/executor.ts`; `src/services/extension/sandbox.ts`.
- Workflow expression/data/control/tool executors, dispatch, dependency-status checks, and `src/tools/claw/lifecycle-executors.ts`.
- New PostgreSQL and isolation regression files; updated existing Docker, worker, shared-tool, and workflow tests. No failing test suite was deleted or disabled.

These paths are under `packages/core` or `packages/gateway` as indicated. Other modified files present before this pass belong to earlier work and are not claimed as changes from this pass.

## Database migrations

`packages/gateway/src/db/migrations/postgres/002_job_leases.sql` adds nullable lease columns and a partial active-lease index. It preserves existing rows and marks legacy active jobs failed/unknown for reconciliation. Equivalent idempotent SQL is included in the runtime `CORE_MIGRATIONS_SQL`, because runtime initialization uses those schema modules. The integration suite applies the migration twice. No production migration was run.

Rollback statements are comments in the SQL file. Stop all workers before dropping lease columns/indexes. The legacy outcome classification is deliberately not automatically reversed: replaying an uncertain effect would be unsafe. Mixed old/new workers are unsafe because old workers lack fencing; use a coordinated stop/migrate/start rollout after the remaining defects are addressed.

## Risks and next required work

1. Complete the policy-enforced isolated capability bridge or explicitly agree a narrower supported custom-tool API; restore/test required compatibility without restoring host execution.
2. Verify all operation-ID propagation and real process-crash/provider-uncertainty scenarios. Define reconciliation and retention for durable uncertain effects.
3. Close stale external-effect and non-cooperative-handler cancellation gaps. Add process-level recovery and race tests before marking QA-017 resolved.
4. Repair the remaining build and broad regression failures, then run a complete application startup/E2E sequence. Investigate the local Turbo recursion separately from the historical lint heap OOM.

No new feature work should follow this draft until the required security and compatibility checks pass.
