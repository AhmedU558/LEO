# Phase 6.6: trusted screenshot redaction and controlled vision loop

Baseline: `4e6907bc8824e7ca6bcda6589c90ff14ac7dfd35`, branch `leo-next`.

## Architecture

The existing workflow `browserNode` accepts `action: "vision_loop"` and a finite
`iterations` count (default 1). It calls `runComputerVisionLoop` inside the existing
execution-task worker context. No queue, execution engine, database migration,
dependency, or unrestricted browser/OS tool was added.

Example node data:

```json
{
  "action": "vision_loop",
  "iterations": 2,
  "model": "default",
  "computerCapabilities": ["computer.read", "computer.mouse"]
}
```

The existing OpenAI configuration supplies the credential and model. Credentials
stay in the server transport; model context contains only a redacted observation,
viewport, fixed instructions/schema, and an untrusted-data marker. Workflow
identity, approval records, ledger contents, and raw page source are excluded.

## Redaction and sensitive data

`ScreenshotRedactor` is a provider-neutral core contract. The initial
`StructuralScreenshotRedactor` uses the already-installed `sharp` dependency to
decode the actual authorized PNG and cover every source pixel with an opaque mask.
It then draws native control bounds and fixed server labels. It preserves the
1280 x 800 viewport and enforces the existing 4 MiB input/output limits.

BrowserService reads layout with fixed CDP `DOMSnapshot.captureSnapshot` commands.
It does not execute arbitrary page scripts. Password, secret/token/credential,
and authentication/OTP fields receive fixed sensitive-control labels; values and
page labels are discarded. Free text, images, and undetected secrets are protected
by masking the whole original image, rather than relying on perfect detection.
Raw snapshots are hashed locally and never sent to the model or ledger.

Missing/empty control layouts, malformed PNGs, invalid geometry, multiple documents,
shadow roots, more than 5,000 DOM nodes, or more than 200 controls fail closed.
There is no default disclosure path. Existing explicitly injected trusted redactor
callbacks remain supported for Phase 6.5 callers; the production vision workflow
always constructs the structural redactor. Model output cannot attest redaction.

Synthetic tests demonstrate identical disclosed pixels for different original
images, sensitive-control handling, unsafe-input refusal, and viewport preservation.
The real Chrome fixture includes password, API-token, OTP, and free-text secrets.

## State, authorization, and recovery

Each iteration captures, redacts, proposes, validates, authorizes, and executes.
The model never dispatches an effect. ComputerService validates the schema, maps
capabilities, applies PolicyEngine/RiskEngine, requires exact approvals, and records
effects through existing idempotency and ActionLedger infrastructure.

Outcomes are `COMPLETED`, `WAITING_APPROVAL`, `CANCELLED`, `TIMEOUT`, `FAILED`,
`UNKNOWN`, and `LIMIT_REACHED`. COMPLETED means the requested number of actions
returned verified SUCCESS. It is not a claim that an arbitrary natural-language
goal was achieved.

Approvals use the existing durable task/workflow approval transition. A paused
loop retains the exact proposal in process memory and resumes it with its original
approval before making any further model request. Each subsequent action requires
its own authorization. Capture approvals also pause before disclosure/inference.

A durable operation marker prevents reconstruction after lost process state.
Restart or unknown side effects require reconciliation/new execution; they are
never replayed. Non-success loop termination conservatively persists UNKNOWN
through the existing task repository, except explicit cancellation persists
CANCELLED. Existing worker error handling also preserves interrupted tasks as
UNKNOWN. Loop timeout includes approval waiting time.

Task closure aborts active loop work and clears retained approval state/timers.
AbortSignal flows through model/redactor work and ComputerService authorization
and dispatch; cancellation is checked again after asynchronous freshness checks.
Timeout cleanup closes resources even if persistence fails. Database failure can
prevent recording a terminal state; existing recovery remains necessary in that
case, and no successful completion is inferred.

## Observation freshness and audit

Each capture has a new observation UUID and a session action version. Screenshots
are provenance-bound objects, consumed once. Concurrent inference and computer
actions in the same session are denied. DOM/layout revisions are compared around
capture, before disclosure, after inference, before approval resume, and immediately
before dispatch. Changed revisions invalidate the proposal.

Ledger resource metadata adds observation ID and iteration alongside existing
user/workspace/task/run/session, action, capability, policy, risk, and result
correlation. Screenshot bytes, field values, and model payloads are not persisted.

## Limits

| Resource                                  | Hard loop maximum |
| ----------------------------------------- | ----------------: |
| Iterations                                |                 5 |
| Captures                                  |                 5 |
| Model requests                            |                 5 |
| Actions, including captures               |                10 |
| Total duration, including approval pauses |       120 seconds |

Trusted callers may only lower these limits. Existing ComputerService session,
capture, action, model-request timeout, browser, and transport limits still apply.

