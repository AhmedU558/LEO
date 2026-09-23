# Phase 6.4: secure computer-use provider

Baseline: `78a774772483bb6c59148fd4d450eb7f262d7322`, branch `leo-next`.

## Existing architecture reused

Authenticated `/execution-tasks` submissions still run the existing WorkflowService through the
PostgreSQL job queue. `browserNode` dispatch establishes the trusted node/run context. ComputerService
validates the task owner, workspace, workflow, active job, lease token and lease expiry before effects.
The existing workflow definition fingerprint prevents changing capabilities or actions after submission.
There is no additional workflow engine, queue, migration, or dependency.

`ComputerService -> ComputerUseProvider -> BrowserService -> isolated Chromium BrowserContext`.
The existing PuppeteerBrowserProvider continues to implement selector/navigation operations. The new
PuppeteerComputerUseProvider adds explicit screenshot, coordinate mouse, keyboard, initialization,
cancellation and close methods. `ComputerActionProposer` has only a proposal method: model output is
untrusted input to authorization, never an actuator handle. No production model adapter is simulated.

## Capability mapping

| Actions                                                          | Capability         | Policy behavior                                                                          |
| ---------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| screenshot                                                       | computer.read      | Existing HIGH intrinsic / CRITICAL RiskEngine classification retained; approval required |
| mouseMove, scroll                                                | computer.mouse     | MEDIUM; held-button motion is HIGH                                                       |
| click, doubleClick, mouseDown, mouseUp, hover                    | computer.mouse     | HIGH; autonomous approval required                                                       |
| type, typeText, press_key, keyPress, hotkey, select, fill_form   | computer.keyboard  | HIGH; autonomous approval required                                                       |
| inspect_page, find, extract, get_state, accessibility_tree, wait | browser.read       | Existing browser policy                                                                  |
| navigate, back/forward, reload                                   | browser.navigate   | Existing browser policy and SSRF checks                                                  |
| clipboard                                                        | computer.clipboard | Reserved CRITICAL capability; no implementation or host access                           |
| shell/file/unknown operations                                    | none               | Rejected                                                                                 |

Computer capabilities must be declared in the stored workflow node's `computerCapabilities`, for example:

```json
{
  "id": "click-confirmation",
  "type": "browserNode",
  "position": { "x": 0, "y": 0 },
  "data": {
    "action": "click",
    "x": 100,
    "y": 80,
    "computerCapabilities": ["computer.mouse"]
  }
}
```

Submit the owning workflow through `POST /api/v1/execution-tasks` with `workflowId` and `requestKey`.
Inspect, approve, deny and cancel with the existing execution-task APIs. Legacy `/computer/tasks`
and `/computer/tasks/:id/execute` return HTTP 410; they cannot create in-memory authorization contexts.

## Authorization, approval and recovery

- Each session binds user, workspace, execution task and a random session ID. No caller-selected browser
  session or credentials are imported. Browser contexts isolate cookies and storage.
- Capability checking, PolicyEngine, RiskEngine and durable audit precede provider initialization.
- REQUIRE_APPROVAL creates an expiring workflow approval and persists the workflow/task approval wait.
  The record binds node/run/task/session/capability and a canonical hash of the exact resolved action.
  Resumption atomically consumes that approval and claims an existing durable idempotency record while
  holding the running task lock. Expired, altered, cancelled and replayed approvals fail closed.
- Successful effect completion and audit result update are serialized against cancellation through the
  existing task transaction. Exceptions, timeout, interruption or provider loss never produce SUCCESS.
  Claimed operations cannot be automatically replayed, including uncertain side effects.
- Browser state is process-local. A resumed action after session loss or process restart fails closed;
  it does not recreate a fresh page and replay an approval. A new execution task is required.
- Cancellation closes the isolated context. An action-local AbortSignal also prevents late initialization
  from dispatching input after its timeout. Completion and failure release task resources.

## Bounds and data handling

- Fixed 1280 x 800 viewport; negative, nonfinite and out-of-bounds coordinates rejected.
- Viewport-only PNG capture, at most 4 MiB; actual PNG dimensions checked independently of provider metadata.
- At most 100 action attempts/iterations and 30 capture attempts per session, including approval attempts.
- Existing 10-minute browser lifetime, 10-second action timeout and 5-session per-user limit; 20 sessions
  per process. Concurrent commands on one session fail closed. No autonomous execution loop is installed.
- Keyboard input is limited to page-local text, explicit navigation/editing keys, and approved
  `Control+A`, `Control+Z`, `Control+Shift+Z`, `Shift+Tab`. Clipboard and browser/OS shortcuts are rejected.
- Downloads are denied. Chromium target auto-attachment pauses popup targets, installs request denial,
  then resumes and closes them. Closing a paused target can deadlock the opener's click. A real-browser
  localhost regression verifies the click completes and zero requests reach the popup target.
- Audit contains scope IDs, capability, action, coordinates, viewport, policy, risk and outcome.
  Input text, selectors, raw provider errors and screenshots are not written to audit/effect records.
  Workflow screenshots persist metadata only; other page observations are marked untrusted.

## Verification environment

Use a disposable local PostgreSQL database with database-creation permission, Docker Desktop with
`node:20-slim`, a built core package, and Chrome. No external provider credentials are needed.

