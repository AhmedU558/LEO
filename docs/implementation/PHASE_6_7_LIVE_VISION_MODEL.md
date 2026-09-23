# Phase 6.7: live vision model integration and production computer-use validation

Baseline: `415390ef352fa479617ad59b5c67ac548ec21411`, branch `leo-next`.

## Status

**COMPLETE.** A real external vision model drove the Phase 6.6 pipeline end to
end: real redacted screenshot in, real inference out, strict parse, server-side
capability mapping, PolicyEngine and RiskEngine, durable approval, a real Chrome
action, and an ActionLedger record.

Verified run:

```
provider = OpenRouter (https://openrouter.ai/api/v1)
model    = nex-agi/nex-n2.5-pro:free   (upstream provider: Nex AGI)
status   = 200
proposal = {"type":"click","params":{"x":118,"y":94},"viewport":{"width":1280,"height":800}}
finalState = COMPLETED
4 passed (4)
```

The proposal carried exactly the three permitted keys with in-viewport
coordinates and no capability of its own. The capability was derived
server-side from the action type, as designed.

### Provider capacity is not model incompatibility

The first live attempt used `google/gemma-4-31b-it:free` and returned **HTTP
429** — `temporarily rate-limited upstream`, `limit_source:
upstream_provider_shared_pool`. That is shared free-tier capacity, not a schema
failure. The parser was not touched; another provider was used instead.

That failure is itself evidence: the loop refused the response, finished the
task as `FAILED`, and invented nothing. Security requirement 17 — no hidden
fallback from real inference to deterministic fake success — is now
demonstrated against a live provider failure rather than only by reading the
source.

Free-pool models are shared and flaky. A run that 429s should be retried or
pointed at another model; it is not a regression.

## Pointing the same transport at another OpenAI-compatible endpoint

`OpenAIComputerActionProposer` constructed `OpenAIProvider` without a
`baseUrl`, so it always resolved to `https://api.openai.com/v1`. Running the
live test against OpenRouter needed the smallest possible configuration change,
not a second execution path:

- The proposer now accepts an optional `baseUrl` (and `provider` label) and
  forwards it to the same `OpenAIProvider`. The URL must be `https`. It is
  server-side configuration; the model never sees it and cannot influence it.
- `workflow/executors/browser.ts` now uses the provider that
  `resolveDefaultProviderAndModel` returns, reads that provider's key, and takes
  its `apiBase` from the existing `AGGREGATOR_PROVIDERS` registry, where
  OpenRouter is already declared as `openai_compatible` with
  `https://openrouter.ai/api/v1`.

No transport, prompt, parser, redactor, capability mapping, policy, risk,
approval or ledger behaviour changed. There is no OpenRouter-specific code path.

## Pre-existing breakage repaired alongside this phase

The Phase 6.7 report flagged three failures that predate this phase and were not
caused by it. They are fixed here rather than left as a footnote, because
`tsc -b` and `vite build` were both red on `leo-next` and a phase cannot be
verified against a package that does not compile.

1. `packages/ui/src/pages/SocialPage.tsx` was committed in `90a47d0d` with **no
   import statements at all**, and referencing `PageContainer` and `Card`, which
   do not exist anywhere in this repository. It had never compiled. It also
   called `useAuth().session`, which that hook does not return, and had two
   `catch { console.error(e) }` blocks with no binding for `e`. Repaired: real
   imports, the page shell hand-rolled the way the sibling pages do, a local
   `Card` helper, `isAuthenticated` for the effect dependency, and bound catch
   clauses. A colocated smoke test was added per the repository's "a page
   touched is a page tested" convention.
2. `packages/ui/src/api/endpoints/execution-tasks.ts` imported `ExecutionTask`
   from `@ownpilot/core/services`. `@ownpilot/core` is a Node package and is not
   a dependency of the browser bundle. This is the sixth instance of the mistake
   `src/types/leo.ts` already exists to prevent, so the type was mirrored there
   like the other five.
3. `vite build` failed in `vite-plugin-pwa` / `workbox-build` with
   `Requires Babel "^7.0.0-0", but was loaded with "8.0.6"`. Root cause was the
   root `pnpm.overrides` entry `"@babel/core": ">=7.29.6"` — unbounded, so it
   pulled every consumer onto Babel 8, including `workbox-build@7.4.1`, which
   declares `^7.24.4`. Every package resolving against core 8.0.6 was itself a
   Babel **7.x** plugin, so nothing wanted Babel 8. Bounded to
   `">=7.29.6 <8.0.0"`, which keeps the security floor the override exists for
   and resolves workbox to 7.29.7. The lockfile change is confined to the Babel
   subtree.

## Reproducing the live run

