# LEO Full QA Report

Audit date: 2026-09-19 (Asia/Karachi). Repository: D:/LEO.
Audited commit: ce20411f7e144edd239ab3656a59a61e306994bb.
Mode: REPORT ONLY. No implementation, dependencies, schema, configuration, staging or commits changed.

## 1. Executive Summary

**FAIL: this checkout is not releasable.** The gateway cannot start and the frontend cannot render. There are **28 findings: 2 CRITICAL, 19 HIGH, 6 MEDIUM, 1 LOW**. The two critical findings are a password-authentication bypass and unrestricted credential access from a sandboxed custom tool without declared service requirements. Both were reproduced with dummy data, without external targets.

All four package suites ran using installed binaries: **30,369 passed, 111 failed, 4 skipped**. Four suite files fail before collecting tests and gateway reports three unhandled errors. Those totals are not a coverage percentage. Six core failures involve the execution environment. Lint success does not compensate for TypeScript/runtime failures.

All 31 requested areas are addressed. This is a broad repository audit with focused security/runtime tracing, not a claim that every line, browser flow or deployment topology was exhaustively proven. Each unexercised integration is marked NOT VERIFIED. Existing documentation and phase claims were checked against source; no prior test report was treated as current evidence.

The tests/probes used local in-memory data, dummy credentials, fake provider clients, compiler outputs and loopback UI. Only package advisory lookup contacted an external service. No social publication, external security probing, real credential extraction or production database operation occurred.

## 2. Actual Repository State

The initial worktree was clean. HEAD is the v1.1-labelled commit, but root and package versions remain **0.8.3**. HEAD changes only ActionLedger indexes and AgentsRepository caching; its subject's rate-limit claim is not evidence of a rate-limit implementation in that commit.

Actual runtime: Windows PowerShell, Node **v24.14.1**, installed pnpm **11.19.0**; repository pins **pnpm@10.29.3**, Node >=22.22.0. pnpm 11 warns that package.json pnpm overrides/onlyBuiltDependencies are ignored. No dependency installation was performed to reconcile that mismatch.

Fresh report-code-health scan:

| Package | Files | Production files | Test files (script classification) |     LOC |
| ------- | ----: | ---------------: | ---------------------------------: | ------: |
| cli     |    33 |               19 |                                 14 |  12,097 |
| core    |   455 |              293 |                                162 | 193,640 |
| gateway | 1,077 |              597 |                                480 | 448,389 |
| ui      |   627 |              511 |                                116 | 184,278 |
| Total   | 2,192 |            1,420 |                                772 | 838,404 |

The health-script file inventory differs from Vitest collection (771 suite files); inventory is not an executed-test count. Architecture is TypeScript/Turborepo: core agent/tool/security/sandbox primitives; Hono gateway with PostgreSQL repositories; React 19 UI with installed Vite 8.0.16; Commander CLI. The supplied Vite 7 description is stale.

The major architectural issue is **parallel implementations**: mature OwnPilot approvals/audit/voice/worker/browser infrastructure alongside new LEO security and simulator-backed services. New routes overwrite old contracts; new service types do not match core exports. The ActionLedger is separate from the existing cryptographic audit module in packages/core/src/audit, which already exports verifyAuditLog/verifyEventChecksum/verifyEventChain.

Builds wrote normal ignored outputs/cache files; temporary logs and probe scripts are under the OS temporary directory. Only the two requested Markdown files are intended repository changes. Nothing was committed.

## 3. Build/Test Results

| Check                                | Status       | Fresh result                                                                                                                                                                            |
| ------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root pnpm build command              | NOT VERIFIED | Installed pnpm 11 tried dependency reconciliation and aborted with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. No install/purge was accepted. Used installed compiler binaries instead. |
| Core build / typecheck               | PASS         | tsc and tsc --noEmit exit 0.                                                                                                                                                            |
| Gateway build / typecheck            | FAIL         | 71 compiler diagnostics; build exit 2, separate noEmit invocation exit 1; same contract/export failures.                                                                                |
| CLI build / typecheck                | PASS         | Direct tsc and noEmit exit 0; runtime-dependent test suites still fail.                                                                                                                 |
| UI build / typecheck                 | FAIL         | tsc -b, tsc --noEmit and Vite build fail; duplicate declarations/missing imports.                                                                                                       |
| Source lint, all four packages       | PASS         | eslint packages/{core,gateway,ui,cli}/src --no-fix --max-warnings=0 exits 0.                                                                                                            |
| Broader lint including E2E           | PASS         | eslint packages --no-fix exits 0 with one warning in packages/ui/e2e/workflow-mobile.spec.ts:75. This would FAIL a zero-warning gate if that file were staged.                          |
| Core Vitest                          | FAIL         | 160 files pass, 2 fail; 9,952 tests pass, 6 fail, 3 skip; 53.94 s. Six failures are environment-blocked, not proven product regressions.                                                |
| Gateway Vitest                       | FAIL         | 471 files pass, 8 fail; 17,895 tests pass, 99 fail; 3 unhandled errors; 162.99 s.                                                                                                       |
| UI Vitest                            | FAIL         | 115 files pass, 1 fails; 2,100 tests pass, 6 fail, 1 skips; 82.04 s.                                                                                                                    |
| CLI Vitest                           | FAIL         | 12 files pass, 2 fail before collection; 422 collected tests pass; 6.49 s.                                                                                                              |
| E2E discovery                        | PASS         | Existing Playwright configuration lists 96 tests in 10 files. Discovery is not execution.                                                                                               |
| E2E execution                        | NOT VERIFIED | Auth setup launch fails: installed Playwright chromium_headless_shell-1208 executable missing. Temporary config targeted audit-only local port; no browser/dependencies installed.      |
| Gateway live start                   | FAIL         | node packages/gateway/dist/server.js exits 1 with duplicate autonomyRoutes export before listening.                                                                                     |
| Live UI smoke                        | FAIL         | Vite listens at 127.0.0.1:18199, but real browser displays duplicate-declaration error overlay.                                                                                         |
| Database migration/integration       | NOT VERIFIED | Docker CLI exists, daemon pipe missing; no disposable DB available. No schema/data migration was executed.                                                                              |
| Production dependency advisory check | PASS         | 0 advisories, 941 dependencies, registry response obtained after network escalation.                                                                                                    |
| Full dependency advisory check       | FAIL         | 1 high and 2 moderate affected package records, 1,216 dependencies.                                                                                                                     |
| Historical pre-commit heap OOM       | NOT VERIFIED | Historical failure/root cause cannot be established from available evidence; current broad no-fix ESLint run does not reproduce it.                                                     |

Commands used from repository root unless noted:

```powershell
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/gateway/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/cli/tsconfig.json
# Corresponding typechecks use --noEmit.
# From packages/ui:
node ../../node_modules/typescript/bin/tsc -b
node ../../node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
# From each package directory:
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2
# Root:
node node_modules/eslint/bin/eslint.js packages/core/src packages/gateway/src packages/ui/src packages/cli/src --no-fix --max-warnings=0
node scripts/report-code-health.mjs
pnpm audit --prod --json
pnpm audit --json
```

Fresh failure breakdown:

- Core: local-executor.test.ts four Python spawn EPERM failures; conversation-store-ensure-init.test.ts two EPERM mkdir failures under the user's .ownpilot/memory directory. No unrestricted retry wrote there. These six checks remain NOT VERIFIED behaviorally.
- Gateway: workflow-service.test.ts 10/86 fail; autonomy.test.ts 57/62 fail; voice.test.ts 22/22 fail; agents/index.test.ts 8/47 fail; workflows/approvals.test.ts 1/41 fail; escape-hatches.test.ts 1/11 fails; app.test.ts and subpath-smoke.test.ts fail before collection.
- Gateway's three unhandled errors are TypeError: repo.rejectByWorkflow is not a function in workflow test mocks. The method **does exist in source**; do not misreport that mock error as a missing production method.
- UI: AnalyticsPage.test.tsx 6/6 fail with useToast must be used within ToastProvider. The page was replaced while the test still exercises the old API/provider contract; this test failure is distinct from the App.tsx parser blocker.
- CLI: index.test.ts and commands/start.test.ts fail on imported gateway module parsing; the 422 collected tests pass.

A temporary Playwright config initially failed ESM/CJS interop; a second self-contained temporary .mjs config reached browser launch and conclusively failed on the missing executable. No supplied Playwright config was edited. Independently, the available Codex browser loaded the Vite page and observed the actual application parse error.

### v1.1 pre-commit JavaScript heap OOM investigation

**Current reproduction: no OOM. Historical cause: NOT VERIFIED.** The actual hook calls pnpm exec lint-staged. Its TypeScript task is eslint --fix --max-warnings=0 followed by prettier --write. Running the hook would violate report-only constraints; no hook, staging, fixes or --no-verify commit was performed.

Instead, ESLint's real API linted **2,213 TS/TSX files** with fix:false in one process: **33.27 seconds**, **0 errors**, **1 E2E warning**, **173.63 MiB heap used at completion**, **4,288 MiB heap ceiling**, **724,648 KiB peak RSS**. Source-only zero-warning lint also passes. These measurements include a workload much larger than HEAD's two changed source files, but are not the same historical staged set/runtime/fix workload.

