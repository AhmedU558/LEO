# Phase 6.5: computer-use model adapter

Baseline: `8fad5fe78f345e921ec8b43c73862476d1d534b2`, branch `leo-next`.

## Implementation

`OpenAIComputerActionProposer` is a real, single-request vision adapter using the existing
`OpenAIProvider`. Its trusted configuration supplies an API key and vision-capable model ID; the
endpoint is OpenAI's existing default. Tests use `gpt-4o` and a stubbed HTTP transport, not a fabricated
production response. No dependency, queue, workflow engine, database schema, route or UI was added.

The existing provider has an opt-in `transient` completion path: caller cancellation, a 30-second
deadline, bounded streaming response reads, no redirects, no retries and no payload/error-body logs.
Ordinary completions retain their existing behavior. Computer requests offer no model tools.
Missing credentials, invalid model responses and unknown/missing completion status never succeed.

Provider-neutral contracts cover the observation, request, proposal, provider/model metadata and
typed failures (`CANCELLED`, `TIMEOUT`, `UNAVAILABLE`, `INVALID_OBSERVATION`, `INVALID_RESPONSE`).

## Proposal schema and validation

```json
{
  "type": "click",
  "params": { "x": 100, "y": 80 },
  "viewport": { "width": 1280, "height": 800 }
}
```

Exactly those three fields are accepted. Each action has an exact parameter-key set; extra fields,
arrays instead of records, tool/function calls, identity fields, capabilities and metadata are denied.

| Action                                            | Parameters                               | Capability chosen by ComputerService |
| ------------------------------------------------- | ---------------------------------------- | ------------------------------------ |
| screenshot                                        | none                                     | computer.read                        |
| mouseMove, click, doubleClick, mouseDown, mouseUp | finite in-viewport x, y                  | computer.mouse                       |
| scroll                                            | finite deltaX/deltaY bounded to 1280/800 | computer.mouse                       |
| keyPress                                          | existing allowed key                     | computer.keyboard                    |
| typeText                                          | plain text, maximum 2,000 characters     | computer.keyboard                    |
| hotkey                                            | existing allowed key combination         | computer.keyboard                    |

Responses, including the provider envelope, are bounded to 16 KiB. The viewport must be exactly
1280 x 800. Observations must be bounded base64 PNGs with matching header dimensions and at most
4 MiB decoded bytes. Hotkeys reuse `Control+A`, `Control+Z`, `Control+Shift+Z`, `Shift+Tab`.
Text rejects controls, executable syntax, paths/URLs and common scripting/command keywords. This
conservative text filter restricts legitimate punctuation too; it is defense in depth, not a general
classifier of executable language. No proposal is evaluated as code. All input effects still need
the existing authorization and approval checks.

## Trusted one-step controller

1. A trusted durable worker obtains a successful screenshot through `ComputerService.executeAction`.
   This retains the existing capability, policy, risk, approval and audit requirements.
2. It passes that actual result object to `ComputerService.proposeAction`, together with a proposer
   and a mandatory trusted screenshot redactor. Fabricated results and reused observations are denied.
3. The redactor must remove sensitive pixels or refuse disclosure. There is no permissive default.
   A `disclosure: 'redacted'` attestation is accepted only from this trusted code, never model output.
4. The proposer receives only the prepared image, fixed viewport, untrusted-data marker and abort
   signal. User/workspace/task/session IDs, leases, credentials, ledger records and browser/DB objects
   never enter model messages. The transport alone uses its configured API credential.
5. The service validates the output again, freezes it and retains its provenance outside the model.
   The returned envelope binds user, workspace, task and session and references the screenshot audit ID.
6. `executeProposal` rechecks the live task, workflow, job lease and session, then delegates to the
   existing `executeAction` policy/risk/approval/effect/ledger path. The model never selects a capability.

Changed session activity invalidates an observation before or during a model request. Every observation
can produce at most one request, including concurrent callers. Existing capture/action/session limits
therefore also bound model iterations. No automatic loop, navigation, shell, host OS, file, clipboard,
arbitrary page script or tool executor is exposed to the adapter.

## Approval, cancellation and recovery

The trusted caller retains the returned proposal envelope while the existing approval is pending.
The envelope reserves a stable workflow-node effect index. Only that original approval may resume
it; no new inference occurs on approval. Exact canonical action/session hashing and atomic approval
consumption remain in the existing durable repositories. Concurrent/repeated dispatch is denied;
successful and uncertain actions cannot be retried through the envelope.

Cancellation and timeout abort model transport and deny late results. Persisted scope and lease
checks run before disclosure and after inference. Provider/actuator uncertainty retains `UNKNOWN` and
closes the session through the Phase 6.4 path. Restart or lost envelopes/sessions fail closed; no model
response is reconstructed or replayed. Screenshot and proposal payloads are not stored in the ledger.
The observation audit reference and action audit entries correlate through the same task/session.

## Changed files