## Verification

Commands: `pnpm --filter @ownpilot/{core,ui,gateway} test --maxWorkers=2`
(each package separately), and gateway `typecheck`, `lint`, and `build`.

| Gate                     | Result                                                            |
| ------------------------ | ----------------------------------------------------------------- |
| Core                     | PASS: 10,030 passed, 3 skipped; 168 passed files                  |
| UI                       | PASS: 2,111 passed, 1 skipped; 117 passed files                   |
| Gateway                  | PASS: 18,255 passed, 7 skipped; 513 passed files, 2 skipped files |
| Gateway typecheck        | PASS: zero errors                                                 |
| Gateway lint             | PASS: zero errors, 52 existing warnings                           |
| Changed TypeScript files | PASS: zero lint warnings                                          |
| Gateway build            | PASS                                                              |
| Core build               | PASS; compiled worker artifacts available                         |
| Diff whitespace          | PASS                                                              |

Final package total: 30,396 passed, 11 skipped, zero failed tests and zero
unhandled test errors. Skips are excluded from pass counts. The final gateway
JSON report records `success: true`; the final loop suite executes 17 cases.

Required integration breakdown (included in package totals):

| Integration                                                             | Passed | Skipped |
| ----------------------------------------------------------------------- | -----: | ------: |
| PostgreSQL QA-012 approvals                                             |      3 |       0 |
| PostgreSQL QA-014                                                       |      2 |       0 |
| PostgreSQL execution-task/workflow                                      |     19 |       0 |
| PostgreSQL repository isolation/claims/ledger/retries/recovery/priority |     28 |       0 |
| PostgreSQL social integration, unchanged                                |      6 |       0 |
| Real Chrome BrowserService                                              |      3 |       0 |
| Real Chrome computer provider                                           |      8 |       0 |
| Real Chrome model adapter                                               |      1 |       0 |
| Real PostgreSQL + Chrome vision workflow                                |      2 |       0 |
| Docker isolation                                                        |      6 |       0 |
| Compiled-worker integration                                             |      9 |       0 |

The explicit Docker/worker rerun passed 15/15. Docker emitted one handled
concurrent-removal warning (`removal ... is already in progress`); a subsequent
container inventory confirmed that container no longer existed. This was not an
unhandled test error. Initial local verification exposed a missing ToolService
startup fixture and asynchronous scroll timing in tests; both were corrected and
the real integrations rerun successfully, without disabling security behavior.

Skipped and NOT VERIFIED: three legacy source-adjacent worker isolation cases in
`sandbox-escape.test.ts` (separate compiled-worker tests executed), one UI ChatInput
imperative-handle case, six gateway date-range template cases, and one gateway
social publishing unit case. No required PostgreSQL/Docker/Chrome integration was
skipped. Live external model behavior remains NOT VERIFIED.

Required local environment:

```text
LEO_QA_POSTGRES_URL=postgres://leo_test:leo_test@127.0.0.1:55446/leo_phase66
DATABASE_URL=<same disposable PostgreSQL URL>
LEO_QA_DOCKER=1
LEO_QA_BROWSER=1
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
pnpm_config_verify_deps_before_run=false
```

Services: Docker Desktop; disposable `pgvector/pgvector:pg16` PostgreSQL container
`leo-phase66-qa`; locally installed Chrome; `node:20-slim` for Docker isolation tests;
compiled core worker artifacts. PostgreSQL test credentials above are disposable
local test data, not application credentials. The test database role must be able
to create/drop isolated databases. Normal tests require no external OpenAI key.

The new real integration uses deterministic model proposals with actual Chrome,
PostgreSQL, workflows, execution tasks, approvals, policy/risk checks, and ledger.
It executes mouse movement followed by a click through three distinct approval
pauses, verifies two model requests/fresh observations and four successful audit
entries, denies a wrong-workspace approval, and tests cancellation before inference.

## Remaining limitations

- The structural image removes all original labels/content. It supports coordinate
  interaction with native controls, not general visual understanding or canvas,
  iframe, shadow-DOM, or text-reading tasks. A stronger trusted redactor can replace
  this implementation through the contract when those capabilities are required.
- DOM revision checks cannot atomically freeze a live web page or detect every
  canvas/CSS visual animation. Such original visual pixels are never disclosed;
  the browser can still change between a final check and input delivery.
- Approval continuation is process-local; restart fails closed instead of
  automatically reconstructing browser/model state.
- Model timeouts/unavailability return a denied proposal and a FAILED loop result;
  the overall loop deadline returns TIMEOUT. Both stop without success/replay.
- The live external-provider smoke test is NOT VERIFIED. Only deterministic local
  model proposals were used; no external credential or provider call was required.
- Existing skipped tests are NOT VERIFIED, not passes. They are listed with the
  final gate results.
