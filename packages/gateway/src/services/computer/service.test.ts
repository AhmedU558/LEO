import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputerService, COMPUTER_LIMITS } from './service.js';
import type { ComputerAction, ComputerUseProvider, BrowserProvider } from '@ownpilot/core/computer';
import { COMPUTER_VIEWPORT, COMPUTER_MAX_SCREENSHOT_BYTES } from '@ownpilot/core/computer';
import {
  parseComputerProposal,
  type ComputerActionProposer,
  type ComputerModelObservation,
  type ComputerActionProposal,
} from '@ownpilot/core/computer';
import { PolicyEngine, RiskEngine, ActionLedger } from '@ownpilot/core/security';
import { executionTaskContext, computerStepContext } from '../execution-task-context.js';

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  worker: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
  create: vi.fn(),
  consume: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../execution-task-context.js', async (original) => ({
  ...(await original<typeof import('../execution-task-context.js')>()),
  assertExecutionTaskActive: () => mocks.active(),
}));
vi.mock('../../db/repositories/execution-tasks.js', () => ({
  ExecutionTasksRepository: class {
    assertComputerWorker = mocks.worker;
    whileRunning = async (_id: string, fn: () => Promise<unknown>) => fn();
  },
}));
vi.mock('../../db/repositories/idempotency-keys.js', () => ({
  getIdempotencyKeysRepository: () => ({
    claimOperation: mocks.claim,
    finishOperation: mocks.finish,
  }),
}));
vi.mock('../../db/repositories/workflows/approvals.js', () => ({
  createWorkflowApprovalsRepository: () => ({
    create: mocks.create,
    consumeComputerApproval: mocks.consume,
    get: mocks.get,
  }),
}));