Current eslint.config.js uses recommended TypeScript rules **without project/projectService type-aware parsing**. Hook/lint-staged config contains no explicit heap cap or batching control. The v1.1 commit itself changes neither ESLint nor the hook. No historical heap trace, staged-file inventory, exact Node version/options or retained hook failure was found in the inspected evidence. A definitive attribution to typed linting, one file, concurrency or a memory leak would be speculation.

The historical incident is therefore **not proven fixed and not reproduced as currently present**. To establish cause, retain the exact staged list, Node/V8/options, lint-staged debug command/chunk layout, process RSS and an OOM heap profile in a disposable checkout, including fix mode. Do not bypass the commit gate as evidence of quality. Separately, the confirmed exponential ActionLedger growth is a runtime memory bug, not evidence explaining ESLint's historical OOM.

## 4. Security Audit

| Invariant                                     | Status       | Evidence and qualification                                                                                                                                                                                            |
| --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM cannot authorize itself                   | FAIL         | QA-001/005/008 expose authorization boundaries; real model-driven self-approval attack NOT VERIFIED. A foreign authenticated identity can resolve owner's approval.                                                   |
| Tools cannot bypass PolicyEngine              | FAIL         | QA-007: deny-all spy receives zero calls while harmless registry tool executes.                                                                                                                                       |
| Agents cannot elevate privileges              | FAIL         | QA-005/006/007: fixed identities, no grant/lease enforcement, under-classified dispatch. End-to-end malicious-agent escalation NOT VERIFIED.                                                                          |
| Credentials cannot be freely exposed          | FAIL         | QA-008: sandboxed zero-permission tool returns dummy key through real registry.                                                                                                                                       |
| External content is untrusted                 | NOT VERIFIED | DOM sanitization and safe-fetch defenses exist; no full indirect-prompt-injection corpus executed. MCP responses/descriptions and browser/memory content reach agents; policy defects make this especially important. |
| Cancelled tasks invalidate pending approvals  | FAIL         | QA-012: unconditional workflow approval updates and no chat cancellation binding; cancellation/resume race requires real DB confirmation.                                                                             |
| Unknown provider status cannot become SUCCESS | FAIL         | QA-026 drops MCP isError; QA-022 contains simulated success. Unknown/malformed status reconciliation is not implemented in the inspected paths.                                                                       |
| Cross-user/workspace data access is denied    | FAIL         | QA-005 reproduced ledger leak and foreign-user approval; QA-019 browser contexts are shared.                                                                                                                          |
| Untrusted code cannot execute in core process | FAIL         | QA-009: default VM execution in core/gateway process.                                                                                                                                                                 |
| Autonomous execution is resource-limited      | FAIL         | Some executor limits PASS by unit coverage; QA-009/011/027 break the end-to-end invariant.                                                                                                                            |
| High-impact actions are audited               | FAIL         | QA-007/010: no mandatory ActionLedger at every effect, mutable/volatile records, approval-required branches can exit before recording.                                                                                |
| Users can stop autonomous execution           | FAIL         | Stop/cancel methods exist; QA-012/017 show terminal-state/cancellation gaps. Full live stop behavior NOT VERIFIED.                                                                                                    |

Positive bounded evidence: JWT verification uses HS256, requires sub/exp/iat, has maximum token age and a secret-length floor. API key comparison hashes to fixed-size digests and uses timingSafeEqual. UI cookies/CSRF middleware, URL private-address checks, DNS-pinned safeFetch, filesystem realpath checks, shell-free scoped execFile, HTML sanitization, encryption-at-rest, permission helpers and tests all exist. Passing helper suites do not establish safe assembly of these controls.

No real sandbox escape, host-memory exhaustion, external SSRF target or credential was exercised. Browser DNS-rebinding resistance, full prompt injection resistance, SQL behavior against PostgreSQL, and comprehensive XSS/CSRF attacks across rendered pages remain NOT VERIFIED.

## 5. Authentication/Authorization

QA-001 blocks password-only deployments; QA-005 breaks identity isolation even though the lower approval resolver checks its caller. Middleware authenticates a principal, but many routes substitute default/gateway/system identities. API-key identities also use a key-prefix-derived label rather than a user/workspace grant map. JWT validation alone is not authorization.

Session hashing, token randomness and existing UI-session tests are useful foundations. Multi-instance revocation/cache coherence, session fixation across deployment topologies, browser login/logout/password-change flows and network peer binding remain NOT VERIFIED.

## 6. Policy/Risk/Approval Audit

QA-006/007/012/013 describe the central failures. RiskEngine's unknown-capability -> CRITICAL fallback passes a direct probe, but wrong caller mappings defeat meaningful classification. PolicyEngine is deterministic but incomplete; it does not enforce the documented lease/resource/credential authority.

Existing execution approvals implement owner checks, timeout and a single-winner in-memory resolve. Workflow approvals are separate persisted rows. LEO ApprovalRequest/cancelPendingApproval is another separate model with no demonstrated execution integration. Repair the boundaries and unify lifecycle semantics; adding another approval class will not solve these defects.

## 7. Agent Runtime

Core agent/composer suites ran; core build passes. The registry probe demonstrates missing mandatory PolicyEngine enforcement. Generic tool/task/workflow capability labels must not authorize concrete shell, credential, publishing or host effects.

Legacy Claw manager has budget/error/cycle controls and stop mechanisms. Composer has step timeouts, abort propagation and bounded shared history, but no run-wide budget gate before subsequent effects (QA-027). Non-provider local tests cannot establish agent behavior under hostile external content or real provider cancellation.

## 8. Tasks/Workflows/Scheduler

Personal todo TasksRepository, agentic executions, Claw tasks and persistent jobs are different subsystems. Do not equate passing todo CRUD tests with safe autonomous worker execution.

Workflow DAG, retry, explicit approvals and jobified nodes already exist. New policy approval handling creates phantom approval IDs. The generic queue has SKIP LOCKED atomic claims, transaction-based failure handling and a polling reentrancy guard, but these do not provide active-job crash recovery or cancellation fencing (QA-017/018).

Core scheduler has process-local overlap/concurrency guards. No verified cross-node scheduler lease was found in the inspected scheduler path; the production runbook's scale-out advice is unsupported by these guards. Live scheduling with PostgreSQL/providers, DST/timezone cases outside existing unit coverage and multi-node fault recovery remain NOT VERIFIED.

## 9. Memory

Implemented capabilities include persistent memory repositories, hybrid/embedding search, content-hash deduplication, extraction, consolidation, retention and recall; these are **not new-feature gaps**. Relevant gateway suites ran successfully. Repositories usually accept user identity, but memory routes use LOCAL_OWNER_ID (QA-005).

Core archive/restore initialization checks could not create their test directory in the user's home. Actual migrations/vector-index performance, source provenance under prompt injection, cross-workspace memory isolation and multi-process consolidation races remain NOT VERIFIED.

## 10. Tools/MCP/Plugins

Dynamic custom tools execute and can expose undeclared credentials (QA-008). VM execution is the default (QA-009). Legacy plugin middleware and nested-call hard blocks exist but are not a mandatory LEO policy gate.

MCP client/server, reconnect, namespaced tools and presets exist. The client leaks parent environment into stdio children and loses provider isError (QA-025/026). External MCP integration, malicious server descriptions and end-to-end remote endpoint SSRF policy remain NOT VERIFIED. No external server was contacted for security testing.

## 11. Browser/Computer Use

BrowserService is a real Puppeteer integration with private-address interception, timeout handling and stale-session cleanup. It still uses shared browser storage and only checks domain allowlists at initial navigation (QA-019/020). The browser-service launch flags include --no-sandbox; deployment isolation must be verified before treating arbitrary sites as safe.

ComputerService is a separate simulator and broken policy/ledger adapter (QA-004/022), not evidence of working desktop controls. No click/type/shell action on the user's desktop was executed. The local UI browser smoke was read-only.

## 12. Social/Voice

Social models and SocialProvider interface already include connect, validateConnection, publish and checkStatus. Current SocialService invokes a simulator rather than a concrete provider, and its earlier policy/ledger path throws.

Voice has an existing functional service abstraction for transcription/synthesis, but its routes were replaced with session/tool-call stubs while existing UI still calls the old endpoints (QA-014). No microphone, paid provider call or social publishing was used.

## 13. Frontend UX

FAIL at application boot, reproduced visually. Navigation, login, responsive layouts, keyboard focus, screen-reader flows, high-impact approval clarity, cancellation feedback, error boundaries after navigation and long-list rendering cannot receive PASS while the app fails to render.

UI unit tests pass in 115 files, but the app entrypoint is not covered by those mounts. Existing Playwright tests include sidebar and 375px workflow checks; they were discovered, not executed. No UX finding about an unseen screen is asserted.

## 14. Database

PostgreSQL adapter/repositories and a squashed initial schema exist; migration tree contains 41 files including archived migrations. Schema includes jobs availability indexes, task user/status indexes, memory content-hash/GIN/vector indexes and workspace references. Their presence is not proof of migration correctness or query performance.

Confirmed code defects: agent-cache update returns stale data; worker priority/state transitions; URL-only production configuration failure. No database was created, modified or migrated. Docker daemon was unavailable; live transaction semantics, pgvector installation, migration upgrade paths, index plans, backup/restore and RLS guarantees remain NOT VERIFIED.

## 15. Concurrency/Reliability

Confirmed structural issues are in QA-012/015/016/017/018. Existing atomic job claims, stableStringify, workflow locks and approval owner checks should be reused, but each controls a different boundary.