```powershell
$env:LEO_QA_POSTGRES_URL='postgres://leo_test:leo_test@127.0.0.1:55444/leo_phase64'
$env:DATABASE_URL=$env:LEO_QA_POSTGRES_URL
$env:LEO_QA_DOCKER='1'
$env:LEO_QA_BROWSER='1'
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:pnpm_config_verify_deps_before_run='false'

pnpm --filter @ownpilot/core test --maxWorkers=2
pnpm --filter @ownpilot/ui test --maxWorkers=2
pnpm --filter @ownpilot/gateway test --maxWorkers=2
pnpm --filter @ownpilot/gateway typecheck
pnpm --filter @ownpilot/gateway lint
pnpm --filter @ownpilot/gateway build
git diff --check
git status --short
```

The last environment variable avoids implicit installs by this machine's sandbox pnpm wrapper.
Verification used PostgreSQL 16 (`pgvector/pgvector:pg16`) and Node 24.14.1. Browser tests use synthetic
local pages, including a disposable localhost server for the popup regression.

## Deliberate limits

This is a browser actuator foundation, not desktop automation. No OS input, shell, host clipboard,
host file access, model implementation, autonomous loop, or new computer UI is provided. A trusted
in-process controller may use transient screenshots as observations and submit proposals through
ComputerService; the workflow log deliberately does not retain screenshot bytes. Approval resumption
requires the original live browser session. General browser tools outside a durable task/node context
cannot use ComputerService to bypass this boundary.

## Final verification results

Verified locally on 2026-09-23. Counts below are from complete package runs; focused integration runs
are subsets and must not be added to the total.

| Gate                                     | Result | Evidence                                                                                        |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Core full suite                          | PASS   | 167 files passed; 9,975 tests passed, 3 skipped                                                 |
| UI full suite                            | PASS   | 117 files passed; 2,111 tests passed, 1 skipped                                                 |
| Gateway full suite                       | PASS   | 509 files passed, 2 skipped; 18,201 tests passed, 7 skipped                                     |
| Required PostgreSQL/browser integrations | PASS   | 33 tests passed, 0 skipped: QA-012 3, execution-task runtime 19, browser 3, computer provider 8 |
| Docker/compiled-worker integrations      | PASS   | 15 tests passed, 0 skipped: Docker 6, compiled worker 9                                         |
| Gateway typecheck                        | PASS   | 0 errors                                                                                        |
| Gateway lint                             | PASS   | 0 errors; 52 pre-existing warnings; all changed TypeScript files also pass `--max-warnings=0`   |
| Gateway build                            | PASS   | TypeScript build exits 0                                                                        |
| Whitespace validation                    | PASS   | `git diff --check` exits 0                                                                      |

Total: **30,287 passed, 11 skipped, 0 failed, 0 unhandled test errors** across the three full suites.
The 11 skips are **NOT VERIFIED**: three legacy source-adjacent worker tests, one ChatInput imperative
handle test, one social publish test and six date-range template tests. The separate compiled-worker
suite executes successfully; it does not turn the skipped cases into passes. No required Phase 6.4
integration test was skipped.

An earlier gateway verification failed on the popup regression: closing a paused target stalled the
opener's click. The final implementation installs request denial before resuming/closing the target.
The regression now proves the button handler ran, the click completed, zero private-network requests
arrived, and no popup remained. The full suite was rerun after this fix. Test fixtures use no external
systems. Gateway PostgreSQL computer-flow tests use a deterministic actuator with the real database,
workflow runtime and approvals; separate provider tests exercise real Chrome.

Required integration services and variables are listed above. The test setup supplies the fixed
`OWNPILOT_ENCRYPTION_KEY` test value when absent. No real account credentials are required. The local
pnpm 11 wrapper warns about legacy package-level pnpm settings; dependencies and configuration were
not changed. Normal Git hooks use the installed pnpm 10 toolchain.

## Changed files

All paths are relative to the repository root.

| Area                         | Files                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core contract and risk       | `packages/core/src/computer/{models.ts,provider.ts,provider.test.ts}`, `packages/core/src/security/{capabilities.ts,risk-engine.ts}`                                                                                                         |
| Durable authorization        | `packages/gateway/src/db/repositories/execution-tasks.ts`, `packages/gateway/src/db/repositories/workflows/approvals.ts`                                                                                                                     |
| Browser and computer runtime | `packages/gateway/src/services/{browser-service.ts,browser-service.test.ts}`, `packages/gateway/src/services/computer/{service.ts,service.test.ts,puppeteer-provider.ts,computer-use-provider.ts,computer-use-provider.integration.test.ts}` |
| Execution task integration   | `packages/gateway/src/services/{execution-task-context.ts,execution-task-service.ts,execution-task.integration.test.ts}`                                                                                                                     |
| Workflow integration         | `packages/gateway/src/services/workflow/{workflow-dispatch.ts,workflow-node-job-handler.ts,executors/browser.ts}`                                                                                                                            |
| Legacy endpoint boundary     | `packages/gateway/src/routes/computer.ts`                                                                                                                                                                                                    |
| Phase report                 | `docs/implementation/PHASE_6_4_COMPUTER_USE.md`                                                                                                                                                                                              |