describe('durable ComputerService security boundary', () => {
  let provider: ComputerUseProvider & BrowserProvider;
  let service: ComputerService;
  const scopes = new Set<string>();
  let records: Map<string, { requestHash: string; state: string }>;
  let controller: AbortController;
  const grants = ['computer.read', 'computer.mouse', 'computer.keyboard'];
  const action = (
    type: ComputerAction['type'],
    params: Record<string, unknown> = {}
  ): ComputerAction => ({ type, params });
  function run(input: ComputerAction, options: Parameters<typeof within>[1] = {}) {
    return within(() => service.executeAction(input), options);
  }
  function within<T>(
    operation: () => Promise<T>,
    options: {
      userId?: string;
      workspaceId?: string;
      taskId?: string;
      nodeId?: string;
      approvalId?: string;
      capabilities?: string[];
    } = {}
  ) {
    const {
      userId = 'u',
      workspaceId = 'w',
      taskId = 't',
      nodeId = 'n',
      approvalId,
      capabilities = grants,
    } = options;
    scopes.add(JSON.stringify([userId, workspaceId, taskId]));
    return executionTaskContext.run(
      {
        userId,
        workspaceId,
        taskId,
        workflowId: 'wf',
        signal: controller.signal,
        jobId: 'job',
        leaseToken: 'lease',
        approvalId,
      },
      () =>
        computerStepContext.run({ nodeId, runId: 'run', effectIndex: 0, capabilities }, () =>
          operation()
        )
    );
  }
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    controller = new AbortController();
    records = new Map();
    mocks.active.mockImplementation(async () => {
      executionTaskContext.getStore()?.signal.throwIfAborted();
    });
    mocks.worker.mockResolvedValue(undefined);
    mocks.claim.mockImplementation(async (_user, key, requestHash) => {
      const prior = records.get(key);
      if (prior) return { claimed: false, ...prior };
      records.set(key, { requestHash, state: 'pending' });
      return { claimed: true, requestHash, state: 'pending' };
    });
    mocks.finish.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ id: 'approval' });
    mocks.get.mockResolvedValue({ nodeId: 'n', workflowLogId: 'run' });
    mocks.consume.mockResolvedValue(true);
    vi.spyOn(PolicyEngine.prototype, 'evaluate').mockReturnValue({ decision: 'ALLOW' });
    vi.spyOn(ActionLedger, 'record').mockResolvedValue({ actionId: 'audit' } as Awaited<
      ReturnType<typeof ActionLedger.record>
    >);
    vi.spyOn(ActionLedger, 'updateResult').mockResolvedValue(undefined);
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1280, 16);
    png.writeUInt32BE(800, 20);
    provider = {
      initialize: vi.fn().mockResolvedValue(undefined),
      screenshot: vi
        .fn()
        .mockResolvedValue({ screenshot: png.toString('base64'), ...COMPUTER_VIEWPORT }),
      mouseMove: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      doubleClick: vi.fn().mockResolvedValue(undefined),
      mouseDown: vi.fn().mockResolvedValue(undefined),
      mouseUp: vi.fn().mockResolvedValue(undefined),
      scroll: vi.fn().mockResolvedValue(undefined),
      keyPress: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
      hotkey: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue({ success: true }),
      executeAction: vi.fn().mockResolvedValue({ success: true }),
      getState: vi.fn(),
    };
    service = new ComputerService(() => provider);
  });
  afterEach(async () => {
    for (const scope of scopes) {
      const [u, w, t] = JSON.parse(scope);
      await ComputerService.closeTask(u, w, t);
    }
    scopes.clear();
    vi.useRealTimers();
  });
  it('rejects missing durable context', async () => {
    expect((await service.executeAction(action('screenshot'))).outcome).toBe('DENIED');
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('rejects stale or wrong worker context before provider execution', async () => {
    mocks.worker.mockRejectedValue(new Error('wrong scope'));
    expect((await run(action('screenshot'))).outcome).toBe('DENIED');
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('requires explicit granular capability grants', async () => {
    expect(
      (await run(action('click', { x: 1, y: 2 }), { capabilities: ['computer.read'] })).outcome
    ).toBe('DENIED');
    expect(provider.click).not.toHaveBeenCalled();
  });
  it('enforces DENY even when capability is granted', async () => {
    vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({ decision: 'DENY' });
    expect((await run(action('screenshot'))).outcome).toBe('DENIED');
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('passes intrinsic risk and autonomous identity into policy', async () => {
    const risk = vi.spyOn(RiskEngine.prototype, 'classify');
    await run(action('click', { x: 1, y: 2 }));
    expect(risk).toHaveReturnedWith('HIGH');
    expect(PolicyEngine.prototype.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'computer.mouse',
        risk: 'HIGH',
        autonomous: true,
        identity: expect.objectContaining({ userId: 'u', workspaceId: 'w' }),
      })
    );
  });
  it('persists exact-action approval and stops before initialization', async () => {
    vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({ decision: 'REQUIRE_APPROVAL' });
    const result = await run(action('click', { x: 1, y: 2 }));
    expect(result.outcome).toBe('WAITING_APPROVAL');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'computer.mouse',
        workflowLogId: 'run',
        context: expect.objectContaining({
          requestHash: expect.any(String),
          sessionId: result.sessionId,
        }),
      })
    );
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('resumes the exact approved action once and rejects replay', async () => {
    vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({ decision: 'REQUIRE_APPROVAL' });
    await run(action('click', { x: 1, y: 2 }));
    expect((await run(action('click', { x: 1, y: 2 }), { approvalId: 'approval' })).success).toBe(
      true
    );
    expect((await run(action('click', { x: 1, y: 2 }), { approvalId: 'approval' })).success).toBe(
      false
    );
    expect(provider.click).toHaveBeenCalledTimes(1);
  });
  it('rejects expired, cancelled or mismatched approvals', async () => {
    vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({ decision: 'REQUIRE_APPROVAL' });
    mocks.consume.mockResolvedValue(false);
    expect((await run(action('screenshot'), { approvalId: 'expired' })).outcome).toBe('DENIED');
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it.each(['mouseMove', 'click', 'doubleClick', 'mouseDown', 'mouseUp'] as const)(
    'executes browser-scoped %s',
    async (type) => {
      expect((await run(action(type, { x: 10, y: 20 }))).success).toBe(true);
      expect(provider[type]).toHaveBeenCalledWith(10, 20);
    }
  );
  it.each([
    { x: -1, y: 0 },
    { x: 1280, y: 0 },
    { x: 0, y: 800 },
    { x: NaN, y: 0 },
  ])('rejects invalid coordinates %j', async (params) => {
    expect((await run(action('click', params))).outcome).toBe('DENIED');
    expect(provider.click).not.toHaveBeenCalled();
  });
  it('supports bounded scrolling', async () => {
    expect((await run(action('scroll', { deltaX: 0, deltaY: 100 }))).success).toBe(true);
    expect(provider.scroll).toHaveBeenCalledWith(0, 100);
  });
  it.each([
    action('keyPress', { key: 'Enter' }),
    action('typeText', { text: 'secret-value' }),
    action('hotkey', { keys: ['Control', 'A'] }),
  ])('supports approved keyboard action $type', async (input) => {
    expect((await run(input)).success).toBe(true);
    expect(JSON.stringify(vi.mocked(ActionLedger.record).mock.calls)).not.toContain('secret-value');
  });
  it.each(['C', 'V', 'X', 'L', 'N', 'T'])(
    'rejects clipboard/browser shortcut Control+%s',
    async (key) => {
      expect((await run(action('hotkey', { keys: ['Control', key] }))).outcome).toBe('DENIED');
      expect(provider.hotkey).not.toHaveBeenCalled();
    }
  );
  it('bounds screenshot dimensions and bytes', async () => {
    vi.mocked(provider.screenshot).mockResolvedValue({
      screenshot: Buffer.alloc(COMPUTER_MAX_SCREENSHOT_BYTES + 1).toString('base64'),
      ...COMPUTER_VIEWPORT,
    });
    expect((await run(action('screenshot'))).outcome).toBe('UNKNOWN');
    expect(provider.cancel).toHaveBeenCalled();
  });
  it('rejects provider viewport changes', async () => {
    vi.mocked(provider.screenshot).mockResolvedValue({ screenshot: '', width: 9999, height: 800 });
    expect((await run(action('screenshot'))).success).toBe(false);
  });
  it('never persists screenshot bytes in effects or audit', async () => {
    expect((await run(action('screenshot'))).success).toBe(true);
    expect(
      JSON.stringify([...mocks.finish.mock.calls, ...vi.mocked(ActionLedger.record).mock.calls])
    ).not.toContain('iVBORw0KGgo');
  });
  it('honors cancellation before execution', async () => {
    controller.abort();
    expect((await run(action('screenshot'))).success).toBe(false);
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('cancels in-flight action and never retries UNKNOWN', async () => {
    vi.mocked(provider.click).mockImplementation(() => new Promise(() => {}));
    const pending = run(action('click', { x: 1, y: 1 }));
    await vi.waitFor(() => expect(provider.click).toHaveBeenCalled());
    controller.abort();
    expect((await pending).outcome).toBe('UNKNOWN');
    expect(provider.cancel).toHaveBeenCalled();
    expect((await run(action('click', { x: 1, y: 1 }))).success).toBe(false);
  });
  it('times out and closes uncertain provider work', async () => {
    vi.mocked(provider.click).mockImplementation(() => new Promise(() => {}));
    expect((await run({ ...action('click', { x: 1, y: 2 }), timeoutMs: 5 })).outcome).toBe(
      'UNKNOWN'
    );
    expect(provider.cancel).toHaveBeenCalled();
  });
  it('does not execute an action after timed-out initialization finishes late', async () => {
    let ready!: () => void;
    vi.mocked(provider.initialize).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        })
    );
    expect((await run({ ...action('click', { x: 1, y: 2 }), timeoutMs: 5 })).outcome).toBe(
      'UNKNOWN'
    );
    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(provider.click).not.toHaveBeenCalled();
  });
  it('fails closed on provider errors without disclosing raw errors', async () => {
    vi.mocked(provider.typeText).mockRejectedValue(new Error('password=secret'));
    const res = await run(action('typeText', { text: 'secret' }));
    expect(res.outcome).toBe('UNKNOWN');
    expect(JSON.stringify([res, vi.mocked(ActionLedger.updateResult).mock.calls])).not.toContain(
      'password='
    );
  });
  it('prevents simultaneous commands on the same session', async () => {
    vi.mocked(provider.click).mockImplementation(() => new Promise(() => {}));
    const pending = run({ ...action('click', { x: 1, y: 2 }), timeoutMs: 20 });
    await vi.waitFor(() => expect(provider.click).toHaveBeenCalled(), { interval: 1 });
    expect((await run(action('screenshot'), { nodeId: 'other' })).success).toBe(false);
    await pending;
  });
  it('binds separate user/workspace/task sessions to distinct provider instances', async () => {
    const factory = vi.fn(() => provider);
    service = new ComputerService(factory);
    await run(action('screenshot'));
    await run(action('screenshot'), { workspaceId: 'other' });
    await run(action('screenshot'), { userId: 'other' });
    await run(action('screenshot'), { taskId: 'other' });
    expect(new Set(factory.mock.calls.map((call) => call[1]?.sessionId)).size).toBe(4);
  });
  it('enforces screenshot capture budget', async () => {
    for (let i = 0; i < COMPUTER_LIMITS.captures; i++)
      expect((await run(action('screenshot'), { nodeId: `n${i}` })).success).toBe(true);
    expect((await run(action('screenshot'), { nodeId: 'excess' })).success).toBe(false);
  });
  it('enforces action/iteration budget', async () => {
    for (let i = 0; i < COMPUTER_LIMITS.actions; i++)
      expect((await run(action('mouseMove', { x: 1, y: 2 }), { nodeId: `n${i}` })).success).toBe(
        true
      );
    expect((await run(action('mouseMove', { x: 1, y: 2 }), { nodeId: 'excess' })).success).toBe(
      false
    );
  });
  it('records scope, session, capability, coordinates and outcome', async () => {
    const res = await run(action('click', { x: 10, y: 20 }));
    expect(ActionLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u',
        workspaceId: 'w',
        executionTaskId: 't',
        sessionId: res.sessionId,
        capability: 'computer.mouse',
        resource: expect.stringContaining('"x":10'),
      })
    );
    expect(ActionLedger.updateResult).toHaveBeenCalledWith(
      'audit',
      { result: 'SUCCESS' },
      expect.any(Number)
    );
  });
  it('expires sessions and rejects stale actions', async () => {
    vi.useFakeTimers();
    await run(action('screenshot'));
    await vi.advanceTimersByTimeAsync(COMPUTER_LIMITS.lifetimeMs);
    expect((await run(action('mouseMove', { x: 1, y: 2 }), { nodeId: 'later' })).success).toBe(
      false
    );
    expect(provider.cancel).toHaveBeenCalled();
  });
  it('bounds concurrent sessions per user', async () => {
    for (let i = 0; i < COMPUTER_LIMITS.sessions; i++)
      expect((await run(action('screenshot'), { taskId: `t${i}` })).success).toBe(true);
    expect((await run(action('screenshot'), { taskId: 'overflow' })).success).toBe(false);
  });
  it('classifies pointer motion with a held button as a side effect', async () => {
    await run(action('mouseDown', { x: 1, y: 2 }));
    await run(action('mouseMove', { x: 3, y: 4 }), { nodeId: 'drag' });
    expect(PolicyEngine.prototype.evaluate).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'computer.mouseMove', risk: 'HIGH' })
    );
  });
  it('does not recreate lost browser state after a restart', async () => {
    await run(action('screenshot'));
    await ComputerService.closeTask('u', 'w', 't');
    expect((await run(action('mouseMove', { x: 1, y: 2 }), { nodeId: 'later' })).success).toBe(
      false
    );
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the audit write fails', async () => {
    vi.mocked(ActionLedger.record).mockRejectedValue(new Error('database unavailable'));
    expect((await run(action('click', { x: 1, y: 2 }))).success).toBe(false);
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  describe('model proposals through the existing authority', () => {
    const model = (
      type = 'click',
      params: Record<string, unknown> = { x: 10, y: 20 }
    ): ComputerActionProposer => ({
      metadata: { provider: 'deterministic-test', model: 'fixture' },
      propose: vi
        .fn()
        .mockResolvedValue(
          parseComputerProposal(JSON.stringify({ type, params, viewport: COMPUTER_VIEWPORT }))
        ),
    });
    const redact = async (image: {
      screenshot: string;
      viewport: typeof COMPUTER_VIEWPORT;
    }): Promise<ComputerModelObservation> => ({
      ...image,
      untrusted: true,
      disclosure: 'redacted',
    });
    async function propose(proposer = model()) {
      const shot = await service.executeAction(action('screenshot'));
      return service.proposeAction(shot, proposer, redact);
    }
    it('consumes an authorized observation once even for concurrent model requests', async () => {
      await within(async () => {
        const shot = await service.executeAction(action('screenshot'));
        const proposer = model();
        const results = await Promise.all([
          service.proposeAction(shot, proposer, redact),
          service.proposeAction(shot, proposer, redact),
        ]);
        expect(results.map((r) => r.outcome).sort()).toEqual(['DENIED', 'PROPOSED']);
        expect(proposer.propose).toHaveBeenCalledTimes(1);
      });
    });
    it('rejects a screenshot after another action changes the session', async () => {
      await within(async () => {
        const shot = await service.executeAction(action('screenshot'));
        await service.executeAction(action('mouseMove', { x: 1, y: 1 }));
        const proposer = model();
        expect((await service.proposeAction(shot, proposer, redact)).outcome).toBe('DENIED');
        expect(proposer.propose).not.toHaveBeenCalled();
      });
    });
    it('fails closed when the trusted redactor refuses disclosure', async () => {
      await within(async () => {
        const shot = await service.executeAction(action('screenshot'));
        const proposer = model();
        expect(
          (
            await service.proposeAction(shot, proposer, async () => {
              throw new Error('Sensitive pixels');
            })
          ).outcome
        ).toBe('DENIED');
        expect(proposer.propose).not.toHaveBeenCalled();
      });
    });
    it.each(['inference', 'approval'] as const)(
      'rejects DOM revision changes during %s',
      async (phase) => {
        let revision = 'original';
        provider.inspectForRedaction = vi.fn(async () => ({ revision, controls: [] }));
        const original = await provider.screenshot();
        vi.mocked(provider.screenshot).mockResolvedValue({
          ...original,
          layout: { revision, controls: [] },
        });
        await within(async () => {
          const proposer = model();
          if (phase === 'inference')
            vi.mocked(proposer.propose).mockImplementation(async () => {
              revision = 'changed';
              return parseComputerProposal(
                JSON.stringify({
                  type: 'click',
                  params: { x: 10, y: 20 },
                  viewport: COMPUTER_VIEWPORT,
                })
              );
            });
          const result = await propose(proposer);
          if (phase === 'inference') expect(result.outcome).toBe('DENIED');
          else {
            if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
            vi.spyOn(PolicyEngine.prototype, 'evaluate').mockReturnValue({
              decision: 'REQUIRE_APPROVAL',
            });
            expect((await service.executeProposal(result.proposal)).outcome).toBe(
              'WAITING_APPROVAL'
            );
            revision = 'changed';
            expect(
              (
                await within(() => service.executeProposal(result.proposal), {
                  approvalId: 'approval',
                })
              ).outcome
            ).toBe('DENIED');
          }
          expect(provider.click).not.toHaveBeenCalled();
        });
      }
    );
    it('blocks other actions while inference owns the session', async () => {
      await within(async () => {
        const proposer = model();
        vi.mocked(proposer.propose).mockImplementation(async () => {
          expect((await service.executeAction(action('mouseMove', { x: 1, y: 1 }))).success).toBe(
            false
          );
          return parseComputerProposal(
            JSON.stringify({ type: 'click', params: { x: 10, y: 20 }, viewport: COMPUTER_VIEWPORT })
          );
        });
        expect((await propose(proposer)).outcome).toBe('PROPOSED');
        expect(provider.mouseMove).not.toHaveBeenCalled();
      });
    });
    it('checks cancellation again after the final asynchronous freshness check', async () => {
      let checks = 0;
      const layout = { revision: 'original', controls: [] };
      provider.inspectForRedaction = vi.fn(async () => {
        if (++checks === 4) controller.abort();
        return layout;
      });
      vi.mocked(provider.screenshot).mockResolvedValue({
        ...(await provider.screenshot()),
        layout,
      });
      await within(async () => {
        const result = await propose();
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        expect((await service.executeProposal(result.proposal)).success).toBe(false);
        expect(checks).toBe(4);
        expect(provider.click).not.toHaveBeenCalled();
      });
    });
    it('keeps scope and audit references outside the model and maps capability in ComputerService', async () => {
      await within(async () => {
        const proposer = model();
        const result = await propose(proposer);
        expect(result.outcome).toBe('PROPOSED');
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        const request = vi.mocked(proposer.propose).mock.calls[0]![0];
        expect(Object.keys(request).sort()).toEqual(['observation', 'signal']);
        expect(JSON.stringify(request)).not.toContain('lease');
        expect(result.proposal.observationActionId).toBe('audit');
        expect(result.proposal.binding).toMatchObject({
          userId: 'u',
          workspaceId: 'w',
          executionTaskId: 't',
        });
        expect((await service.executeProposal(result.proposal)).success).toBe(true);
        expect(provider.click).toHaveBeenCalledWith(10, 20);
        expect(ActionLedger.record).toHaveBeenLastCalledWith(
          expect.objectContaining({
            capability: 'computer.mouse',
            riskLevel: 'HIGH',
            sessionId: result.proposal.binding.sessionId,
          })
        );
      });
    });
    it.each(['click', 'typeText', 'screenshot', 'scroll'] as const)(
      'maps %s without accepting a model-supplied capability',
      async (type) => {
        await within(async () => {
          const params =
            type === 'click'
              ? { x: 1, y: 2 }
              : type === 'typeText'
                ? { text: 'hello' }
                : type === 'scroll'
                  ? { deltaX: 0, deltaY: 2 }
                  : {};
          const result = await propose(model(type, params));
          if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
          await service.executeProposal(result.proposal);
          expect(ActionLedger.record).toHaveBeenLastCalledWith(
            expect.objectContaining({
              capability:
                type === 'screenshot'
                  ? 'computer.read'
                  : type === 'typeText'
                    ? 'computer.keyboard'
                    : 'computer.mouse',
            })
          );
        });
      }
    );
    it('honors policy denial after a valid model response', async () => {
      await within(async () => {
        const result = await propose();
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({ decision: 'DENY' });
        expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
        expect(provider.click).not.toHaveBeenCalled();
      });
    });
    it('requires an exact-action approval and never queries the model to resume', async () => {
      await within(async () => {
        const proposer = model();
        const result = await propose(proposer);
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        vi.mocked(PolicyEngine.prototype.evaluate).mockReturnValue({
          decision: 'REQUIRE_APPROVAL',
        });
        expect((await service.executeProposal(result.proposal)).outcome).toBe('WAITING_APPROVAL');
        expect(provider.click).not.toHaveBeenCalled();
        const requestHash = mocks.create.mock.calls.at(-1)![0].context.requestHash;
        expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
        expect(mocks.create).toHaveBeenCalledTimes(1);
        executionTaskContext.getStore()!.approvalId = 'approval';
        computerStepContext.getStore()!.effectIndex = 1;
        expect((await service.executeProposal(result.proposal)).outcome).toBe('SUCCESS');
        expect(mocks.consume).toHaveBeenCalledWith(
          'approval',
          'w',
          'run',
          'n',
          't',
          result.proposal.binding.sessionId,
          requestHash,
          'computer.mouse'
        );
        expect(proposer.propose).toHaveBeenCalledTimes(1);
      });
    });
    it.each(['workspaceId', 'taskId', 'userId'])(
      'rejects wrong %s before execution',
      async (field) => {
        await within(async () => {
          const result = await propose();
          if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
          await executionTaskContext.run(
            { ...executionTaskContext.getStore()!, [field]: 'other' },
            async () => {
              expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
            }
          );
          expect(provider.click).not.toHaveBeenCalled();
        });
      }
    );
    it('rejects fabricated observation and modified session/proposal envelopes', async () => {
      await within(async () => {
        expect(
          (await service.proposeAction({ success: true, sessionId: 'fake' }, model(), redact))
            .outcome
        ).toBe('DENIED');
        const result = await propose();
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        expect(
          (
            await service.executeProposal({
              ...result.proposal,
              binding: { ...result.proposal.binding, sessionId: 'other' },
            })
          ).outcome
        ).toBe('DENIED');
        await ComputerService.closeTask('u', 'w', 't');
        expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
      });
    });
    it.each(['error', 'malformed', 'cancel', 'timeout'])(
      'denies %s without executing input',
      async (mode) => {
        await within(async () => {
          const proposer = model();
          if (mode === 'error') vi.mocked(proposer.propose).mockRejectedValue(new Error('secret'));
          if (mode === 'malformed')
            vi.mocked(proposer.propose).mockResolvedValue({
              type: 'execute_shell',
              params: {},
              viewport: COMPUTER_VIEWPORT,
            } as unknown as ComputerActionProposal);
          if (mode === 'cancel' || mode === 'timeout') {
            vi.useFakeTimers();
            vi.mocked(proposer.propose).mockImplementation(async () => new Promise(() => {}));
          }
          const pending = propose(proposer);
          if (mode === 'cancel' || mode === 'timeout') {
            await vi.advanceTimersByTimeAsync(1);
            if (mode === 'cancel') controller.abort();
            else await vi.advanceTimersByTimeAsync(30000);
          }
          expect((await pending).outcome).toBe('DENIED');
          expect(provider.click).not.toHaveBeenCalled();
        });
      }
    );
    it('preserves UNKNOWN and forbids replay after an uncertain side effect', async () => {
      await within(async () => {
        const result = await propose();
        if (result.outcome !== 'PROPOSED') throw new Error('Missing proposal');
        vi.mocked(provider.click).mockRejectedValue(new Error('uncertain'));
        expect((await service.executeProposal(result.proposal)).outcome).toBe('UNKNOWN');
        expect((await service.executeProposal(result.proposal)).outcome).toBe('DENIED');
        expect(provider.click).toHaveBeenCalledTimes(1);
      });
    });
  });
  it.each(['execute_shell', 'read_file', 'write_file'] as const)(
    'rejects host operation %s',
    async (type) => {
      expect((await run(action(type))).success).toBe(false);
      expect(provider.initialize).not.toHaveBeenCalled();
    }
  );
});