Tool result memoization is neither exactly-once execution nor operation-scoped idempotency. A provider timeout must remain an uncertain outcome until reconciled, especially for publication and email. Cancellation must fence late results as well as stop polling.

## 16. Performance

The strongest measured runtime defect is exponential ActionLedger growth, reproduced with only 20 entries. Returning the full ledger also lacks pagination. Agent cache optimization introduces stale responses. Composer fan-out is not globally capped.

Health script finds 256 production files over 500 LOC, 85 over 800, 28 over 1,000. These are maintenance signals, not benchmark findings. No HTTP percentile/throughput, DB query-plan, UI bundle-size or load-recovery PASS is claimed. The failed Vite build's precache output may include old dist assets and is not a trustworthy fresh bundle measurement.

ESLint memory results and historical OOM limits are documented in section 3.

## 17. Observability

Request IDs, structured logging, authenticated Prometheus route and bounded metric-series tracking already exist. Metrics service maintains per-label histogram sums/counts. Do not recommend recreating those features.

AnalyticsService exposes mock statistics (QA-022). ActionLedger cannot supply durable trustworthy incident evidence (QA-010/011); normal tool audit writes are fire-and-forget and not equivalent to mandatory durable high-impact audit. Sensitive-log redaction and trace completeness across services require further integration validation; no real secrets were printed.

## 18. Dependency Audit

Live registry responses on audit date:

| Scope / package             | Severity                   | Advisory            | Current -> patched |
| --------------------------- | -------------------------- | ------------------- | ------------------ |
| Production dependency graph | PASS                       | None reported       | 941 dependencies   |
| knip -> smol-toml           | HIGH                       | GHSA-7w5x-hrqm-74c2 | 1.7.0 -> >=1.7.1   |
| vitest                      | MEDIUM (registry moderate) | GHSA-82fw-gwwq-j7x9 | 4.1.10 -> >=4.1.11 |
| vitest -> @vitest/mocker    | MEDIUM (registry moderate) | GHSA-82fw-gwwq-j7x9 | 4.1.10 -> >=4.1.11 |

References: https://github.com/advisories/GHSA-7w5x-hrqm-74c2 and https://github.com/advisories/GHSA-82fw-gwwq-j7x9.
The full audit has three affected package records but two unique advisories; QA-024 groups the tooling remediation into one HIGH finding. A clean production audit is time-bound and not proof that every dependency is safe.

Initial restricted-network lookup failed; authorized network escalation succeeded. No dependency/lockfile changes were made. The pnpm major-version mismatch is an environment/reproducibility gap, not an invented vulnerability.

## 19. Confirmed Bugs

Findings include executed reproductions and source-confirmed defects. Each evidence field states which applies; a proposed reproduction involving a DB/provider is not represented as already run. Full runtime exploitability is constrained by the independent startup blockers.

### QA-001 - CRITICAL - Authentication/session security

- **ID:** QA-001
- **Severity:** CRITICAL
- **Category:** Authentication/session security
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/middleware/ui-session.ts:115; packages/gateway/src/app.ts:295
- **Function/class:** createUiSessionMiddleware
- **Evidence:** Isolated Hono request with settingsRepo.get('ui_password_hash') stubbed to a dummy configured value: no header -> 401; Authorization: Bearer fake -> 200; X-API-Key: fake -> 200. Middleware defers header validation, but app installs API auth only when type is not none.
- **Reproduction steps:** Configure UI password with API auth type none. Request any protected /api/v1 endpoint without a cookie, adding an arbitrary Authorization or X-API-Key header. Reproduced against an in-memory protected handler, not a running production server.
- **Expected behavior:** Reject every request without a valid session or a validated alternative credential.
- **Actual behavior:** Arbitrary header presence bypasses the password gate.
- **Root cause:** Session middleware assumes a downstream API authenticator exists even when none is configured.
- **Recommended fix:** Make fallback credential validation explicit; reject header-only requests when API authentication is disabled. Apply to v1, v2 and unsafe methods.
- **Required regression test:** Configured password + auth none: missing, empty, malformed and fake headers all return 401/403; valid session succeeds; test the assembled middleware chain.

### QA-002 - HIGH - Build/runtime architecture

- **ID:** QA-002
- **Severity:** HIGH
- **Category:** Build/runtime architecture
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/routes/index.ts; packages/gateway/src/routes/register/v2.ts; packages/core/package.json; packages/gateway/src/config/defaults.ts
- **Function/class:** route exports and package exports
- **Evidence:** Gateway tsc produced 71 diagnostics. Routes re-export autonomyRoutes and voiceRoutes twice; v2 imports duplicate identifiers. @ownpilot/core/{analytics,autonomy,computer,social,voice} exports are absent; LOCAL_WORKSPACE_ID is imported but not defined. node packages/gateway/dist/server.js exits 1: SyntaxError: Duplicate export of 'autonomyRoutes'.
- **Reproduction steps:** Compile core then gateway with installed TypeScript; run emitted gateway server with local test-only environment.
- **Expected behavior:** Gateway compiles and starts before accepting traffic.
- **Actual behavior:** Compilation fails and Node stops during module linking, before DB startup.
- **Root cause:** New modules were integrated without reconciling existing barrels, export maps and identity constants.
- **Recommended fix:** Reconcile package exports and route registration, then resolve all type errors before deployment.
- **Required regression test:** Build from a clean output directory and import/start the gateway in an isolated smoke test; check both API versions.

### QA-003 - HIGH - Frontend/build/UX

- **ID:** QA-003
- **Severity:** HIGH
- **Category:** Frontend/build/UX
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/ui/src/App.tsx:29; packages/ui/src/constants/nav-items.ts
- **Function/class:** lazy page declarations and navigation imports
- **Evidence:** AnalyticsPage is declared at lines 29, 57 and 160; AutonomyPage at 60 and 163. Navigation also has duplicate identifiers/missing icon exports. UI tsc and Vite build fail. Live browser at http://127.0.0.1:18199/ shows the Vite transform-error overlay.
- **Reproduction steps:** Run UI tsc -b or Vite dev; open the local root page.
- **Expected behavior:** Application shell and routes render.
- **Actual behavior:** Frontend is blocked before normal UI interaction.
- **Root cause:** New page wiring duplicates existing declarations and assumes nonexistent barrel exports.
- **Recommended fix:** Reconcile existing page identities/navigation imports and retain the intended legacy/new routes.
- **Required regression test:** Production build plus browser smoke for root, login and every new navigation target; desktop and mobile.

### QA-004 - HIGH - Social/computer/voice/autonomy runtime contracts

- **ID:** QA-004
- **Severity:** HIGH
- **Category:** Social/computer/voice/autonomy runtime contracts
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/social/service.ts; packages/gateway/src/services/computer/service.ts; packages/gateway/src/services/voice/service.ts; packages/gateway/src/services/autonomy/service.ts
- **Function/class:** publishWithPolicy / executeTaskAction / handleVoiceToolCall / startTask
- **Evidence:** Services use ai.execute/social.write/browser/file_operations instead of Capability values; pass nonexistent identity.permissions/context fields; do not await ActionLedger.record; call nonexistent ActionLedger.updateResult. Dummy publishWithPolicy('qa','qa',...) throws 'ActionLedger.updateResult is not a function'.
- **Reproduction steps:** Call each service with dummy user/workspace and inert local inputs. Social failure was executed; other incompatible calls are source/typecheck confirmed.
- **Expected behavior:** Valid capability classification and a returned denied/pending/success result with reliable audit recording.
- **Actual behavior:** Even approval-required paths throw instead of returning structured outcomes. Social content/computer tasks can remain publishing/running after route-level mutation.
- **Root cause:** Service implementations target a different ledger/identity contract from the actual core implementation.
- **Recommended fix:** Use canonical capability types, await recording and implement a coherent audit result lifecycle; return validated terminal or pending states.
- **Required regression test:** Real core imports with no ledger mocks: denied, approval-required, success and provider exception cases; assert persisted/returned status agrees.

### QA-005 - HIGH - Cross-user/workspace authorization

- **ID:** QA-005
- **Severity:** HIGH
- **Category:** Cross-user/workspace authorization
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/routes/ledger.ts:11; packages/gateway/src/routes/execution-permissions.ts:90; packages/gateway/src/routes/memories.ts; packages/gateway/src/routes/agentic.ts
- **Function/class:** ledgerRoutes / approval resolver / owner-bound routes
- **Evidence:** ledgerRoutes returns every entry without identity filtering. Dummy qa-a request returned qa-b's ledger data. An approval owned by LOCAL_OWNER_ID was successfully resolved (HTTP 200, true) in a Hono request whose authenticated userId was different-user. Route substitutes LOCAL_OWNER_ID. Memory and new social/computer/voice routes similarly use fixed owners; agentic tasks use userId gateway.
- **Reproduction steps:** Seed dummy ledger/approval data in process; mount real routes with middleware setting another userId; GET ledger or POST approval resolve.
- **Expected behavior:** Caller identity and workspace membership determine access; foreign approval/data access is denied.
- **Actual behavior:** Caller identity is ignored in multiple sensitive routes.
- **Root cause:** Single-owner assumptions remain beneath API-key/JWT identities and claimed workspace isolation.
- **Recommended fix:** Propagate verified identity/workspace end to end; enforce ownership at service/repository boundaries. If deliberately single-owner, explicitly reject additional identities rather than accepting misleading isolation.
- **Required regression test:** Two users/two workspaces against actual route composition: list/get/update/delete/approve cannot access the other user's records.