- `packages/core/src/computer/provider.ts`: typed neutral model contracts and failures.
- `packages/core/src/computer/model-adapter.ts`: strict parser, observation validation, OpenAI proposer.
- `packages/core/src/computer/index.ts`: exports.
- `packages/core/src/agent/types.ts`: opt-in transient request contract.
- `packages/core/src/agent/providers/openai-provider.ts`: bounded, cancellable, private transport path.
- `packages/core/src/computer/model-adapter.test.ts`: parser and real-provider transport fixtures.
- `packages/gateway/src/services/computer/service.ts`: scoped observation/proposal controller.
- `packages/gateway/src/services/computer/service.test.ts`: authorization, replay, failure and scope checks.
- `packages/gateway/src/services/computer/model-adapter.integration.test.ts`: real Chrome input after approval.
- This report.

## Verification environment

```powershell
$env:LEO_QA_POSTGRES_URL='postgres://leo_test:leo_test@127.0.0.1:55445/leo_phase65'
$env:DATABASE_URL=$env:LEO_QA_POSTGRES_URL
$env:LEO_QA_DOCKER='1'
$env:LEO_QA_BROWSER='1'
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:pnpm_config_verify_deps_before_run='false'
```

Required services: disposable PostgreSQL 16 (`pgvector/pgvector:pg16`, permission to create test
databases), Docker Desktop with `node:20-slim`, and Chrome. Core must be built for gateway imports
and compiled-worker tests. Test setup supplies a fixed `OWNPILOT_ENCRYPTION_KEY` when absent.
No real model credentials are required by verification. The pnpm variable prevents implicit installs
by this machine's sandbox wrapper. No package/configuration changes are needed.

## Final verification results

Verified locally on 2026-09-23 with the environment above. Full package runs used `--maxWorkers=2`.

| Gate                                         | Result | Counts                                                                |
| -------------------------------------------- | ------ | --------------------------------------------------------------------- |
| Core tests                                   | PASS   | 168 files passed; 10,030 tests passed, 3 skipped                      |
| UI tests                                     | PASS   | 117 files passed; 2,111 tests passed, 1 skipped                       |
| Gateway tests                                | PASS   | 510 files passed, 2 skipped; 18,221 tests passed, 7 skipped           |
| Explicit PostgreSQL/browser integrations     | PASS   | 5 files, 34 tests passed, 0 skipped                                   |
| Explicit Docker/compiled-worker integrations | PASS   | 2 files, 15 tests passed, 0 skipped                                   |
| Gateway typecheck                            | PASS   | 0 errors                                                              |
| Gateway lint                                 | PASS   | 0 errors, 52 existing warnings; changed files pass with zero warnings |
| Gateway build                                | PASS   | Exit 0; core prerequisite build also passes                           |
| `git diff --check`                           | PASS   | No whitespace errors                                                  |

Full-suite total: **30,362 passed, 11 skipped, 0 failed, 0 unhandled test errors**. Focused integration
counts are subsets of those totals. Integration breakdown: QA-012 approvals 3; execution tasks 19;
existing browser 3; computer provider 8; new model/browser 1; Docker 6; compiled workers 9.

All required integration tests executed. The 11 existing skips remain **NOT VERIFIED**: three legacy
source-adjacent worker cases, one ChatInput imperative-handle case, one social-publishing case and six
date-range-template cases. The separate compiled-worker suite passes without converting skipped cases
into passes. Live external model inference is separately unverified as detailed below.

Commands: `pnpm --filter @ownpilot/{core,ui,gateway} test --maxWorkers=2` (each package separately),
`pnpm --filter @ownpilot/gateway typecheck`, `pnpm --filter @ownpilot/gateway lint`,
`pnpm --filter @ownpilot/gateway build`, `git diff --check`, and `git status --short`.
The existing OpenAI transport regression tests pass alongside the new model tests. No test or compiler
setting was weakened. The pnpm 11 sandbox wrapper warns about existing package-level settings; no
dependency/configuration changes were made. Normal commit hooks use installed pnpm 10.

## Limits and unverified behavior

- Live OpenAI inference is **NOT VERIFIED**: no real credentials or external model requests were used.
  Real HTTP request construction and response handling are tested against deterministic local fixtures.
- The new browser integration uses real Chrome, the real adapter and ComputerService, with deterministic
  repository/approval fixtures. The existing PostgreSQL suites separately verify durable scope, claims,
  approval consumption, cancellation and recovery. This is not a claim of live-model end-to-end coverage.
- Automatic screenshot redaction is not implemented. A trusted disclosure/redaction integration is
  required before production use; checking PNG shape or asserting a flag cannot discover secrets in
  pixels. Tests explicitly use synthetic secret-free pages. No automatic production screenshot upload
  is enabled by this phase.
- This is an in-process one-step controller API for trusted durable workers. It does not add a model
  workflow node, end-user model selection, UI loop, screenshot store or automatic approval-resume runner.
  The trusted caller must retain the exact envelope and resume it within the original live task/session.
- Model input currently consists of the redacted screenshot and fixed instructions only; it does not
  include conversation history or arbitrary page contents. Task-specific planning remains with the
  trusted caller. The selected model must support image input and JSON responses.
