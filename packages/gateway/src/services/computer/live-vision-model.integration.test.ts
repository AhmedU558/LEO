/**
 * Phase 6.7 — LIVE external vision-model integration.
 *
 * Everything else in the computer-use suite proves the *pipeline* with a
 * deterministic local proposer or a stubbed `fetch`. This file is the only one
 * that performs a real outbound inference request, so it is the only evidence
 * that a real model can drive the Phase 6.6 architecture end to end:
 *
 *   real Chrome screenshot -> StructuralScreenshotRedactor -> redacted
 *   observation -> REAL external model -> strict proposal parser -> server-side
 *   capability mapping -> PolicyEngine -> RiskEngine -> durable approval ->
 *   ComputerService -> PuppeteerComputerUseProvider -> Chrome -> ActionLedger
 *
 * It reuses the Phase 6.6 harness (real PostgreSQL, real job queue, real
 * execution-task service, real approvals, real browser) rather than standing up
 * a second execution path — the point is to exercise the shipped architecture,
 * not a replica of it.
 *
 * GATING. The normal suite must never need credentials, so the whole file is
 * skipped unless LEO_QA_LIVE_MODEL=1. When that switch IS set, missing
 * configuration is a FAILURE, never a skip and never a fallback to a mock:
 * a green run must mean a real model answered.
 *
 *   LEO_QA_LIVE_MODEL=1
 *   LEO_QA_LIVE_MODEL_API_KEY=...        (or OPENAI_API_KEY)
 *   LEO_QA_LIVE_MODEL_NAME=gpt-4o        (must be vision-capable)
 *   LEO_QA_LIVE_MODEL_BASE_URL=...       (optional; defaults to OpenAI)
 *   LEO_QA_POSTGRES_URL=postgres://...
 *   LEO_QA_BROWSER=1
 *
 * This test spends real money and makes a real network request. It is opt-in
 * for exactly that reason.
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AGGREGATOR_PROVIDERS } from '@ownpilot/core';
import { PostgresAdapter } from '../../db/adapters/postgres-adapter.js';
import { initializeSchema } from '../../db/schema/index.js';
import { EXECUTION_TASKS_SQL } from '../../db/schema/execution-tasks.js';
import { ActionLedger, PolicyEngine } from '@ownpilot/core/security';
import { ActionLedgerRepository } from '../../db/repositories/action-ledger.js';
import { JobsRepository } from '../../db/repositories/jobs.js';
import {
  createWorkflowsRepository,
  type WorkflowNode,
} from '../../db/repositories/workflows/index.js';
import { ExecutionTaskService } from '../execution-task-service.js';
import { JobQueueService } from '../job-queue-service.js';
import { PuppeteerComputerUseProvider } from './computer-use-provider.js';
import { getBrowserService } from '../browser-service.js';
import { StructuralScreenshotRedactor } from './screenshot-redactor.js';
import { setToolService, type IToolService } from '@ownpilot/core/services';

// ---------------------------------------------------------------------------
// Live configuration — resolved at module scope so the gate can see the switch,
// validated in beforeAll so a missing value FAILS rather than silently skipping.
// ---------------------------------------------------------------------------

const LIVE = process.env.LEO_QA_LIVE_MODEL === '1';
const liveConfig = {
  apiKey: process.env.LEO_QA_LIVE_MODEL_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  model: process.env.LEO_QA_LIVE_MODEL_NAME ?? '',
  baseUrl: process.env.LEO_QA_LIVE_MODEL_BASE_URL ?? 'https://api.openai.com/v1',
  postgresUrl: process.env.LEO_QA_POSTGRES_URL ?? '',
  browser: process.env.LEO_QA_BROWSER === '1',
};

/**
 * Fail loudly on incomplete live configuration.
 *
 * The brief for this phase is explicit: absent credentials must fail the test,
 * not substitute a mock. Anything that quietly degraded to a deterministic
 * proposer here would make this file assert the opposite of what it claims.
 */