### QA-006 - HIGH - PolicyEngine/capabilities

- **ID:** QA-006
- **Severity:** HIGH
- **Category:** PolicyEngine/capabilities
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/security/policy-engine.ts:28; packages/core/src/security/capabilities.ts
- **Function/class:** PolicyEngine.evaluate / isLeaseValid
- **Evidence:** Engine checks only nonempty userId/workspaceId, supplied risk and selected capabilities. Empty-role identity accessing qa-b/private returns ALLOW for memory.read. credential.read with caller-supplied LOW returns ALLOW. Production shell.execute with CRITICAL returns REQUIRE_APPROVAL before reaching production DENY.
- **Reproduction steps:** Evaluate the engine with the dummy PolicyRequest examples in the evidence appendix.
- **Expected behavior:** Validate membership, capability grants/lease, resource scope and actual risk; unconditional production restrictions take precedence.
- **Actual behavior:** Nonempty strings act as authority; ungranted actions allow and production deny is shadowed.
- **Root cause:** Policy criteria documented for roles/resources/leases are not implemented, and risk guards precede hard denies.
- **Recommended fix:** Derive risk from trusted action metadata; validate grants and resource ownership; order absolute denies first; reject unknown/unbound requests.
- **Required regression test:** Matrix of forged identities, empty roles, foreign resources, expired/revoked leases, invalid risk, and production host actions.

### QA-007 - HIGH - Tool execution/policy bypass/risk

- **ID:** QA-007
- **Severity:** HIGH
- **Category:** Tool execution/policy bypass/risk
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/agent/tools.ts:366; packages/gateway/src/services/tool/service.ts:36; packages/gateway/src/services/tool/executor.ts:589; packages/core/src/agentic/composer.ts:533; packages/gateway/src/services/workflow/workflow-dispatch.ts:180
- **Function/class:** ToolRegistry.execute / ToolService.execute / dispatchStep / dispatchNode
- **Evidence:** Replacing PolicyEngine.evaluate with a deny-all spy did not stop a harmless ToolRegistry execution; spy call count was zero. ToolService directly invokes registry without execSource; executor checks legacy permission only if execContext exists. Composer maps tools:* to LOW task.execute; workflow tool nodes default to MEDIUM workflow.execute irrespective of actual tool.
- **Reproduction steps:** Register an inert local tool, set a deny-all policy spy, execute through registry. Trace ToolService without execSource and a high-impact workflow tool node.
- **Expected behavior:** Every effectful tool crosses the same mandatory policy boundary with its real capability.
- **Actual behavior:** Policy is optional at selected orchestration entry points, and broad labels under-classify actual actions.
- **Root cause:** Policy was added around containers rather than at the final effect boundary; legacy permission systems coexist.
- **Recommended fix:** Integrate one mandatory effect-level guard and trusted action metadata, preserving existing tool-group/CLI/custom-tool restrictions.
- **Required regression test:** Deny-all policy prevents effects through chat, workflow, scheduler, MCP, plugin fallback, nested callTool and direct service paths; publishing/credential tools retain correct risk.

### QA-008 - CRITICAL - Secrets/credential exposure

- **ID:** QA-008
- **Severity:** CRITICAL
- **Category:** Secrets/credential exposure
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/agent/tools.ts:377; packages/core/src/agent/tools/dynamic-tool-executor.ts:102
- **Function/class:** ToolRegistry.execute config accessors / executeDynamicTool
- **Evidence:** A sandboxed custom tool with permissions: [] and no configRequirements executed return utils.getApiKey('other-service') and returned QA_DUMMY_SECRET through the real registry and real VM executor. Registry's restriction is conditional on allowedServices being defined, so omitting declarations grants broad access.
- **Reproduction steps:** Register an untrusted custom tool without configRequirements; supply a fake ConfigCenter returning only a dummy key; execute the tool and inspect returned content.
- **Expected behavior:** Undeclared service credentials are denied; secret material never becomes model-visible tool output.
- **Actual behavior:** An untrusted zero-permission tool obtains an unrelated dummy API key.
- **Root cause:** Fail-open optional service allowlist plus raw credential helpers exposed to tool code.
- **Recommended fix:** Treat absent declarations as an empty allowlist; bind grants to user/workspace/action and provide opaque credential use where possible; enforce secret-output protection.
- **Required regression test:** Real registry + sandbox integration: absent/empty/foreign requirements cannot read key, full config, entries or fields; declared access cannot exfiltrate raw secrets in output.

### QA-009 - HIGH - Untrusted code isolation/resource limits

- **ID:** QA-009
- **Severity:** HIGH
- **Category:** Untrusted code isolation/resource limits
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/agent/tools/dynamic-tool-executor.ts:32; packages/gateway/src/services/workflow/executors/utils.ts:42; packages/gateway/src/services/extension/sandbox.ts
- **Function/class:** executeDynamicTool / safeVmEval / extension sandbox
- **Evidence:** Dynamic tools default to createSandbox (node:vm); Worker path is opt-in via OWNPILOT_TOOL_SANDBOX=worker. Source explicitly notes VM cannot enforce maxMemory. Workflow expressions also execute vm.runInContext in gateway process. Benign dynamic-tool execution was reproduced.
- **Reproduction steps:** Inspect default environment branch and run an inert custom tool. No destructive heap-exhaustion or sandbox-escape payload was executed.
- **Expected behavior:** Untrusted code executes outside the core process with enforceable memory/CPU/time and narrow IPC capabilities.
- **Actual behavior:** Default untrusted code executes in the host process; declared VM memory limit is not an isolation boundary.
- **Root cause:** Performance/compatibility default retained a VM execution path.
- **Recommended fix:** Use a separate constrained process/container for untrusted code; do not describe worker_threads as complete process isolation; fail closed if required isolation is unavailable.
- **Required regression test:** Child/container resource-limit tests, host-survival after child OOM/timeout, and denied host/global access; exercise default configuration.

### QA-010 - HIGH - ActionLedger integrity/durability

- **ID:** QA-010
- **Severity:** HIGH
- **Category:** ActionLedger integrity/durability
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/security/action-ledger.ts:32; packages/gateway/src/routes/ledger.ts
- **Function/class:** ActionLedger.record / getEntries / getByWorkspaceId
- **Evidence:** Entries live in static arrays/maps; hash is Base64 of selected fields. Altering resource on an entry returned by getEntries changed stored data while hash stayed unchanged. getByWorkspaceId exposes the original array; clear() removes history. No persistent ledger repository or verification path is wired.
- **Reproduction steps:** Record a dummy entry; mutate returned resource/result; compare stored record/hash. Start another process to observe empty static state.
- **Expected behavior:** Durable append-only records cover all security-relevant fields and make tampering detectable.
- **Actual behavior:** Records are mutable, partly uncovered by the encoding and lost on process restart.
- **Root cause:** Test-like in-memory audit implementation remains the production-facing ledger.
- **Recommended fix:** Persist canonical records transactionally with cryptographic fixed-size hashes, append-only access and verification; return immutable copies; cover denied/pending/error outcomes.
- **Required regression test:** Restart retention, concurrent append, tampering of every field, immutable reads and audit-write failure behavior.

### QA-011 - HIGH - Performance/availability

- **ID:** QA-011
- **Severity:** HIGH
- **Category:** Performance/availability
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/security/action-ledger.ts:48
- **Function/class:** ActionLedger.record
- **Evidence:** Each new hash Base64-encodes the entire previous Base64 hash. Measured hash lengths at entries 1/5/10/20: 96/872/4512/84496 bytes. Previous hashes and entries remain retained; GET ledger serializes the full history.
- **Reproduction steps:** Append at most 20 harmless entries in an isolated process and record hash lengths. Stop before stressing host memory.
- **Expected behavior:** Fixed-size hash and bounded/paginated access; linear storage growth.
- **Actual behavior:** Hash length follows roughly H(n)=4/3*(H(n-1)+payload), causing exponential growth.
- **Root cause:** The predecessor is recursively embedded instead of digested; v1.1 indexes do not address this.
- **Recommended fix:** Hash canonical record plus fixed-size predecessor digest using SHA-256 or an appropriate authenticated construction; paginate persisted queries.
- **Required regression test:** Thousands of entries retain constant digest length and linear storage, with bounded list response sizes.

### QA-012 - HIGH - Approval replay/cancellation

- **ID:** QA-012
- **Severity:** HIGH
- **Category:** Approval replay/cancellation
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/db/repositories/workflows/approvals.ts:119; packages/gateway/src/services/workflow/workflow-service.ts:948; packages/gateway/src/services/permission/execution-approval.ts:68; packages/gateway/src/services/chat/streaming.ts:73
- **Function/class:** decide / cancelExecution / createApprovalRequest
- **Evidence:** Workflow decide unconditionally updates by id/user without status=pending, expiry or cancelled-run condition. Cancellation schedules rejection asynchronously. Streaming pending approvals have no run/task/AbortSignal binding; source has no cancellation hook. A detached aborted test signal does not invalidate a pending request (late resolution true), demonstrating absence of API binding, not an end-to-end cancelled-task exploit.
- **Reproduction steps:** Create pending workflow approval; reject/cancel then approve same ID; inspect unconditional SQL. For chat, cancel the originating stream while approval is pending and attempt late resolution (full assembled runtime blocked).
- **Expected behavior:** Cancelled/expired/decided approvals are terminal and cannot authorize execution; one decision wins.
- **Actual behavior:** Repository permits replay/overwriting rejected approvals; chat approval API cannot associate cancellation with pending approvals.
- **Root cause:** Approval state changes are not atomic conditional transitions tied to run lifecycle.
- **Recommended fix:** Compare-and-set pending/unexpired status; atomically invalidate by run and recheck before effects; bind chat approval waits to AbortSignal.
- **Required regression test:** Concurrent approve/reject, approval after cancellation/expiry, stream abort, duplicate decisions, and cancellation-versus-resume race.

