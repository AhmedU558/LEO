# Phase 6.7: live vision model integration and production computer-use validation

Baseline: `415390ef352fa479617ad59b5c67ac548ec21411`, branch `leo-next`.

## Status

**NOT COMPLETE.** The gated live test is implemented and verified in both gate
states, but it has **not executed against a real provider** — this environment
has no vision-model credentials. Phase 6.7's acceptance condition is that the
live test actually runs and passes, so the phase stays open until it does.

Nothing in this phase may be read as evidence that live inference works. It is
evidence that the harness which would prove it is in place and fails closed.

## What already existed

Phase 6.7 required no new execution architecture, and none was added. The
production path built in 6.4–6.6 already performs real inference:

- `OpenAIComputerActionProposer` (`packages/core/src/computer/model-adapter.ts`)
  issues a real vision completion through `OpenAIProvider`.
- `OpenAIProvider.completeTransient` performs a real `fetch` to
  `${baseUrl}/chat/completions`, bounded by `maxResponseBytes`, a timeout, and an
  `AbortSignal.any([caller, timeout])` that propagates cancellation into the
  request itself.
- `BaseProvider` serialises `{ type: 'image', data, mediaType }` into OpenAI's
  `image_url` data URI, so the redacted screenshot genuinely reaches the model.
- `workflow/executors/browser.ts` resolves the key and model via `getApiKey` and
  `resolveDefaultProviderAndModel` and **throws** when either is absent. There is
  no fallback from real inference to a deterministic proposer.

What was missing was not capability but _proof_: every existing test either
substitutes a deterministic proposer (`vision-loop.integration.test.ts`) or stubs
global `fetch` (`model-adapter.integration.test.ts`). Neither can demonstrate
that a real model can satisfy the closed proposal schema.

## What this phase adds

`packages/gateway/src/services/computer/live-vision-model.integration.test.ts`.

It reuses the Phase 6.6 harness — real PostgreSQL, real job queue, real
execution-task service, real durable approvals, real Chrome, real ActionLedger —
and differs from it in exactly three ways:

1. `@ownpilot/core/computer` is **not** mocked, so the real proposer runs.
2. Global `fetch` is wrapped by a **pass-through recorder**, never a stub: it
   observes the request and response and then returns the real one.
3. Credentials come from the environment through the same `app-settings` seam
   production uses.

### Gating

The normal suite must not need credentials, so the live suite is skipped unless
`LEO_QA_LIVE_MODEL=1`:

```
LEO_QA_LIVE_MODEL=1
LEO_QA_LIVE_MODEL_API_KEY=...      # or OPENAI_API_KEY
LEO_QA_LIVE_MODEL_NAME=gpt-4o      # must be vision-capable
LEO_QA_LIVE_MODEL_BASE_URL=...     # optional, defaults to OpenAI
LEO_QA_POSTGRES_URL=postgres://...
LEO_QA_BROWSER=1
```

When the switch is set but configuration is incomplete the suite **fails** with
an explicit message. It never skips and never substitutes a mock, so a green
live run cannot be the product of absent configuration. Two unconditional tests
in the normal suite pin that behaviour in both directions.

### What the live test asserts

- An actual outbound HTTPS request reached `/chat/completions` at the configured
  base URL, carried an `Authorization` header, and returned 200 with a body.
- The image in the request body is **byte-for-byte** the output of
  `StructuralScreenshotRedactor` for that observation — the redactor cannot have
  been bypassed, and the raw capture was not sent.
- The request body contains none of: the API key, task id, workspace id, user id,
  session id, database URL, the page's synthetic secrets, page text, page source,
  or ledger content.
- The response parsed through `parseComputerProposal` and carried exactly the
  three permitted keys, with no capability of its own.
- `PolicyEngine.evaluate` ran, a durable approval was created, a foreign
  workspace could not resolve it, and the owner's approval resumed the task.
- The real `PuppeteerComputerUseProvider` method matching the model's chosen
  action was invoked against Chrome.
- `action_ledger` recorded the action with the **server-derived** capability, and
  absorbed no page secrets.
- Cancelling before the propose phase spends no inference.

The assertions are action-agnostic: a real model may legitimately choose any of
the nine allowed actions, so the test measures the pipeline rather than gambling
on a particular one. The proposal is logged on each run so a non-compliant model
response is diagnosable as model non-compliance rather than a pipeline defect.

## Unrelated fix

`packages/gateway/src/qa012.integration.test.ts` threw in `beforeAll` when
`LEO_QA_POSTGRES_URL` was unset, so a credential-free run reported a failed suite
with all of its tests skipped. It now uses `describe.skipIf(!url)` like every
other integration suite in the repository. This is the same requirement Phase 6.7
states: the normal suite must be independent of external services.

## Security posture

No control was weakened. Verified against source during this phase:

- The proposer request object is constructed fresh in `ComputerService.proposeAction`
  and contains only `{ observation: { screenshot, viewport, untrusted, disclosure }, signal }`.
- The model-proposable action set is the ten entries in `model-adapter.ts`;
  `computerCapability` throws on `execute_shell`, `read_file` and `write_file`.
- The actuator exposes only those primitives plus `initialize`,
  `inspectForRedaction` and `cancel`. No `page.evaluate`, shell, filesystem or
  clipboard reaches this path.
- Redaction layout is read with fixed CDP `DOMSnapshot.captureSnapshot` commands;
  no model-controlled script is evaluated.
- Freshness is checked before and after inference (`session.count` version and
  layout `revision`), and again before dispatch.
- UNKNOWN outcomes finish the durable operation as `unknown` and cancel the task;
  they are never automatically replayed.

## Remaining work to close Phase 6.7

Run the live test with real credentials:

```bash
cd packages/gateway
LEO_QA_LIVE_MODEL=1 \
LEO_QA_LIVE_MODEL_API_KEY=... \
LEO_QA_LIVE_MODEL_NAME=gpt-4o \
LEO_QA_POSTGRES_URL=postgres://... \
LEO_QA_BROWSER=1 \
node ../../node_modules/vitest/vitest.mjs run \
  src/services/computer/live-vision-model.integration.test.ts
```

Until that run passes, live external vision-model inference remains
**NOT VERIFIED**.
