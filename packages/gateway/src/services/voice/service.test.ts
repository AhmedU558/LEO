import { describe, it, expect, vi } from 'vitest';
import { VoiceService } from './service.js';

vi.mock('@ownpilot/core/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ActionLedger: {
      record: vi.fn().mockResolvedValue({ actionId: 'test-action-id' }),
      updateResult: vi.fn(),
    },
    PolicyEngine: vi.fn().mockImplementation(function() {
      return {
        evaluate: vi.fn().mockReturnValue({ decision: 'ALLOW' }),
      };
    }),
    RiskEngine: vi.fn().mockImplementation(function() {
      return {
        classify: vi.fn().mockReturnValue('LOW'),
      };
    }),
  };
});

import { ActionLedger } from '@ownpilot/core/security';

describe('VoiceService - QA-022 / QA-004 Regression', () => {
  it('does not fabricate success for production voice tools', async () => {
    const service = new VoiceService();
    
    const result = await service.handleVoiceToolCall('user', 'workspace', 'session-1', 'say_hello', { message: 'hello' });
    
    // The service must NOT return success:true if there is no real provider.
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('Voice tool execution provider is not configured');
    
    // Must update ledger with failure
    expect(ActionLedger.updateResult).toHaveBeenCalledWith('test-action-id', expect.objectContaining({ error: expect.any(String) }), expect.any(Number));
  });
});