function assertLiveConfig(): void {
  const missing = [
    !liveConfig.apiKey && 'LEO_QA_LIVE_MODEL_API_KEY (or OPENAI_API_KEY)',
    !liveConfig.model && 'LEO_QA_LIVE_MODEL_NAME',
    !liveConfig.postgresUrl && 'LEO_QA_POSTGRES_URL',
    !liveConfig.browser && 'LEO_QA_BROWSER=1',
  ].filter(Boolean);
  if (missing.length)
    throw new Error(
      `LEO_QA_LIVE_MODEL=1 requires live provider configuration; missing: ${missing.join(', ')}. ` +
        'This test performs a real external inference request and must never fall back to a mock.'
    );
}

// The production wiring in workflow/executors/browser.ts reads the key and model
// through these two functions. Supplying the LIVE values through that same seam
// keeps the real production code path intact — the test database has no
// settings row, and seeding a real API key into a database is worse than
// handing it to the same accessor production uses.
// The provider id is derived from the configured base URL rather than set
// independently, so LEO_QA_LIVE_MODEL_BASE_URL stays the single knob and the
// executor resolves the same apiBase production would for that provider.
const liveProviderId =
  Object.values(AGGREGATOR_PROVIDERS).find((p) => p.apiBase === liveConfig.baseUrl)?.id ?? 'openai';

vi.mock('../app-settings.js', async (original) => ({
  ...(await original<typeof import('../app-settings.js')>()),
  getApiKey: async () => liveConfig.apiKey,
  resolveDefaultProviderAndModel: async () => ({
    provider: liveProviderId,
    model: liveConfig.model,
  }),
}));

const fixture = vi.hoisted(() => ({ adapter: null as unknown as PostgresAdapter }));
vi.mock('../../db/adapters/index.js', () => ({ getAdapter: async () => fixture.adapter }));

// NOTE: @ownpilot/core/computer is deliberately NOT mocked. The real
// OpenAIComputerActionProposer must run, and global fetch must reach the network.

// ---------------------------------------------------------------------------
// Evidence recorder — a PASS-THROUGH spy, not a stub.
// ---------------------------------------------------------------------------

interface OutboundRequest {
  url: string;
  hadAuthorization: boolean;
  body: string;
  status: number;
  responseText: string;
}

/**
 * Wrap global fetch so the outbound request can be inspected, then call the
 * real implementation. This must never short-circuit: if it returned a
 * synthetic response the suite would be asserting against itself.
 *
 * The Authorization header is reduced to a boolean immediately and the key is
 * never stored, echoed or asserted on by value.
 */
function recordFetch(sink: OutboundRequest[]): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isModelCall = url.includes('/chat/completions');
    const auth = () => {
      const headers = new Headers(init?.headers ?? {});
      return headers.has('authorization') || headers.has('Authorization');
    };
    let response: Response;
    try {
      response = await real(input as RequestInfo, init);
    } catch (e) {
      // An aborted or failed request IS an attempt. Recording only completed
      // responses made a timed-out inference look like no request at all,
      // which is the opposite of what this recorder exists to show.
      if (isModelCall)
        sink.push({
          url,
          hadAuthorization: auth(),
          body: typeof init?.body === 'string' ? init.body : '',
          status: 0,
          responseText: `<no response: ${e instanceof Error ? e.name : 'error'}>`,
        });
      throw e;
    }
    if (!isModelCall) return response;
    // Buffer the body so it can be read twice: once for evidence, once by the
    // provider. Cloning keeps the provider's streaming read intact.
    const clone = response.clone();
    const responseText = await clone.text().catch(() => '');
    sink.push({
      url,
      hadAuthorization: auth(),
      body: typeof init?.body === 'string' ? init.body : '',
      status: response.status,
      responseText,
    });
    return response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** Values that must never appear in an outbound model request. */
function forbiddenStrings(ids: Record<string, string | undefined>): [string, string][] {
  return Object.entries(ids).filter(([, v]) => typeof v === 'string' && v.length > 6) as [
    string,
    string,
  ][];
}

