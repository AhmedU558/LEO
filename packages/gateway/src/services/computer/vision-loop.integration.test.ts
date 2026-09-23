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
    const tasks = new Set<string>();
    const service = () => new ExecutionTaskService('vision-user', 'default');
    const start = async () => {
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
              iterations: 2,
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
            const page = await getBrowserService()['getOrCreatePage'](
              binding.sessionId,
              binding.userId
            );
            await page.setContent(
              '<body style="background:#ff00ff"><button style="position:absolute;left:0;top:0;width:100px;height:60px" onclick="this.textContent=\'Clicked\'">Go</button><input type="password" value="SYNTHETIC-PASSWORD"><input name="api_token" value="SYNTHETIC-TOKEN"><input autocomplete="one-time-code" value="123456"><p>SYNTHETIC-FREE-TEXT-SECRET</p></body>'
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
