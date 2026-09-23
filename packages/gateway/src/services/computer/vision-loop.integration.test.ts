import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresAdapter } from '../../db/adapters/postgres-adapter.js';
import { initializeSchema } from '../../db/schema/index.js';
import { EXECUTION_TASKS_SQL } from '../../db/schema/execution-tasks.js';
import { ActionLedger } from '@ownpilot/core/security';
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
import { COMPUTER_VIEWPORT } from '@ownpilot/core/computer';
import { setToolService, type IToolService } from '@ownpilot/core/services';

const fixture = vi.hoisted(() => ({ model: vi.fn(), adapter: null as unknown as PostgresAdapter }));
vi.mock('../../db/adapters/index.js', () => ({ getAdapter: async () => fixture.adapter }));
vi.mock('../app-settings.js', async (original) => ({
  ...(await original<typeof import('../app-settings.js')>()),
  getApiKey: async () => 'synthetic-test-only',
  resolveDefaultProviderAndModel: async () => ({ provider: 'openai', model: 'fixture' }),
}));
vi.mock('@ownpilot/core/computer', async (original) => ({
  ...(await original<typeof import('@ownpilot/core/computer')>()),
  OpenAIComputerActionProposer: class {
    metadata = { provider: 'test', model: 'fixture' };
    propose = fixture.model;
  },
}));
const url = process.env.LEO_QA_POSTGRES_URL;
describe.skipIf(!url || process.env.LEO_QA_BROWSER !== '1')(
  'durable bounded vision workflow with PostgreSQL and Chrome',
  () => {
    const database = `leo_vision_${randomUUID().replaceAll('-', '')}`;
    let admin: pg.Pool;
    let clicked = false;
    // Captured so a test can change the browser under the model, exercising the
    // real 'Browser changed after proposal' guard instead of simulating it.
    let seededBinding: { sessionId: string; userId: string } | undefined;
    const seededPage = () =>
      getBrowserService()['getOrCreatePage'](seededBinding!.sessionId, seededBinding!.userId);
    const tasks = new Set<string>();
    const service = () => new ExecutionTaskService('vision-user', 'default');
    const start = async (iterations = 2) => {
      const workflow = await createWorkflowsRepository('vision-user').create({
        name: 'Synthetic vision',
        nodes: [
          {
            id: 'vision',
            type: 'browserNode',
            position: { x: 0, y: 0 },
            data: {
              action: 'vision_loop',
              model: 'fixture',
              iterations,
              computerCapabilities: ['computer.read', 'computer.mouse'],
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
      admin = new pg.Pool({ connectionString: url });
      await admin.query(`CREATE DATABASE "${database}"`);
      const testUrl = new URL(url!);
      testUrl.pathname = `/${database}`;
      fixture.adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
      await fixture.adapter.initialize();
      await initializeSchema((sql) => fixture.adapter.exec(sql));
      await fixture.adapter.exec(EXECUTION_TASKS_SQL);
      ActionLedger.setProvider(new ActionLedgerRepository());
      const initialize = PuppeteerComputerUseProvider.prototype.initialize;
      const seeded = new WeakSet<PuppeteerComputerUseProvider>();
      vi.spyOn(PuppeteerComputerUseProvider.prototype, 'initialize').mockImplementation(
        async function (signal) {
          await initialize.call(this, signal);
          if (!seeded.has(this)) {
            const binding = this['binding'];
            seededBinding = { sessionId: binding.sessionId, userId: binding.userId };
            const page = await getBrowserService()['getOrCreatePage'](
              binding.sessionId,
              binding.userId
            );
            await page.setContent(
              // The click adds a second BUTTON. The redactor paints a white
              // canvas and draws boxes only for recognized control kinds, so a
              // relabelled fixed-size button — or any non-control element —
              // leaves the next observation byte-identical and no test could
              // tell a fresh capture from a replayed one.
              `<body style="background:#ff00ff"><button style="position:absolute;left:0;top:0;width:100px;height:60px" onclick="this.textContent='Clicked';document.body.appendChild(Object.assign(document.createElement('button'),{textContent:'Next',style:'position:absolute;left:300px;top:400px;width:200px;height:80px'}))">Go</button><input type="password" value="SYNTHETIC-PASSWORD"><input name="api_token" value="SYNTHETIC-TOKEN"><input autocomplete="one-time-code" value="123456"><p>SYNTHETIC-FREE-TEXT-SECRET</p></body>`
            );
            seeded.add(this);
          }
        }
      );
      const click = PuppeteerComputerUseProvider.prototype.click;
      vi.spyOn(PuppeteerComputerUseProvider.prototype, 'click').mockImplementation(
        async function (x, y) {
          await click.call(this, x, y);
          const page = await getBrowserService()['getOrCreatePage'](
            this['binding'].sessionId,
            this['binding'].userId
          );
          clicked = (await page.$eval('button', (button) => button.textContent)) === 'Clicked';
        }
      );
    });
    beforeEach(() => {
      clicked = false;
      fixture.model.mockReset();
      fixture.model
        .mockResolvedValueOnce({
          type: 'mouseMove',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        })
        .mockResolvedValueOnce({
          type: 'click',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        });
    });
    afterAll(async () => {
      for (const id of tasks) await service().cancel(id);
      await JobQueueService.getInstance().shutdown();
      await getBrowserService().shutdown();
      vi.restoreAllMocks();
      await fixture.adapter?.close();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await admin.end();
      }
    });
    it('executes two fresh, redacted iterations through real durable approvals and records correlated audit', async () => {
      const task = await start();
      let approvals = 0;
      for (let i = 0; i < 5; i++) {
        await next();
        const detail = await service().repo.detail(task.id);
        if (detail.task.state === 'COMPLETED') break;
        expect(detail.task.state).toBe('WAITING_APPROVAL');
        const approval = detail.approvals.find((a) => a.status === 'pending');
        expect(approval).toBeDefined();
        const modelCalls = fixture.model.mock.calls.length;
        await expect(
          new ExecutionTaskService('vision-user', 'other').approve(task.id, String(approval!.id))
        ).rejects.toThrow();
        await service().approve(task.id, String(approval!.id));
        expect(fixture.model).toHaveBeenCalledTimes(modelCalls);
        approvals++;
      }
      expect((await service().repo.get(task.id))?.state).toBe('COMPLETED');
      expect(approvals).toBe(3);
      expect(clicked).toBe(true);
      expect(fixture.model).toHaveBeenCalledTimes(2);
      for (const [request] of fixture.model.mock.calls) {
        expect(Object.keys(request).sort()).toEqual(['observation', 'signal']);
        expect(request.observation.disclosure).toBe('redacted');
        const bytes = Buffer.from(request.observation.screenshot, 'base64');
        const raw = await sharp(bytes).removeAlpha().raw().toBuffer();
        expect([...raw.subarray((700 * 1280 + 700) * 3, (700 * 1280 + 700) * 3 + 3)]).toEqual([
          255, 255, 255,
        ]);
      }
      const entries = await fixture.adapter.query<{
        resource: string;
        result: string;
        capability: string;
      }>(
        'SELECT resource,result,capability FROM action_ledger WHERE execution_task_id=$1 AND tool=$2',
        [task.id, 'computer_service']
      );
      const successful = entries.filter((entry) => entry.result === 'SUCCESS');
      expect(successful).toHaveLength(4);
      expect(
        new Set(successful.map((entry) => JSON.parse(entry.resource).observationId)).size
      ).toBe(2);
      expect(successful.map((entry) => JSON.parse(entry.resource).iteration)).toEqual(
        expect.arrayContaining([1, 2])
      );
      expect(JSON.stringify(entries)).not.toContain('SYNTHETIC');
    });

    // -----------------------------------------------------------------------
    // Phase 6.8: bounded multi-step tasks.
    //
    // The loop in vision-loop.ts already re-captures, re-redacts, re-infers and
    // re-authorizes on every step; the two-iteration test above covers the happy
    // path. What was untested is what happens when a multi-step task goes wrong
    // PART WAY THROUGH, which is where "never replay an uncertain action" and
    // "stop immediately" actually have to hold.
    // -----------------------------------------------------------------------

    /**
     * Advance the worker once. Returns false when no job is left to claim,
     * which is how a cancelled task presents. A stopped task also makes
     * execute() throw 'Execution task interrupted' — the pipeline refusing to
     * continue, not a test failure.
     */
    const advance = async () => {
      const repo = new JobsRepository();
      const job = await repo.claimJob('execution_tasks');
      if (!job) return false;
      try {
        const result = await service().execute(job, new AbortController().signal);
        await repo.complete(job.id, result, job.leaseToken!);
      } catch (e) {
        if (!/interrupted|not found/i.test(String(e))) throw e;
      }
      return true;
    };

    /** Drive the task, approving everything, until `done` or the budget runs out. */
    const drive = async (taskId: string, done: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 8; i++) {
        if (!(await advance())) return;
        if (await done()) return;
        const detail = await service()
          .repo.detail(taskId)
          .catch(() => undefined);
        if (detail?.task.state !== 'WAITING_APPROVAL') return;
        const approval = detail.approvals.find((a) => a.status === 'pending');
        if (!approval) return;
        await service().approve(taskId, String(approval.id));
      }
    };

    const successes = async (taskId: string) =>
      await fixture.adapter.query<{ resource: string; action: string }>(
        "SELECT resource,action FROM action_ledger WHERE execution_task_id=$1 AND tool=$2 AND result='SUCCESS'",
        [taskId, 'computer_service']
      );

    it('feeds each step a fresh observation that reflects the previous action', async () => {
      // Step 1 clicks the button, which rewrites its label and therefore its
      // layout; step 2 must therefore see a different redacted observation.
      fixture.model.mockReset();
      fixture.model
        .mockResolvedValueOnce({
          type: 'click',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        })
        .mockResolvedValueOnce({
          type: 'mouseMove',
          params: { x: 40, y: 40 },
          viewport: COMPUTER_VIEWPORT,
        });

      const task = await start(2);
      await drive(task.id, async () => (await service().repo.get(task.id))?.state === 'COMPLETED');

      expect((await service().repo.get(task.id))?.state).toBe('COMPLETED');
      expect(clicked).toBe(true);
      expect(fixture.model).toHaveBeenCalledTimes(2);

      const [first, second] = fixture.model.mock.calls.map(
        ([request]) => request.observation.screenshot as string
      );
      // A genuinely fresh capture, not a cached one replayed at the model.
      expect(second).not.toEqual(first);
      const ids = new Set(
        (await successes(task.id)).map((e) => JSON.parse(e.resource).observationId)
      );
      expect(ids.size).toBe(2);
    });

    it('treats a proposed screenshot as a legal action rather than a loop failure', async () => {
      // `screenshot` is one of the nine actions the closed proposal schema
      // allows, so a model that proposes one has not misbehaved. Observed live:
      // a real provider proposes it regularly, and the task must survive it.
      fixture.model.mockReset();
      fixture.model
        .mockResolvedValueOnce({
          type: 'screenshot',
          params: {},
          viewport: COMPUTER_VIEWPORT,
        })
        .mockResolvedValueOnce({
          type: 'click',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        });

      const task = await start(2);
      await drive(task.id, async () => (await service().repo.get(task.id))?.state === 'COMPLETED');

      expect((await service().repo.get(task.id))?.state).toBe('COMPLETED');
      expect(fixture.model).toHaveBeenCalledTimes(2);
      expect(clicked).toBe(true);
    });

    it('stops at a mid-task model failure and keeps the completed step durable', async () => {
      fixture.model.mockReset();
      fixture.model
        .mockResolvedValueOnce({
          type: 'click',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        })
        .mockRejectedValueOnce(new Error('model unavailable'));

      const task = await start(2);
      await drive(task.id, async () => {
        const state = (await service().repo.get(task.id))?.state;
        return state === 'COMPLETED' || state === 'CANCELLED' || state === 'FAILED';
      });

      // The first step really happened and stays recorded; it is not rolled back.
      expect(clicked).toBe(true);
      const done = await successes(task.id);
      expect(done.length).toBeGreaterThanOrEqual(2);
      // Step 2's capture may legitimately have happened before the model was
      // asked; what must not exist is a step-2 ACTION.
      const acted = done.filter((e) => e.action !== 'computer.screenshot');
      expect(new Set(acted.map((e) => JSON.parse(e.resource).iteration))).toEqual(new Set([1]));

      // The task stopped rather than completing, and step 2 was never executed.
      expect((await service().repo.get(task.id))?.state).not.toBe('COMPLETED');
      expect(fixture.model).toHaveBeenCalledTimes(2);
    });

    it('stops mid-task on cancellation without dispatching the next action', async () => {
      fixture.model.mockReset();
      fixture.model
        .mockResolvedValueOnce({
          type: 'click',
          params: { x: 20, y: 20 },
          viewport: COMPUTER_VIEWPORT,
        })
        .mockResolvedValueOnce({
          type: 'mouseMove',
          params: { x: 40, y: 40 },
          viewport: COMPUTER_VIEWPORT,
        });

      const task = await start(2);
      await drive(task.id, () => clicked);
      expect(clicked).toBe(true);

      await service().cancel(task.id);
      const modelCalls = fixture.model.mock.calls.length;
      await advance();

      expect((await service().repo.get(task.id))?.state).toBe('CANCELLED');
      // Cancellation stops the loop; it does not spend another inference.
      expect(fixture.model).toHaveBeenCalledTimes(modelCalls);
      const iterations = new Set(
        (await successes(task.id)).map((e) => JSON.parse(e.resource).iteration)
      );
      expect(iterations.has(1)).toBe(true);
      expect(iterations.has(2)).toBe(false);
    });

    it('refuses a proposal whose observation went stale while the model was thinking', async () => {
      fixture.model.mockReset();
      fixture.model.mockImplementationOnce(async () => {
        // The browser moves on after the observation was taken. The proposal is
        // well-formed but describes a page that no longer exists.
        const page = await seededPage();
        await page.setContent('<body style="background:#00ff00"><p>Moved on</p></body>');
        return { type: 'click', params: { x: 20, y: 20 }, viewport: COMPUTER_VIEWPORT };
      });

      const task = await start(2);
      await drive(task.id, async () => {
        const state = (await service().repo.get(task.id))?.state;
        return state === 'CANCELLED' || state === 'FAILED' || state === 'COMPLETED';
      });

      // The stale proposal was refused, so the click never reached Chrome.
      expect(clicked).toBe(false);
      expect((await service().repo.get(task.id))?.state).not.toBe('COMPLETED');
      const acted = (await successes(task.id)).filter((e) => e.action !== 'computer.screenshot');
      expect(acted).toHaveLength(0);
    });

    it('cancels pending capture approval without invoking the model', async () => {
      const task = await start();
      await next();
      const detail = await service().repo.detail(task.id);
      await service().cancel(task.id);
      await expect(service().approve(task.id, String(detail.approvals[0]!.id))).rejects.toThrow();
      expect((await service().repo.get(task.id))?.state).toBe('CANCELLED');
      expect(fixture.model).not.toHaveBeenCalled();
    });
  }
);