```bash
cd packages/gateway
LEO_QA_LIVE_MODEL=1 LEO_QA_LIVE_MODEL_API_KEY=... LEO_QA_LIVE_MODEL_NAME=nex-agi/nex-n2.5-pro:free LEO_QA_LIVE_MODEL_BASE_URL=https://openrouter.ai/api/v1 LEO_QA_POSTGRES_URL=postgres://... LEO_QA_BROWSER=1 node ../../node_modules/vitest/vitest.mjs run   src/services/computer/live-vision-model.integration.test.ts
```

The suite still fails closed: with the switch set and configuration missing it
errors rather than skipping or mocking, and with the switch unset the live
tests skip while two unconditional gate tests pin both directions.

## Diagnosing a failed live run

The test reports the recorded outbound status, the final task state and the raw
provider response from a `finally` block, so a mid-run abort is still
diagnosable. A refused proposal cancels the task and `ExecutionTaskService`
then throws `Execution task interrupted`, which would otherwise hide whether
inference happened at all. The three failure classes are distinguishable:

- `NO outbound request reached the provider` — the fault is upstream of
  inference (capture, redaction, authorization). An implementation defect.
- non-200 status — provider-side: wrong model id, rate limit, or account
  configuration.
- 200 with a non-conforming body — genuine model incompatibility. Report it and
  try another model. **Do not loosen the parser to make a model pass.**

---

# Phase 6.8: bounded multi-step visual task execution

## What already existed

Most of this phase was already built in 6.6 and did not need rewriting. No
second execution engine was added and nothing bypasses `ComputerService`.
`runComputerVisionLoop` already:

- iterates up to `options.iterations`, running capture -> redact -> infer ->
  validate -> authorize -> execute on every step;
- mints a new `observationId` per capture, so each action invalidates the
  previous observation;
- takes a durable approval per side-effecting action and resumes only the
  original action;
- stops on UNKNOWN, cancellation, timeout, stale observation, denial or model
  failure, and finishes the durable operation as `unknown` rather than
  replaying it;
- enforces `VISION_LIMITS` (iterations, screenshots, model requests, actions,
  duration);
- refuses re-entry through a `busy` guard, so one session cannot run two
  inferences or two actions concurrently.

A two-iteration Chrome integration test already covered the happy path.

## What this phase adds

The gap was not the mechanism but the **failure paths**: what a multi-step task
does when it goes wrong part way through, which is where "stop immediately" and
"never replay an uncertain action" actually have to hold. Four integration
tests were added to the existing Chrome + PostgreSQL harness:

| Test                        | Proves                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| fresh dependent observation | step 2's redacted observation differs from step 1's, so it is a real re-capture rather than a replayed cache                              |
| mid-task model failure      | step 1 stays durable in the ledger and **no step-2 action** is dispatched                                                                 |
| mid-task cancellation       | the loop stops, spends no further inference, and step 2 never acts                                                                        |
| stale observation           | a well-formed proposal describing a page that moved on is refused by the `Browser changed after proposal` guard, and never reaches Chrome |

## Findings

**The redacted view only carries recognized controls.** The redactor paints a
white canvas and draws boxes solely for `Button`, `Link`, `Field`, `Password`,
`Secret`, `Authentication` and `Select`. A first attempt at the dependent-step
test clicked a fixed-width button whose _label_ changed; the next observation
was byte-identical. A dependent step can only perceive a previous action when
that action changed the layout of a recognized control. Text, colour and
non-control elements are invisible to the model. This bounds what "dependent
multi-step task" can mean under the current disclosure policy.

**A failed step still leaves its capture in the ledger.** Step N+1's screenshot
legitimately succeeds before step N+1's inference fails, so ledger progress must
be read by filtering on the action column, not by iteration alone. Only the
absence of a non-screenshot action proves the step did not act.

**The evidence recorder understated outbound traffic.** The Phase 6.7 recorder
pushed a record only after `fetch` resolved, so a request aborted at
`COMPUTER_MODEL_LIMITS.timeoutMs` was reported as "no outbound request" when one
had in fact been sent and abandoned. It now records failed attempts with
`status: 0`. This mattered immediately: the first live multi-step failures were
misattributed until it was fixed.

## Task progress and recovery

Progress is durable and queryable: `action_ledger` records every effect with its
iteration and observation id, and `idempotency_keys` records a claim per effect.
The mid-task failure test asserts that completed steps survive a later failure.

Cross-process resumption is deliberately **not** supported, and this is a design
position rather than an omission. The browser session is an in-process Chrome
binding; `service.ts` already refuses to continue when it is gone
(`Computer session lost after restart`), and effect claims are single-use
(`Computer operation already claimed; replay prohibited`). Resuming a visual
task in a fresh process would mean acting on a UI whose state was never
observed. The loop therefore fails closed as UNKNOWN instead, which is what
"never replay an uncertain action" requires. Making this genuinely resumable
would need an out-of-process session registry — a larger change that should be
decided explicitly, not smuggled in here.

## Live multi-step: UNVERIFIED

The gated live suite gained a two-step test. It has **not** passed against a
real provider. Free-tier behaviour observed across five attempts:

