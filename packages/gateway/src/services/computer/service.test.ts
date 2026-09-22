import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputerService } from './service.js';

// Mock ActionLedger so we don't hit DB
const mockEvaluate = vi.fn().mockReturnValue({ decision: 'ALLOW' });
vi.mock('@ownpilot/core/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ActionLedger: {
      record: vi.fn().mockResolvedValue({ actionId: 'test-action-id' }),
      updateResult: vi.fn(),
    },
    PolicyEngine: vi.fn().mockImplementation(function () {
      return {
        evaluate: mockEvaluate,
      };
    }),
    RiskEngine: vi.fn().mockImplementation(function () {
      return { classify: vi.fn().mockReturnValue('LOW') };
    }),
  };
});

// Mock PuppeteerBrowserProvider
const mockNavigate = vi
  .fn()
  .mockResolvedValue({ success: true, data: { url: 'http://example.com' } });
const mockExecuteAction = vi.fn().mockResolvedValue({ success: true, data: { status: 'done' } });
vi.mock('./puppeteer-provider.js', () => {
  return {
    PuppeteerBrowserProvider: vi.fn().mockImplementation(function () {
      return {
        navigate: mockNavigate,
        executeAction: mockExecuteAction,
      };
    }),
  };
});

import { ActionLedger } from '@ownpilot/core/security';
import { executionTaskContext } from '../execution-task-context.js';

describe('ComputerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluate.mockReturnValue({ decision: 'ALLOW' });
  });

  it('fails closed when missing execution context', async () => {
    const service = new ComputerService();
    const result = await service.executeAction({
      type: 'navigate',
      params: { url: 'https://example.com' },
    } as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing execution context');
  });

  it('fails closed when execution task is cancelled', async () => {
    const service = new ComputerService();
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const result = await executionTaskContext.run(
      {
        taskId: 'task-1',
        userId: 'user',
        workspaceId: 'workspace',
        workflowId: 'wf',
        signal: abortCtrl.signal,
      },
      () =>
        service.executeAction({ type: 'navigate', params: { url: 'https://example.com' } } as any)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Execution task cancelled');
  });

  it('evaluates policy and fails if denied', async () => {
    mockEvaluate.mockReturnValue({ decision: 'DENY', reason: 'Blocked domain' });
    const service = new ComputerService();
    const result = await executionTaskContext.run(
      {
        taskId: 'task-1',
        userId: 'user',
        workspaceId: 'workspace',
        workflowId: 'wf',
        signal: new AbortController().signal,
      },
      () => service.executeAction({ type: 'navigate', params: { url: 'https://evil.com' } } as any)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('denied by policy');
    expect(ActionLedger.updateResult).toHaveBeenCalledWith(
      'test-action-id',
      expect.objectContaining({ error: expect.any(String) }),
      expect.any(Number)
    );
  });

  it('evaluates policy and fails if requires approval', async () => {
    mockEvaluate.mockReturnValue({ decision: 'REQUIRE_APPROVAL' });
    const service = new ComputerService();
    const result = await executionTaskContext.run(
      {
        taskId: 'task-1',
        userId: 'user',
        workspaceId: 'workspace',
        workflowId: 'wf',
        signal: new AbortController().signal,
      },
      () => service.executeAction({ type: 'click', params: { selector: '.buy' } } as any)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Approval required');
  });

  it('delegates to PuppeteerBrowserProvider for browser actions', async () => {
    const service = new ComputerService();
    const result = await executionTaskContext.run(
      {
        taskId: 'task-1',
        userId: 'user',
        workspaceId: 'workspace',
        workflowId: 'wf',
        signal: new AbortController().signal,
      },
      () =>
        service.executeAction({ type: 'navigate', params: { url: 'https://example.com' } } as any)
    );
    expect(result.success).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('https://example.com');
    expect(ActionLedger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'computer_service',
        capability: 'browser.navigate',
      })
    );
  });

  it('does not fabricate success for production computer provider execution', async () => {
    const service = new ComputerService();
    const result = await executionTaskContext.run(
      {
        taskId: 'task-1',
        userId: 'user',
        workspaceId: 'workspace',
        workflowId: 'wf',
        signal: new AbortController().signal,
      },
      () => service.executeAction({ type: 'execute_shell', params: {} } as any)
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('No production computer execution provider configured');
  });
});
