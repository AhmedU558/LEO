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