### QA-013 - HIGH - Workflow policy approval liveness

- **ID:** QA-013
- **Severity:** HIGH
- **Category:** Workflow policy approval liveness
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/workflow/workflow-dispatch.ts:212
- **Function/class:** dispatchNode
- **Evidence:** REQUIRE_APPROVAL throws ApprovalPauseError('policy-req-'+UUID) without inserting an approval record. In contrast, explicit approvalNode code later calls approvalRepo.create. A codeNode is classified shell.execute, which always reaches REQUIRE_APPROVAL with current RiskEngine/PolicyEngine.
- **Reproduction steps:** Execute a non-dry-run workflow codeNode; inspect paused approval ID and query the approvals repository for it.
- **Expected behavior:** Pause on a real scoped approval that an authorized user can resolve.
- **Actual behavior:** Policy pause references a nonexistent approval; there is no policy approval continuation token consumed by dispatch.
- **Root cause:** New pre-dispatch policy branch bypasses the established approval persistence path.
- **Recommended fix:** Create a scoped immutable approval request, persist it, and consume a verified decision when resuming; enforce production denial first.
- **Required regression test:** Policy-required workflow node pauses, appears in approvals, resumes exactly once for unchanged args, and cannot resume after cancel.

### QA-014 - HIGH - Voice/autonomy API regression

- **ID:** QA-014
- **Severity:** HIGH
- **Category:** Voice/autonomy API regression
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/routes/voice.ts; packages/gateway/src/routes/autonomy.ts; packages/ui/src/api/endpoints/voice.ts
- **Function/class:** voiceRoutes / autonomyRoutes
- **Evidence:** Existing voice service still implements transcription/synthesis and UI calls /voice/config, /voices, /transcribe and /synthesize; replacement route only exposes sessions/tool_call. All 22 voice route tests fail. 57/62 autonomy route tests fail, mostly 404 for config/levels/assess/approval/tool-permission APIs.
- **Reproduction steps:** Run routes/voice.test.ts and routes/autonomy.test.ts or request established endpoints on isolated mounted routes.
- **Expected behavior:** Existing voice and autonomy APIs remain available or are deliberately versioned with migrated callers.
- **Actual behavior:** MVP replacement routes remove interfaces still used by UI/tests.
- **Root cause:** New feature work replaced existing route modules instead of extending/versioning them.
- **Recommended fix:** Restore/version established contracts and wire actual voice service; integrate new task/session APIs without hiding prior capability.
- **Required regression test:** Contract tests for every existing endpoint plus UI voice/config and human-approval flows on both API versions.

### QA-015 - MEDIUM - v1.1 cache consistency

- **ID:** QA-015
- **Severity:** MEDIUM
- **Category:** v1.1 cache consistency
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/db/repositories/agents/index.ts:136
- **Function/class:** AgentsRepository.update
- **Evidence:** update invalidates cache, calls getById (recaches old row), performs UPDATE, then calls getById again. In-memory DB adapter probe: stored row new, update return old, next read old. Existing test expects UpdatedBot and receives TestAgent.
- **Reproduction steps:** Use fake queryOne/execute over one row; warm cache, update name, inspect returned and next-read record.
- **Expected behavior:** Successful update immediately returns the new configuration.
- **Actual behavior:** Old agent configuration is served for up to 60 seconds.
- **Root cause:** Invalidation occurs before a pre-update read that repopulates the cache.
- **Recommended fix:** Invalidate after commit or replace cache from UPDATE RETURNING; bound cache and clarify cross-process consistency.
- **Required regression test:** Warm/cold updates for all fields, concurrent reads during update, delete/recreate, and rollback do not return stale state.

### QA-016 - HIGH - Idempotency/retries

- **ID:** QA-016
- **Severity:** HIGH
- **Category:** Idempotency/retries
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/tool/executor.ts:608; packages/gateway/src/db/repositories/idempotency-keys.ts
- **Function/class:** executeTool / getRecord / setRecord
- **Evidence:** Every tool invocation hashes user+name+args into a 24-hour result-cache key. Lookup precedes execution; record is stored fire-and-forget afterward. No atomic in-flight claim. Failures are cached too. Static trace confirms identical intended operations collapse, while concurrent misses can both execute.
- **Reproduction steps:** With a fake side-effect counter and empty repository, launch two same-argument calls concurrently; then repeat an intentionally new call after storing a result. Real DB concurrency was not run.
- **Expected behavior:** Caller-scoped operation IDs deduplicate retries of one operation, not distinct operations; concurrent retries cause one effect.
- **Actual behavior:** Read results may be stale for a day, intended repeated sends may be suppressed, and concurrent duplicates are not prevented.
- **Root cause:** Result memoization is used as idempotency without operation identity or atomic reservation.
- **Recommended fix:** Require operation/run key for effects, atomically claim it, define failure/unknown-state retry policy, and use separate freshness-aware read caching.
- **Required regression test:** Two concurrent requests with one operation key produce one effect; different keys with same args produce two; failures/unknown outcomes are reconciled safely.

### QA-017 - HIGH - Worker cancellation/failure recovery

- **ID:** QA-017
- **Severity:** HIGH
- **Category:** Worker cancellation/failure recovery
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/db/repositories/jobs.ts:80; packages/gateway/src/db/repositories/jobs.ts:204; packages/gateway/src/services/job-queue-service.ts:147
- **Function/class:** claimJob / complete / fail / stopWorker
- **Evidence:** claimJob selects only available rows; no active-job lease expiry/reclaim path found in job repository/service. complete and fail write without active-status fencing. Captured SQL shows cancel followed by complete can overwrite cancelled. stopWorker does not abort its active handlers; shutdown stops polling without awaiting them. Worker handler comment claims active jobs are reclaimed, but SKIP LOCKED alone cannot do that.
- **Reproduction steps:** Claim a test job, simulate worker loss, then inspect next claim; cancel a running job and let handler complete. SQL capture verified missing predicates; crash/restart with real PostgreSQL NOT VERIFIED.
- **Expected behavior:** Cancellation remains terminal; stale worker completion is rejected; abandoned active jobs recover under a bounded lease.
- **Actual behavior:** Late completion can replace cancellation; orphan active jobs have no demonstrated recovery path.
- **Root cause:** No lease/fencing token, conditional terminal-state writes or running-handler drain/abort protocol.
- **Recommended fix:** Add durable claim leases/fencing, conditional completion/failure, cancellation propagation and bounded shutdown drain.
- **Required regression test:** Worker crash/restart, cancel-vs-complete/fail, lease expiry and stale worker results against real PostgreSQL.

### QA-018 - MEDIUM - Worker priority starvation

- **ID:** QA-018
- **Severity:** MEDIUM
- **Category:** Worker priority starvation
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/job-queue-service.ts:189; packages/gateway/src/db/repositories/jobs.ts:87
- **Function/class:** pollWorker / enqueueSystem / claimJob
- **Evidence:** enqueueSystem assigns priority 100, but every worker calls claimJob(queue,0); SQL requires priority <= $2. Captured system claim parameters are ['system',0].
- **Reproduction steps:** Enqueue a system job or any positive-priority job and start a worker for its queue.
- **Expected behavior:** Higher priority jobs are claimed before lower priority eligible jobs.
- **Actual behavior:** Positive-priority jobs are excluded by the default worker threshold.
- **Root cause:** Priority selection is implemented as a ceiling fixed to zero rather than ordering over eligible jobs.
- **Recommended fix:** Remove the unintended ceiling or make it an explicit compatible worker policy.
- **Required regression test:** Queue priorities -1,0,1,100 and verify all execute in documented order, including enqueueSystem.

### QA-019 - HIGH - Browser isolation

- **ID:** QA-019
- **Severity:** HIGH
- **Category:** Browser isolation
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/browser-service.ts:658
- **Function/class:** BrowserService.getOrCreatePage
- **Evidence:** Per-user sessions are separate Page objects created by browser.newPage() on one shared Browser; no per-user BrowserContext is created. Browser default-context pages share cookies/storage. Existing browser tests mock page/browser behavior rather than demonstrate separate storage.
- **Reproduction steps:** With a local test origin, set a cookie in user A's page, then open user B's page in the same service and read it. This browser-service integration scenario is source-confirmed by context construction; live two-user Chromium test NOT VERIFIED.
- **Expected behavior:** Users/workspaces have isolated browser cookie, localStorage and permission contexts.
- **Actual behavior:** Page-map separation does not isolate browser storage.
- **Root cause:** User identity indexes pages but not browser contexts.
- **Recommended fix:** Create/dispose separate browser contexts per authorized user/workspace; avoid shared profiles and retain request security checks.
- **Required regression test:** Two users visit the same local origin; cookies, localStorage, downloads and authentication never cross contexts.