| Model                                  | Result                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `nex-agi/nex-n2.5-pro:free`            | schema-compliant content, but 15-25s per call; exceeded the 30s model limit on two attempts |
| `dots-studio/dots-3-note-preview:free` | HTTP 200 with **no message content**, so nothing to parse                                   |
| `google/gemma-4-31b-it:free`           | HTTP 429, shared upstream pool                                                              |

Single-step live inference remains verified (Phase 6.7, re-confirmed this
phase). Two sequential inferences inside one bounded task double the exposure to
free-tier latency, and `COMPUTER_MODEL_LIMITS.timeoutMs` was **not** raised and
the parser was **not** relaxed to make the test pass. A paid provider key would
most likely close this; that is a configuration decision, not a code change.

---

# Phase 6.9: trusted rich visual observation and perception

## The problem this solves

Phase 6.8 established that the model could only perceive a previous action when
it changed the layout of a native control. The redactor painted a white canvas
and drew boxes for `Button`, `Link`, `Field`, `Password`, `Secret`,
`Authentication` and `Select` and nothing else, so a heading change, a status
message, or a relabelled fixed-size button was literally invisible. Dependent
multi-step work was bounded by that.

## Design: disclosure is drawn into the mask

The disclosure is rendered **into the redacted image as pixels**. Nothing is
added to the model request, the proposal schema or any JSON leaving the process.

That choice carries the security properties for free:

- the request shape is unchanged, so the parser, capability mapping, policy,
  risk, approval and ledger paths are untouched;
- no page-derived string is ever added to the outbound body, so the Phase 6.7
  assertion that page strings never appear in the JSON remains true and unaltered;
- there is no new channel to audit.

## What is disclosed

`disclosableText` in `packages/core/src/computer/provider.ts` is the single
decision point, applied twice: once in the capture and again in the redactor,
which re-derives the verdict rather than trusting its input. A string is
disclosed only when **all** of the following hold:

- at most 40 characters and at most 6 words — a label, not prose;
- drawn from a restricted printable character set;
- free of credential words (password, secret, token, api key, otp, auth,
  session, mnemonic, pin, cvv, iban, ssn, ...);
- free of secret-looking runs: 4+ digit sequences, 16+ character opaque tokens,
  base64-ish blobs, email addresses, IP addresses.

Everything else is masked and the region shows its role alone. Absence of a
label is the fail-closed default, never an error.

Two non-control roles were added, `Text` and `Heading`, so page content that
touches no control is still observable. Controls may also carry a
server-constant `state` (`disabled`, `checked`, `selected`); an unrecognized
state is rejected outright.

## What is still impossible

- **Input values are never read.** The capture reads rendered text nodes only.
  An `<input value="...">` has no text node, so a field's contents cannot become
  a label by any path.
- **Sensitive kinds never carry text**, whatever the capture supplies. The
  redactor drops the label on `Password`, `Secret` and `Authentication` even if
  a compromised or buggy capture attached one. This is tested directly.
- **Page-derived text is XML-escaped** before entering the SVG mask, so a label
  cannot build mask geometry.
- No page source, attribute names, DOM internals, session identity or internal
  ids appear in the layout. Asserted against a real page.
- Shadow DOM, multi-document (iframe) and oversized snapshots still throw, and
  no page script is evaluated — the capture remains fixed CDP
  `DOMSnapshot.captureSnapshot`.
- Text-region overflow past the 200-region cap is dropped, not raised: less
  disclosure is always the safe outcome.

## Tests

| Requirement                           | Where                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------ |
| safe visible text/labels exposed      | redactor unit + real Chrome capture                                      |
| password/token/OTP content removed    | redactor unit (label forced onto a sensitive kind) + real Chrome capture |
| non-control UI changes observable     | `Heading` region changes the rendered pixels; layout revision changes    |
| ambiguous/unclassified content masked | OTP, token, credential word, prose and address cases                     |
| stale observation rejection           | Phase 6.8 suite, still green                                             |
| real Chrome observation behaviour     | `computer-use-provider.integration.test.ts`                              |

The redactor metadata version moved to `opaque-structural-v2` and now reports
`disclosedLabels` alongside `sensitiveControls`.

## Limitations

**A secret rendered as ordinary prose can still be disclosed if it looks like a
label.** The classifier is shape- and keyword-based, not semantic. A short,
word-shaped, innocuous-looking string containing confidential information —
a person's name, an order total, a room number — will pass. This phase narrows
disclosure to plausible UI labels; it does not and cannot decide what is
confidential in a customer's application. Anything stronger needs either an
explicit per-site policy or a trusted classifier, and neither is in scope here.

**The classifier is deliberately over-eager to mask.** Legitimate labels
containing digits ("Order 4815162342", "2 items") or longer than six words are
withheld. A withheld label costs the model context; a disclosed credential costs
the user their account.