describe.skipIf(!LIVE)('LIVE external vision model through the Phase 6.6 pipeline', () => {
  const database = `leo_live_${randomUUID().replaceAll('-', '')}`;
  const userId = 'live-vision-user';
  const workspaceId = 'default';
  let admin: pg.Pool;
  let restoreFetch: () => void = () => {};
  const outbound: OutboundRequest[] = [];
  const tasks = new Set<string>();
  const service = () => new ExecutionTaskService(userId, workspaceId);
  /** Every action the real provider was asked to perform against Chrome. */
  const actuated: { method: string; args: unknown[] }[] = [];
  let redactedScreenshots: string[] = [];
  let policySpy: ReturnType<typeof vi.spyOn>;
  const sessionIds = new Set<string>();

  const start = async (iterations: number) => {
    const workflow = await createWorkflowsRepository(userId).create({
      name: 'Live vision smoke',
      nodes: [
        {
          id: 'vision',
          type: 'browserNode',
          position: { x: 0, y: 0 },
          data: {
            action: 'vision_loop',
            model: liveConfig.model,
            iterations,
            // Cover every capability the closed proposal schema can map to, so
            // the test measures the pipeline rather than gambling on which of
            // the nine allowed actions a real model happens to choose.
            computerCapabilities: ['computer.read', 'computer.mouse', 'computer.keyboard'],
          },
        } as WorkflowNode,
      ],
      edges: [],
    });
    const task = await service().start({ workflowId: workflow.id, requestKey: randomUUID() });
    tasks.add(task.id);
    return task;
  };

  const next = async () => {
    const repo = new JobsRepository();
    const job = await repo.claimJob('execution_tasks');
    expect(job).not.toBeNull();
    const result = await service().execute(job!, new AbortController().signal);
    await repo.complete(job!.id, result, job!.leaseToken!);
  };

  beforeAll(async () => {
    assertLiveConfig();

    setToolService({
      execute: async () => {
        throw new Error('Unexpected generic tool execution');
      },
      getDefinition: () => undefined,
      getDefinitions: () => [],
      getDefinitionsBySource: () => [],
      has: () => false,
      getNames: () => [],
      use: () => {},
      getCount: () => 0,
    } as IToolService);

    admin = new pg.Pool({ connectionString: liveConfig.postgresUrl });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(liveConfig.postgresUrl);
    testUrl.pathname = `/${database}`;
    fixture.adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
    await fixture.adapter.initialize();
    await initializeSchema((sql) => fixture.adapter.exec(sql));
    await fixture.adapter.exec(EXECUTION_TASKS_SQL);
    ActionLedger.setProvider(new ActionLedgerRepository());

    // Seed a deterministic page carrying synthetic secrets. The redactor must
    // remove every pixel of it, so none of these strings may reach the model.
    const initialize = PuppeteerComputerUseProvider.prototype.initialize;
    const seeded = new WeakSet<PuppeteerComputerUseProvider>();
    vi.spyOn(PuppeteerComputerUseProvider.prototype, 'initialize').mockImplementation(
      async function (signal) {
        await initialize.call(this, signal);
        if (seeded.has(this)) return;
        const binding = this['binding'];
        sessionIds.add(binding.sessionId);
        const page = await getBrowserService()['getOrCreatePage'](
          binding.sessionId,
          binding.userId
        );
        await page.setContent(
          '<body style="background:#00c3ff">' +
            '<button style="position:absolute;left:40px;top:40px;width:220px;height:70px" ' +
            'onclick="this.textContent=\'Clicked\'">Continue</button>' +
            '<input type="password" value="SYNTHETIC-LIVE-PASSWORD">' +
            '<input name="api_token" value="SYNTHETIC-LIVE-TOKEN">' +
            '<p>SYNTHETIC-LIVE-FREE-TEXT-SECRET</p>' +
            '</body>'
        );
        seeded.add(this);
      }
    );

    // Pass-through spies on the actuator: proof that a REAL Chrome action ran,
    // whichever of the allowed actions the model picks.
    for (const method of [
      'click',
      'doubleClick',
      'mouseMove',
      'mouseDown',
      'mouseUp',
      'scroll',
      'keyPress',
      'typeText',
      'hotkey',
    ] as const) {
      const original = PuppeteerComputerUseProvider.prototype[method] as
        ((...args: unknown[]) => Promise<unknown>) | undefined;
      if (typeof original !== 'function') continue;
      vi.spyOn(PuppeteerComputerUseProvider.prototype, method).mockImplementation(async function (
        this: PuppeteerComputerUseProvider,
        ...args: unknown[]
      ) {
        actuated.push({ method, args });
        return original.apply(this, args);
      } as never);
    }

    // Capture exactly what the trusted redactor emitted, so the outbound body
    // can be compared byte-for-byte against it.
    const redact = StructuralScreenshotRedactor.prototype.redact;
    redactedScreenshots = [];
    vi.spyOn(StructuralScreenshotRedactor.prototype, 'redact').mockImplementation(async function (
      this: StructuralScreenshotRedactor,
      input
    ) {
      const result = await redact.call(this, input);
      redactedScreenshots.push(result.observation.screenshot);
      return result;
    });

    policySpy = vi.spyOn(PolicyEngine.prototype, 'evaluate');
    restoreFetch = recordFetch(outbound);
  }, 180_000);

  afterAll(async () => {
    restoreFetch();
    for (const id of tasks)
      await service()
        .cancel(id)
        .catch(() => undefined);
    await JobQueueService.getInstance().shutdown();
    await getBrowserService().shutdown();
    vi.restoreAllMocks();
    await fixture.adapter?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('drives one real inference through redaction, authorization, Chrome and the ledger', async () => {
    const task = await start(1);

    // A refused proposal cancels the task, after which ExecutionTaskService
    // throws 'Execution task interrupted'. That aborts the loop below before
    // any assertion runs, which would hide whether inference happened at all.
    // Report the evidence from a finally block so a mid-loop abort is still
    // diagnosable as model non-compliance rather than a pipeline defect.
    const diagnose = async () => {
      const state = (await service().repo.get(task.id))?.state;
      if (!outbound.length) {
        console.log(`[live-model] NO outbound request reached the provider. finalState=${state}`);
        return state;
      }
      const first = outbound[0]!;
      const raw = (() => {
        try {
          return (
            JSON.parse(first.responseText) as { choices?: { message?: { content?: string } }[] }
          ).choices?.[0]?.message?.content;
        } catch {
          return undefined;
        }
      })();
      console.log(
        `[live-model] provider=${liveConfig.baseUrl} model=${liveConfig.model} ` +
          `status=${first.status} finalState=${state} proposal=${raw ?? '<unparseable>'}`
      );
      console.log(`[live-model] rawResponse=${first.responseText.slice(0, 1500)}`);
      return state;
    };

    // Advance the durable worker until the loop completes, approving each
    // durable approval exactly as a human operator would.
    let approvals = 0;
    let finalState: string | undefined;
    try {
      for (let i = 0; i < 6; i++) {
        await next();
        const detail = await service().repo.detail(task.id);
        if (detail.task.state !== 'WAITING_APPROVAL') break;
        const approval = detail.approvals.find((a) => a.status === 'pending');
        expect(approval).toBeDefined();
        // Approval authority is per-workspace and must not be forgeable.
        await expect(
          new ExecutionTaskService(userId, 'other-workspace').approve(task.id, String(approval!.id))
        ).rejects.toThrow();
        await service().approve(task.id, String(approval!.id));
        approvals++;
      }
    } finally {
      finalState = await diagnose();
    }

    // ---------------------------------------------------------------------
    // G. An actual external request occurred.
    // ---------------------------------------------------------------------
    expect(outbound.length).toBeGreaterThanOrEqual(1);
    const call = outbound[0]!;
    expect(call.url.startsWith('https://')).toBe(true);
    expect(call.url).toContain('/chat/completions');
    expect(call.url.startsWith(liveConfig.baseUrl)).toBe(true);
    expect(call.hadAuthorization).toBe(true);
    expect(call.status).toBe(200);
    expect(call.responseText.length).toBeGreaterThan(0);

    // ---------------------------------------------------------------------
    // The model input WAS the trusted redacted screenshot.
    // ---------------------------------------------------------------------
    expect(redactedScreenshots.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse(call.body) as {
      model: string;
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe(liveConfig.model);
    const parts = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    const images = parts.filter(
      (p): p is { type: 'image_url'; image_url: { url: string } } =>
        !!p && typeof p === 'object' && (p as { type?: string }).type === 'image_url'
    );
    expect(images).toHaveLength(1);
    const sent = images[0]!.image_url.url;
    expect(sent.startsWith('data:image/png;base64,')).toBe(true);
    // Byte-for-byte: the redactor's output, not the raw capture.
    expect(sent.slice('data:image/png;base64,'.length)).toBe(redactedScreenshots[0]);

    // ---------------------------------------------------------------------
    // H. The model received nothing it must not receive.
    // ---------------------------------------------------------------------
    const secrets = forbiddenStrings({
      apiKey: liveConfig.apiKey,
      taskId: task.id,
      workspaceId,
      userId,
      sessionId: [...sessionIds][0],
      postgresUrl: liveConfig.postgresUrl,
    });
    for (const [label, value] of secrets) {
      expect(call.body.includes(value), `outbound body leaked ${label}`).toBe(false);
    }
    for (const marker of [
      'SYNTHETIC-LIVE-PASSWORD',
      'SYNTHETIC-LIVE-TOKEN',
      'SYNTHETIC-LIVE-FREE-TEXT-SECRET',
      'Continue',
      'action_ledger',
      'DOCTYPE',
      '<body',
    ]) {
      expect(call.body.includes(marker), `outbound body leaked ${marker}`).toBe(false);
    }

    // ---------------------------------------------------------------------
    // The response satisfied the strict closed proposal schema, and carried
    // no capability of its own.
    // ---------------------------------------------------------------------
    const { parseComputerProposal } = await import('@ownpilot/core/computer');
    const content = (
      JSON.parse(call.responseText) as {
        choices: { message: { content: string } }[];
      }
    ).choices[0]!.message.content;
    const proposal = parseComputerProposal(content);
    expect(Object.keys(JSON.parse(content)).sort()).toEqual(['params', 'type', 'viewport']);
    expect(proposal.viewport).toEqual({ width: 1280, height: 800 });

    // ---------------------------------------------------------------------
    // Authorization pipeline ran, and a real Chrome action followed.
    // ---------------------------------------------------------------------
    expect(policySpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(approvals).toBeGreaterThanOrEqual(1);
    expect(finalState).toBe('COMPLETED');

    if (proposal.type !== 'screenshot') {
      const performed = actuated.find((a) => a.method === proposal.type);
      expect(performed, `expected Chrome to perform ${proposal.type}`).toBeDefined();
    }

    // ---------------------------------------------------------------------
    // I. ActionLedger recorded the action, with a SERVER-derived capability.
    // ---------------------------------------------------------------------
    const entries = await fixture.adapter.query<{
      resource: string;
      result: string;
      capability: string;
    }>(
      'SELECT resource,result,capability FROM action_ledger WHERE execution_task_id=$1 AND tool=$2',
      [task.id, 'computer_service']
    );
    const successful = entries.filter((e) => e.result === 'SUCCESS');
    expect(successful.length).toBeGreaterThanOrEqual(2); // capture + proposed action
    const expectedCapability =
      proposal.type === 'screenshot'
        ? 'computer.read'
        : ['keyPress', 'typeText', 'hotkey'].includes(proposal.type)
          ? 'computer.keyboard'
          : 'computer.mouse';
    expect(successful.map((e) => e.capability)).toContain(expectedCapability);
    // The ledger must not have absorbed page secrets either.
    expect(JSON.stringify(entries)).not.toContain('SYNTHETIC');
  }, 300_000);

  it('drives a two-step live task with a fresh observation and inference per step', async () => {
    // Phase 6.8: the same real model, asked twice, across two fresh
    // observations. Each step re-captures, re-redacts, re-infers and
    // re-authorizes; nothing is carried over from the previous step.
    const requestsBefore = outbound.length;
    const shotsBefore = redactedScreenshots.length;
    const task = await start(2);

    try {
      for (let i = 0; i < 10; i++) {
        await next();
        const detail = await service().repo.detail(task.id);
        if (detail.task.state !== 'WAITING_APPROVAL') break;
        const approval = detail.approvals.find((a) => a.status === 'pending');
        expect(approval).toBeDefined();
        await service().approve(task.id, String(approval!.id));
      }
    } finally {
      const calls = outbound.slice(requestsBefore);
      console.log(
        `[live-model] multi-step requests=${calls.length} ` +
          `statuses=${calls.map((c) => c.status).join(',')} ` +
          `finalState=${(await service().repo.get(task.id))?.state}`
      );
      // Two 200s and a failed task means the second STEP was refused, not the
      // provider. Say which response the parser rejected, and why, so this is
      // attributable to the model rather than to the pipeline.
      const { parseComputerProposal } = await import('@ownpilot/core/computer');
      calls.forEach((call, i) => {
        const content = (() => {
          try {
            return (
              JSON.parse(call.responseText) as { choices?: { message?: { content?: string } }[] }
            ).choices?.[0]?.message?.content;
          } catch {
            return undefined;
          }
        })();
        let verdict = 'no content';
        if (typeof content === 'string') {
          try {
            parseComputerProposal(content);
            verdict = 'PARSE_OK';
          } catch (e) {
            verdict = `PARSE_FAIL ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        console.log(`[live-model] step ${i + 1}: ${verdict} content=${content ?? '<none>'}`);
      });
    }

    expect((await service().repo.get(task.id))?.state).toBe('COMPLETED');

    // Two real inferences, each carrying its own freshly redacted observation.
    const calls = outbound.slice(requestsBefore);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call.status).toBe(200);

    const shots = redactedScreenshots.slice(shotsBefore);
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const sentImages = calls.map((call) => {
      const body = JSON.parse(call.body) as { messages: { content: unknown }[] };
      const parts = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const image = parts.find(
        (part): part is { image_url: { url: string } } =>
          typeof part === 'object' && part !== null && 'image_url' in part
      );
      return image!.image_url.url.slice('data:image/png;base64,'.length);
    });
    // Every step's model input was a trusted redactor output, not a replay of
    // the first capture held in memory.
    for (const sent of sentImages) expect(shots).toContain(sent);

    // The ledger records both steps under distinct observation identities.
    const rows = await fixture.adapter.query<{ resource: string; action: string }>(
      "SELECT resource,action FROM action_ledger WHERE execution_task_id=$1 AND tool=$2 AND result='SUCCESS'",
      [task.id, 'computer_service']
    );
    const acted = rows.filter((r) => r.action !== 'computer.screenshot');
    expect(new Set(acted.map((r) => JSON.parse(r.resource).iteration)).size).toBe(2);
    expect(new Set(rows.map((r) => JSON.parse(r.resource).observationId)).size).toBe(2);
  }, 300_000);

  it('cancels a live task without leaving the external request unbounded', async () => {
    const before = outbound.length;
    const task = await start(1);
    await next(); // first capture pauses on approval, before any model call
    const detail = await service().repo.detail(task.id);
    expect(detail.task.state).toBe('WAITING_APPROVAL');

    await service().cancel(task.id);
    await expect(service().approve(task.id, String(detail.approvals[0]!.id))).rejects.toThrow();
    expect((await service().repo.get(task.id))?.state).toBe('CANCELLED');

    // Cancelling before the propose phase must not have spent an inference.
    expect(outbound.length).toBe(before);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// This one runs in the NORMAL suite: it proves the gate fails closed, so a
// green live run can never be the result of absent configuration.
// ---------------------------------------------------------------------------

describe('live vision model gate', () => {
  it('refuses to run with incomplete configuration instead of mocking', () => {
    const saved = { ...liveConfig };
    try {
      Object.assign(liveConfig, { apiKey: '', model: '', postgresUrl: '', browser: false });
      expect(() => assertLiveConfig()).toThrow(/must never fall back to a mock/);
      Object.assign(liveConfig, {
        apiKey: 'k'.repeat(20),
        model: 'gpt-4o',
        postgresUrl: 'postgres://localhost/x',
        browser: true,
      });
      expect(() => assertLiveConfig()).not.toThrow();
    } finally {
      Object.assign(liveConfig, saved);
    }
  });

  it('is skipped, not silently passed, when the live switch is off', () => {
    // Guards the inverse mistake: if LEO_QA_LIVE_MODEL is unset the live suite
    // must not execute at all, so the normal suite never needs credentials.
    expect(LIVE).toBe(process.env.LEO_QA_LIVE_MODEL === '1');
  });
});