### QA-020 - MEDIUM - Browser domain policy

- **ID:** QA-020
- **Severity:** MEDIUM
- **Category:** Browser domain policy
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/browser-service.ts:685; packages/gateway/src/services/browser-service.ts:788
- **Function/class:** request interceptor / validateUrl
- **Evidence:** Configured allowed_domains is checked in validateUrl for initial navigate. Request interception only checks blocked/private URLs. Click/back/redirect requests do not reapply allowed_domains.
- **Reproduction steps:** Configure one local test hostname as allowed; navigate to its page with a redirect or link to a second public-address test hostname. No external redirect was followed during audit.
- **Expected behavior:** Domain restriction applies to subsequent navigations and redirects.
- **Actual behavior:** Allowed initial page can navigate to a non-allowlisted public destination.
- **Root cause:** Navigation-entry validation is not enforced at the browser request boundary.
- **Recommended fix:** Apply explicit top-level/frame navigation allowlist policy during interception and define subresource rules.
- **Required regression test:** Initial, redirected, clicked, popup and back/forward navigations across allowed/denied origins.

### QA-021 - HIGH - Rate limiting/proxy trust/CSRF

- **ID:** QA-021
- **Severity:** HIGH
- **Category:** Rate limiting/proxy trust/CSRF
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/utils/client-ip.ts:42; packages/gateway/src/utils/trusted-proxy.ts:32; packages/gateway/src/middleware/rate-limit.ts:24
- **Function/class:** isProxyAwareConfigured / getClientIp / getRequestOrigin
- **Evidence:** TRUSTED_PROXY_IPS is only tested for nonempty configuration; socket peer is never compared. With configured allowlist 192.0.2.1, dummy header X-Forwarded-For:127.0.0.1 returns loopback, which rate limiter exempts. Forwarded host/proto use the same configuration-only trust.
- **Reproduction steps:** Enable proxy mode with a nonempty IP list; send a direct local test request with forged forwarded headers. Helper reproduction returned 127.0.0.1 despite no authenticated peer.
- **Expected behavior:** Only requests arriving from an allowlisted immediate peer may supply trusted forwarded identity/origin.
- **Actual behavior:** Directly reachable gateway accepts forged headers, allowing rate-limit bypass and undermining origin checks.
- **Root cause:** Configuration presence substitutes for transport peer verification.
- **Recommended fix:** Use actual peer address from server bindings; only honor sanitized proxy headers from trusted peers. Retain network isolation as defense in depth.
- **Required regression test:** Untrusted direct peer cannot alter IP/origin or bypass throttling; trusted proxy tests include multiple XFF hops and loopback spoofing.

### QA-022 - MEDIUM - Observability/product correctness

- **ID:** QA-022
- **Severity:** MEDIUM
- **Category:** Observability/product correctness
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/analytics/service.ts:13; packages/gateway/src/services/social/service.ts:89; packages/gateway/src/services/computer/service.ts:115
- **Function/class:** AnalyticsService / simulateProviderPublish / simulateProviderExecution
- **Evidence:** Analytics constructor inserts fabricated task/cost history; getUsageStats returns fixed 94.5% success, +5 tasks, +2.1 dollars and 3 agents. Direct dummy simulator calls return success and invented social URL/screenshot without a provider. Current policy/ledger errors block normal service execution first (QA-004), so no actual published-content success is claimed.
- **Reproduction steps:** Instantiate analytics with no real records; inspect statistics. Call private emitted simulator methods with inert QA inputs.
- **Expected behavior:** Show real data or explicitly unavailable/demo state; provider success requires verifiable provider evidence.
- **Actual behavior:** Production-facing implementations contain plausible fabricated metrics and success results.
- **Root cause:** Demo implementations were wired into product APIs without explicit demo gating.
- **Recommended fix:** Derive metrics from real records and return unavailable/pending for missing providers; keep demo fixtures outside production services.
- **Required regression test:** Empty installation yields zero/unknown metrics; missing/unknown provider response never yields confirmed success or invented URLs.

### QA-023 - MEDIUM - Database configuration

- **ID:** QA-023
- **Severity:** MEDIUM
- **Category:** Database configuration
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/db/adapters/types.ts:145
- **Function/class:** getDatabaseConfig
- **Evidence:** With NODE_ENV=production and a dummy strong DATABASE_URL but no POSTGRES_PASSWORD, getDatabaseConfig throws that POSTGRES_PASSWORD is the documented default. No connection was attempted.
- **Reproduction steps:** Set only a valid production-style DATABASE_URL in an isolated process; unset POSTGRES_PASSWORD; call getDatabaseConfig.
- **Expected behavior:** Validate credentials from the effective selected connection configuration.
- **Actual behavior:** An unused fallback password prevents URL-only deployment.
- **Root cause:** Default-password guard checks POSTGRES_PASSWORD before accounting for DATABASE_URL precedence.
- **Recommended fix:** Validate the effective URL/password; retain rejection of actual default/empty credentials.
- **Required regression test:** URL-only strong/default/empty credentials; split-variable credentials; URL versus split-variable precedence.

### QA-024 - HIGH - Dependency vulnerabilities (development tooling)

- **ID:** QA-024
- **Severity:** HIGH
- **Category:** Dependency vulnerabilities (development tooling)
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** pnpm-lock.yaml; package.json
- **Function/class:** knip / smol-toml / vitest / @vitest/mocker
- **Evidence:** Live pnpm audit --prod: 0 advisories across 941 dependencies. Full audit: smol-toml 1.7.0 via knip HIGH GHSA-7w5x-hrqm-74c2 (patched >=1.7.1); vitest and @vitest/mocker 4.1.10 MODERATE GHSA-82fw-gwwq-j7x9 (patched >=4.1.11). Three affected package records, two distinct advisories.
- **Reproduction steps:** Run pnpm audit --prod --json and pnpm audit --json against advisory registry. Both were run; no packages installed.
- **Expected behavior:** No known advisories within the checked dependency scope.
- **Actual behavior:** Development tooling retains DoS and arbitrary-file-read advisories; production audit is clean at audit time.
- **Root cause:** Locked development dependency versions precede advisory fixes.
- **Recommended fix:** Update affected tooling/transitive dependencies in a separate change and rerun lockfile/build/tests; avoid exposing Vitest services to untrusted clients meanwhile.
- **Required regression test:** Full dependency audit passes and toolchain checks run on the updated lockfile. No exploit against external systems required.

### QA-025 - HIGH - MCP credentials/process boundaries

- **ID:** QA-025
- **Severity:** HIGH
- **Category:** MCP credentials/process boundaries
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/mcp/client.ts:304
- **Function/class:** McpClientService.createTransport
- **Evidence:** stdio child environment spreads all process.env before server.env. This exposes gateway database/encryption/provider secrets to every configured MCP child, beyond the server's explicit grant.
- **Reproduction steps:** In a disposable test process set QA_SENTINEL_SECRET, construct an inert stdio MCP child that reports only presence of this dummy variable. Source trace confirms inheritance; no real credential child was launched.
- **Expected behavior:** MCP child receives minimal platform environment plus its explicit scoped credentials.
- **Actual behavior:** Every environment secret is inherited by third-party MCP code.
- **Root cause:** Convenient full environment passthrough bypasses credential scoping.
- **Recommended fix:** Allowlist required platform variables and explicit per-server secrets; audit secret grants without logging values.
- **Required regression test:** Dummy gateway-only secret absent in child; explicitly granted dummy secret present; required process startup variables preserved.

### QA-026 - HIGH - MCP provider status/reliability

- **ID:** QA-026
- **Severity:** HIGH
- **Category:** MCP provider status/reliability
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/gateway/src/services/mcp/client.ts:211; packages/gateway/src/services/mcp/client.ts:380
- **Function/class:** McpClientService.callTool / registered MCP executor
- **Evidence:** Injected local fake client returns {isError:true,content:[{type:'text',text:'QA provider failed'}]}; callTool returns just 'QA provider failed'. Registered executor wraps returned text as {content} with no isError; no exception means tool success.
- **Reproduction steps:** Use fake connected client with MCP error result; invoke callTool and registered executor. Error flag loss was reproduced without a network server.
- **Expected behavior:** Provider-declared failure/unknown status propagates as failure/unknown.
- **Actual behavior:** Provider failure becomes a normal tool result and downstream success.
- **Root cause:** Text extraction discards structured MCP status before execution result mapping.
- **Recommended fix:** Preserve typed result status and content; validate malformed/unknown responses before declaring success.
- **Required regression test:** Provider isError=true, malformed response, transport error and valid success retain distinct outcomes through workflow/ledger/UI.

### QA-027 - MEDIUM - Autonomous resource limits

- **ID:** QA-027
- **Severity:** MEDIUM
- **Category:** Autonomous resource limits
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** packages/core/src/agentic/composer.ts:357
- **Function/class:** AgenticOrchestrator.executePlan / executeStep
- **Evidence:** Composer launches every ready step through Promise.allSettled(ready.map(...)); accumulates totalCostUsd but does not check it against task constraints before subsequent dispatch. Router forwards constraints and some concrete executors enforce their own limits, but composer has no global budget/concurrency gate.
- **Reproduction steps:** Use a fake plan with many independent steps and a fake step handler returning cost above maxCostUsd; observe dispatch count and subsequent steps. Source-reviewed; stress/load execution NOT VERIFIED.
- **Expected behavior:** Orchestrator bounds concurrent effects and enforces run-wide budget, including retries/fallbacks.
- **Actual behavior:** Per-executor limits do not enforce a total composed-task ceiling.
- **Root cause:** Resource constraints are descriptive/forwarded rather than enforced at the orchestration boundary.
- **Recommended fix:** Gate readiness through bounded scheduling and atomic budget reservations; abort/stop new dispatch when limits are reached.
- **Required regression test:** Fake wide DAG never exceeds configured concurrency; costs across branches/retries hit one shared cap and cancellation prevents further work.

