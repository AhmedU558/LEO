import { afterAll, describe, expect, it, vi } from 'vitest';
import { OpenAIComputerActionProposer, COMPUTER_VIEWPORT } from '@ownpilot/core/computer';
import { ActionLedger, PolicyEngine } from '@ownpilot/core/security';
import { ComputerService } from './service.js';
import { PuppeteerComputerUseProvider } from './computer-use-provider.js';
import { getBrowserService } from '../browser-service.js';
import { executionTaskContext, computerStepContext } from '../execution-task-context.js';

// Durable repositories have separate real-PostgreSQL coverage. This suite exercises the real actuator.
const db = vi.hoisted(() => ({
  approvals: new Map<string, Record<string, unknown>>(),
  effects: new Set<string>(),
}));
vi.mock('../execution-task-context.js', async (original) => ({
  ...(await original<typeof import('../execution-task-context.js')>()),
  assertExecutionTaskActive: async () => {},
}));
vi.mock('../../db/repositories/execution-tasks.js', () => ({
  ExecutionTasksRepository: class {
    async assertComputerWorker() {}
    async whileRunning(_id: string, fn: () => Promise<unknown>) {
      return fn();
    }
  },
}));
vi.mock('../../db/repositories/idempotency-keys.js', () => ({
  getIdempotencyKeysRepository: () => ({
    claimOperation: async (_user: string, key: string, requestHash: string) => {
      const claimed = !db.effects.has(key);
      db.effects.add(key);
      return { claimed, requestHash };
    },
    finishOperation: async () => {},
  }),
}));
vi.mock('../../db/repositories/workflows/approvals.js', () => ({
  createWorkflowApprovalsRepository: () => ({
    create: async (input: Record<string, unknown>) => {
      db.approvals.set('approval', input);
      return { id: 'approval' };
    },
    get: async () => db.approvals.get('approval'),
    consumeComputerApproval: async (
      _id: string,
      _workspace: string,
      _run: string,
      _node: string,
      _task: string,
      session: string,
      hash: string
    ) => {
      const context = db.approvals.get('approval')?.context as Record<string, unknown>;
      return context?.sessionId === session && context?.requestHash === hash;
    },
  }),
}));

describe.skipIf(process.env.LEO_QA_BROWSER !== '1')(
  'computer model and real isolated browser',
  () => {
    afterAll(async () => {
      await ComputerService.closeTask('model-user', 'model-workspace', 'model-task');
      await getBrowserService().shutdown();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });
    it('captures a local page, validates a model proposal, pauses for approval, then clicks through ComputerService', async () => {
      vi.spyOn(ActionLedger, 'record').mockResolvedValue({ actionId: 'local-audit' } as Awaited<
        ReturnType<typeof ActionLedger.record>
      >);
      vi.spyOn(ActionLedger, 'updateResult').mockResolvedValue(undefined);
      // The screenshot disclosure is explicitly permitted for this synthetic, secret-free fixture.
      const policy = vi
        .spyOn(PolicyEngine.prototype, 'evaluate')
        .mockReturnValue({ decision: 'ALLOW' });
      let sessionId = '';
      const service = new ComputerService((ctx, binding) => {
        sessionId = binding.sessionId;
        const provider = new PuppeteerComputerUseProvider(ctx, binding);
        const initialize = provider.initialize.bind(provider);
        let seeded = false;
        provider.initialize = async (signal) => {
          await initialize(signal);
          if (!seeded) {
            const page = await getBrowserService()['getOrCreatePage'](
              binding.sessionId,
              binding.userId
            );
            await page.setContent(
              '<button style="position:absolute;left:0;top:0;width:100px;height:100px" onclick="this.textContent=\'Clicked\'">Local test</button>'
            );
            seeded = true;
          }
        };
        return provider;
      });
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    type: 'click',
                    params: { x: 20, y: 20 },
                    viewport: COMPUTER_VIEWPORT,
                  }),
                },
              },
            ],
          })
        )
      );
      vi.stubGlobal('fetch', fetch);
      const ctx = {
        userId: 'model-user',
        workspaceId: 'model-workspace',
        taskId: 'model-task',
        workflowId: 'wf',
        jobId: 'job',
        leaseToken: 'lease',
        signal: new AbortController().signal,
        approvalId: undefined as string | undefined,
      };
      await executionTaskContext.run(ctx, () =>
        computerStepContext.run(
          {
            nodeId: 'node',
            runId: 'run',
            effectIndex: 0,
            capabilities: ['computer.read', 'computer.mouse'],
          },
          async () => {
            const shot = await service.executeAction({ type: 'screenshot', params: {} });
            expect(shot.success).toBe(true);
            const result = await service.proposeAction(
              shot,
              new OpenAIComputerActionProposer({ apiKey: 'fixture-only', model: 'gpt-4o' }),
              async (image) => ({ ...image, disclosure: 'redacted', untrusted: true })
            );
            if (result.outcome !== 'PROPOSED') throw new Error('Proposal denied');
            policy.mockReturnValue({ decision: 'REQUIRE_APPROVAL' });
            expect((await service.executeProposal(result.proposal)).outcome).toBe(
              'WAITING_APPROVAL'
            );
            const page = await getBrowserService()['getOrCreatePage'](sessionId, ctx.userId);
            expect(await page.$eval('button', (button) => button.textContent)).toBe('Local test');
            ctx.approvalId = 'approval';
            expect((await service.executeProposal(result.proposal)).outcome).toBe('SUCCESS');
            expect(await page.$eval('button', (button) => button.textContent)).toBe('Clicked');
            expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(ActionLedger.record).toHaveBeenLastCalledWith(
              expect.objectContaining({
                sessionId,
                capability: 'computer.mouse',
                riskLevel: 'HIGH',
              })
            );
          }
        )
      );
    });
  }
);
