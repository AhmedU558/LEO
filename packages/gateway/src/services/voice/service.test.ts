import { describe, it, expect, vi } from 'vitest';
import { VoiceService } from './service.js';

vi.mock('@ownpilot/core/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ActionLedger: {
      record: vi.fn().mockResolvedValue({ actionId: 'test-action-id' }),
      updateResult: vi.fn(),
      setProvider: vi.fn(),
    },
    PolicyEngine: vi.fn().mockImplementation(function () {
      return {
        evaluate: vi.fn().mockReturnValue({ decision: 'ALLOW' }),
      };
    }),
    RiskEngine: vi.fn().mockImplementation(function () {
      return {
        classify: vi.fn().mockReturnValue('LOW'),
      };
    }),
  };
});

import { ActionLedger } from '@ownpilot/core/security';
import type { IToolService } from '@ownpilot/core/services';

describe('VoiceService - QA-022 / QA-004 Regression', () => {
  it.each([false, true])('uses the tool-service result contract (isError=%s)', async (isError) => {
    const execute = vi.fn().mockResolvedValue({ content: 'tool output', isError });
    const service = new VoiceService({ has: () => true, execute } as unknown as IToolService);
    const controller = new AbortController();
    const result = await service.handleVoiceToolCall(
      'user',
      'workspace',
      'session',
      'say_hello',
      {},
      { signal: controller.signal }
    );
    expect(result).toEqual(
      isError ? { allowed: false, error: 'tool output' } : { allowed: true, result: 'tool output' }
    );
    expect(execute).toHaveBeenCalledWith(
      'say_hello',
      {},
      expect.objectContaining({ signal: controller.signal, execSource: 'voice' })
    );
    expect(ActionLedger.updateResult).toHaveBeenLastCalledWith(
      'test-action-id',
      isError ? { error: 'tool output' } : { result: 'tool output' },
      expect.any(Number)
    );
  });

  it('does not fabricate success for production voice tools', async () => {
    const service = new VoiceService();

    const result = await service.handleVoiceToolCall(
      'user',
      'workspace',
      'session-1',
      'say_hello',
      { message: 'hello' }
    );

    // The service must NOT return success:true if there is no real provider.
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('Voice tool execution provider is not configured');

    // Must update ledger with failure
    expect(ActionLedger.updateResult).toHaveBeenCalledWith(
      'test-action-id',
      expect.objectContaining({ error: expect.any(String) }),
      expect.any(Number)
    );
  });
});