### QA-028 - LOW - Documentation/implementation drift

- **ID:** QA-028
- **Severity:** LOW
- **Category:** Documentation/implementation drift
- **Status:** FAIL (evidence below distinguishes executed reproduction from source review)
- **File/path:** docs/implementation/LEO_POLICY_ENGINE.md; docs/implementation/LEO_ACTION_LEDGER.md; docs/implementation/LEO_CREDENTIAL_SECURITY.md; docs/PRODUCTION_RUNBOOK.md; .env.example
- **Function/class:** security contracts / runbook / escape-hatch documentation
- **Evidence:** Policy docs list lease/credential/resource/approval checks absent in engine; ledger docs prohibit history mutation while runtime allows it; credential docs prohibit the reproduced key leak. Runbook suggests scheduler horizontal scaling with locks, while core scheduler uses process-local runningTasks. escape-hatches test fails because OWNPILOT_ALLOW_LOCAL_LLM_URL is absent from .env.example. Versioned commit v1.1 remains package version 0.8.3.
- **Reproduction steps:** Compare cited docs with corresponding source and run config/escape-hatches.test.ts. Do not interpret aspirational documents as implementation evidence.
- **Expected behavior:** Documentation clearly separates implemented behavior, requirements and unsupported deployment modes.
- **Actual behavior:** Security/deployment claims overstate current behavior; configuration registry and example drift.
- **Root cause:** Phase documentation was not maintained as executable acceptance criteria.
- **Recommended fix:** Label requirements versus verified implementation and update runbook/config docs after actual fixes; link claims to regression checks.
- **Required regression test:** Configuration registry/example parity and security acceptance tests referenced from release documentation.

## 20. Missing Test Coverage

Required tests are specified per finding. Highest-value gaps are assembled middleware with every authentication configuration; two-principal actual routes; real registry+VM credential access; policy coverage at the final effect; workflow replay/cancel/expiry; job lease/fencing and atomic idempotency against PostgreSQL; MCP error preservation; browser-context storage isolation; and importing/rendering real application entrypoints.

Current mocks hide important boundaries: dynamic-tool executor unit tests mock the sandbox; browser tests mock browser contexts; workflow tests omit rejectByWorkflow on a fake repository; AnalyticsPage tests no longer match providers/API calls. Vitest's 'Type Errors no errors' footer is not a substitute for the failing package tsc checks.

NOT VERIFIED: full coverage percentages/thresholds (coverage mode not run), all E2E tests, real migrations, crash-recovery fault injection, distributed race tests, real provider semantics and accessibility/responsive acceptance.

## 21. Technical Debt

Most urgent debt is the duplicate security/runtime architecture, not file length. Canonical Capability/Identity/ActionLedger contracts have diverged from service consumers. Fixed-owner routing is incompatible with cross-user claims. Demo values and in-memory stores are exposed through production-facing endpoints.

Dead-code absence was not proven. Static references show the old voice service and old autonomy infrastructure remain while route contracts are removed; LEO lease/cancel helpers are not wired as universal execution controls. Five TODO/FIXME-style production matches are not an inventory of all unfinished work.

## 22. Improvements

1. Restore compilable, renderable entrypoints and preserve existing API contracts; rerun the currently failing suites before adding features.
2. Fix auth-none fallback and bind verified principals through routes, services, approvals and repositories; keep a two-user integration fixture.
3. Put PolicyEngine, real capability classification, credential grants and immutable approvals at the final effect boundary.
4. Reuse the existing core audit SHA-256/verification foundations when making ActionLedger durable; do not retain its Base64 chain.
5. Repair atomic approval/job/idempotency state transitions and agent cache invalidation; test actual DB concurrency in a disposable environment.
6. Wire existing voice/browser/provider interfaces to real implementations with honest unavailable/unknown states; replace fabricated analytics with existing metrics/audit data.
7. Reproduce builds with pinned pnpm, address the development advisories, and make fresh app-import/browser smoke part of release validation.

These are repairs to existing capabilities, not proposals for parallel frameworks.

## 23. New Feature Recommendations

**One narrowly scoped addition: a durable uncertain-outcome reconciliation queue for publishing.** Verify an action by operation ID when a provider times out after possibly accepting it, retain UNKNOWN/PENDING rather than reporting success/failure prematurely, and let the operator reconcile before retrying.

Existence check: SocialProvider already has checkStatus(providerPostId, accessToken), so a status-check API is **not** new. However, SocialPublishResult is boolean success plus optional error/retryable; SocialService is a simulator with no durable operation receipt/reconciliation loop. The recommendation is the missing durable lifecycle for ambiguous outcomes, including cases where no providerPostId was returned. Implement only after QA-004/010/016 are fixed.

Not recommended as new features: memory extraction/consolidation, metrics, job queues, browser automation, voice transcription, or cryptographic audit verification; source already contains them.

## 24. Documentation/Implementation Drift

| Claim/source                                                                      | Verified implementation                                                                              |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| LEO_POLICY_ENGINE lists resource, grants, lease, credential and approval criteria | PolicyEngine checks nonempty IDs and a few risk branches (QA-006).                                   |
| LEO_ACTION_LEDGER requires tamper evidence/no history edits                       | In-memory mutable objects and Base64 pseudo-hash (QA-010/011).                                       |
| LEO_CREDENTIAL_SECURITY says keys never reach LLM                                 | Dummy key returned by untrusted tool (QA-008).                                                       |
| Worker handler comment says active jobs reclaimed through SKIP LOCKED             | claimJob only selects available rows; no inspected active-job reclaimer (QA-017).                    |
| Production runbook suggests scheduler horizontal scaling via locks                | Inspected scheduler guard is process-local; distributed operation NOT VERIFIED.                      |
| Core sandbox comment describes worker-based process isolation                     | worker_threads are not separate OS processes; default dynamic path is VM.                            |
| v1.1 production performance/rate-limit commit label                               | HEAD changes ledger indexes and agent caching, with cache regression; package version remains 0.8.3. |
| Supplied Vite 7 architecture summary                                              | Actual package is Vite 8.0.16.                                                                       |
| Escape-hatch registry documents OWNPILOT_ALLOW_LOCAL_LLM_URL                      | .env.example omits it; existing parity test fails.                                                   |

## 25. Recommended Next Development Sequence

1. Restore gateway/UI builds and route contracts; fix missing exports/constants and service type mismatches. Acceptance: clean fresh build, app imports and real UI smoke.
2. Close QA-001/005/008 and proxy trust gaps before exposing a listener. Acceptance: fake headers denied, two users isolated, undeclared credentials unavailable.
3. Make policy/risk/leases unavoidable at each effect; fix host-deny precedence and real tool mappings. Acceptance: deny-all policy blocks all execution entrypoints.
4. Isolate untrusted execution and replace ActionLedger with durable fixed-size cryptographic records using existing audit primitives.
5. Repair approval lifecycle, job cancellation/reclaim, priority, idempotency and cache correctness using real PostgreSQL regression tests.
6. Restore real voice APIs and replace social/computer/autonomy/analytics simulations with explicit provider-backed or unavailable states; preserve MCP failure status.
7. Run disposable migrations/upgrade/restore tests, all E2E flows, browser isolation/domain tests, performance/failure drills and updated dependency audit. Investigate historical hook OOM in a disposable checkout with its original workload if evidence becomes available.
8. Only then add the uncertain-outcome reconciliation feature and update release claims to match verified behavior.

## 26. Complete QA Matrix

| ID  | Audit area                             | Status       | Verification                                                        | Result / limits                                                                                                                                             |
| --- | -------------------------------------- | ------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | Repository structure/architecture      | FAIL         | Inventory, exports, route registration, health script               | QA-002/003/004; four packages; conflicting new and legacy modules.                                                                                          |
| M02 | Build/typecheck/lint/tests             | FAIL         | Direct installed binaries; all package Vitest suites                | Core/CLI build and typecheck PASS; gateway/UI FAIL; source lint PASS. 30,369 tests passed, 111 failed, 4 skipped; 4 suites failed before collection.        |
| M03 | Authentication/session security        | FAIL         | Real middleware on in-memory Hono; auth/UI-session suites           | QA-001; fake credential header bypass. Password/JWT helper passes do not clear assembled auth.                                                              |
| M04 | User/workspace isolation               | FAIL         | Real ledger/approval routes with two dummy identities; source trace | QA-005/019; unscoped ledger, fixed owner, shared browser context.                                                                                           |
| M05 | Authorization/capabilities             | FAIL         | Policy and registry probes; route/repository inspection             | QA-005/006/007; leases not enforced at effect boundary.                                                                                                     |
| M06 | PolicyEngine                           | FAIL         | Direct evaluate matrix and integration search                       | QA-006/007; nonempty IDs sufficient; production host deny shadowed.                                                                                         |
| M07 | RiskEngine                             | FAIL         | Unknown-capability test; caller mapping inspection                  | Unknown capability -> CRITICAL PASS; actual high-impact tools collapse into task/workflow risk (QA-007).                                                    |
| M08 | Approval system                        | FAIL         | Two-user route probe; workflow SQL and lifecycle review             | QA-005/012/013; legacy resolver unit checks insufficient for real identity/cancel path.                                                                     |
| M09 | ActionLedger/audit integrity           | FAIL         | 20-entry bounded probe; object mutation; route access               | QA-010/011; mutable, volatile, exponential Base64 chain. Separate legacy SHA-256 audit exists.                                                              |
| M10 | Agent runtime/tool execution           | FAIL         | Core tests; deny-all registry probe; composer/service trace         | QA-007/027. Legacy agent/claw limits exist, but LEO effect gate and global budget are incomplete.                                                           |
| M11 | Dynamic tools/plugins/MCP              | FAIL         | Real dynamic tool/registry dummy-secret test; fake MCP client       | QA-008/009/025/026. No external MCP server attacked.                                                                                                        |
| M12 | Tasks/workers                          | FAIL         | Queue repository SQL capture; service/worker tests and source       | QA-017/018; live PostgreSQL execution NOT VERIFIED.                                                                                                         |
| M13 | Workflow engine                        | FAIL         | 86 workflow-service tests (10 fail); dispatch/approval review       | QA-007/012/013/016/017. Three unhandled test rejections (mock missing rejectByWorkflow).                                                                    |
| M14 | Scheduler                              | NOT VERIFIED | Core/gateway scheduler tests run; local overlap guards inspected    | Process-local runningTasks/concurrency controls exist. Live restart, multi-node behavior and provider effects not verified; no release-level PASS.          |
| M15 | Memory                                 | FAIL         | Gateway memory suites; route identity inspection; core suite        | Fixed-owner API fails cross-user invariant (QA-005). Retrieval/dedup/consolidation exist. Two core initialization checks blocked by filesystem permissions. |
| M16 | Browser automation                     | FAIL         | Browser-service tests/source; application UI viewed in real browser | QA-019/020; browser storage isolation/domain policy defects. Actual provider automation integration NOT VERIFIED.                                           |
| M17 | Computer-use controls                  | FAIL         | Service typecheck; inert simulator probe                            | QA-004/009/022; default synthetic success and invalid contracts. No OS control action executed.                                                             |
| M18 | Social publishing                      | FAIL         | Real service denied-path probe; inert simulator                     | QA-004/022; throws ledger error, provider implementation simulated. No external publication.                                                                |
| M19 | Voice                                  | FAIL         | 22/22 voice route tests fail; UI/service contract comparison        | QA-004/014; real transcription/synthesis service exists but route contract removed. Microphone/provider E2E NOT VERIFIED.                                   |
| M20 | Database/migrations/indexes            | FAIL         | Schema/repository inspection; dummy config/agent-cache probes       | QA-015/017/018/023. Migration/index execution, real isolation and restore NOT VERIFIED; Docker daemon unavailable.                                          |
| M21 | Concurrency/idempotency/retries        | FAIL         | Queue/cache/approval SQL review and inert probes                    | QA-012/015/016/017/018; multi-process DB stress NOT VERIFIED.                                                                                               |
| M22 | Failure recovery                       | FAIL         | Worker claim/completion/shutdown trace; state persistence review    | QA-010/017; no generic active-job reclaim mechanism found. Full fault injection NOT VERIFIED.                                                               |
| M23 | Rate limiting                          | FAIL         | Proxy helper spoof test and middleware source; unit suites          | QA-021; spoofed loopback exemption when direct access exists with proxy mode enabled.                                                                       |
| M24 | SSRF/path traversal/injection/XSS/CSRF | FAIL         | Existing security suites, scoped API/safe-fetch/HTML review         | Some helper protections PASS; VM/proxy/domain/auth boundary defects remain. Full adversarial browser/DNS matrix NOT VERIFIED.                               |
| M25 | Secrets/credential handling            | FAIL         | Real registry + zero-permission dummy-secret probe; MCP source      | QA-008/025; encryption-at-rest exists but does not prevent runtime exposure.                                                                                |
| M26 | Dependency vulnerabilities             | FAIL         | Live prod/full advisory queries                                     | Prod PASS: zero across 941; all FAIL: 1 high + 2 moderate affected package records across 1216 (QA-024).                                                    |
| M27 | Frontend/UI/UX                         | FAIL         | tsc/Vite; real browser at 18199; UI tests                           | QA-003; error overlay. Authenticated interaction, responsive behavior and accessibility NOT VERIFIED.                                                       |
| M28 | Performance                            | FAIL         | Bounded ledger growth; full ESLint memory; agent cache              | QA-011/015/027. API latency, throughput and load recovery NOT VERIFIED because app cannot start.                                                            |
| M29 | Observability/logging/metrics          | FAIL         | Metrics/log/audit source; analytics evidence                        | QA-010/022; real Prometheus/request IDs/logging exist, but analytics uses fabricated baselines and ledger is unreliable.                                    |
| M30 | TODO/FIXME/stubs/dead code             | FAIL         | Fresh health report and targeted stub/caller searches               | QA-004/014/022. Health script: 5 production marker matches; that count understates unmarked stubs. Whole-program dead-code verification NOT VERIFIED.       |
| M31 | Documentation drift                    | FAIL         | Fresh source compared with named contracts/runbook                  | QA-028; no previous completion report used as evidence.                                                                                                     |

The companion LEO_TEST_MATRIX.md expands command evidence, invariant outcomes and reproduction notes. PASS applies only to the explicitly tested scope. NOT VERIFIED never means PASS.

### Evidence appendix: local reproduction outputs

```text
FOREIGN_WORKSPACE_NO_ROLES { decision: 'ALLOW' }
PRODUCTION_SHELL { decision: 'REQUIRE_APPROVAL', requiredApprovalRisk: 'CRITICAL' }
SPOOFED_LOW_RISK_CREDENTIAL { decision: 'ALLOW' }
UNKNOWN_RISK CRITICAL
PASSWORD_CONFIGURED_API_NONE [] 401
PASSWORD_CONFIGURED_API_NONE [ 'Authorization' ] 200
PASSWORD_CONFIGURED_API_NONE [ 'X-API-Key' ] 200
LEDGER_HASH_LENGTH [[1,96],[5,872],[10,4512],[20,84496]]
LEDGER_MUTABLE tampered HASH_UNCHANGED true
CROSS_USER_LEDGER 200 qa-b
UPDATE_RESULT_TYPE undefined
REGISTRY_SECRET { ok: true, value: { content: 'QA_DUMMY_SECRET', isError: false } }
OTHER_USER_APPROVES_OWNER 200 true
DIRECT_REGISTRY { ok: true, value: { content: 'executed' } } POLICY_CALLS 0
SOCIAL_RUNTIME ActionLedger.updateResult is not a function
MCP_ERROR_RESULT QA provider failed
AGENT_UPDATE_RETURN old STORED_ROW new NEXT_READ old
PROXY_HEADER_IP 127.0.0.1
DB_URL_ONLY Refusing to start: POSTGRES_PASSWORD is set to the documented default value
```

Temporary evidence logs: %TEMP%/leo-qa-{core,gateway,ui,cli}-tests.log; leo-qa-{core,gateway,cli}-build.log; leo-qa-ui-build.log; leo-qa-vite-build.log; leo-qa-*-typecheck.log; leo-qa-source-lint.log; leo-qa-eslint-memory.log; leo-qa-start.log; leo-qa-ui-server.log; leo-qa-e2e-list.log; leo-qa-e2e-run2.log; leo-qa-audit-network.json; leo-qa-audit-all.json; leo-qa-security.log; leo-qa-runtime-probes.log; leo-qa-repository-probes.log; leo-qa-boundary-probes.log; leo-qa-mcp.log. These local temporary artifacts are not committed and may be cleaned by the OS; this report retains material outputs and reproduction instructions.

# LEO QA STATUS

Build: FAIL
Tests: FAIL - 30,369 passed; 111 failed; 4 skipped; 4 suites failed before collection; 3 unhandled errors
Security: FAIL
Authentication: FAIL
Authorization: FAIL
Policy: FAIL
Risk: FAIL
Approval: FAIL
Audit: FAIL
Tasks: FAIL
Workflows: FAIL
Scheduler: NOT VERIFIED - unit coverage exists; live/multi-node behavior not verified
Memory: FAIL - route isolation; core initialization checks partly blocked
MCP: FAIL
Browser: FAIL
Computer: FAIL
Social: FAIL
Voice: FAIL
Frontend: FAIL
Database: FAIL - code defects; live migrations/integration NOT VERIFIED
Observability: FAIL

Critical: 2
High: 19
Medium: 6
Low: 1

Top Improvements: Restore build/startup; close auth/identity/credential gaps; enforce policy at effects; make ledger durable and fixed-size; repair approval/job/idempotency state transitions.
New Features: Durable uncertain-outcome reconciliation for publishing, reusing the existing SocialProvider.checkStatus contract.
Recommended Next Development Sequence: Build/API compatibility -> authentication and identity -> mandatory policy and credential scoping -> isolation and ledger -> approvals/workers/idempotency -> real provider integration -> isolated DB/E2E/load verification.
