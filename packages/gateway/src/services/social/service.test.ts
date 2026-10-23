import { describe, it, expect, vi } from 'vitest';
import { SocialService } from './service.js';

vi.mock('@ownpilot/core/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ActionLedger: {
      record: vi.fn().mockResolvedValue({ actionId: 'test-action-id' }),
      setProvider: vi.fn(),
      updateResult: vi.fn(),
    },
    PolicyEngine: vi.fn().mockImplementation(function () {
      return {
        evaluate: vi.fn().mockReturnValue({ decision: 'ALLOW' }),
      };
    }),
    RiskEngine: vi.fn().mockImplementation(function () {
      return { classify: vi.fn().mockReturnValue('LOW') };
    }),
  };
});

import { ActionLedger } from '@ownpilot/core/security';

describe('SocialService - QA-022 Regression', () => {
  it.skip('does not fabricate success for production social publish', async () => {
    const service = new SocialService();

    const content = { id: 'c-1', text: 'hello' };
    const account = { id: 'a-1', platform: 'twitter' };

    const result = await service.publishWithPolicy(
      'user',
      'workspace',
      content as any,
      account as any
    );

    // The service must NOT return success:true if there is no real provider.
    expect(result.success).toBe(false);
    expect(result.error).toContain('No production social publish provider configured');

    // Must update ledger with failure
    expect(ActionLedger.updateResult).toHaveBeenCalledWith(
      'test-action-id',
      expect.objectContaining({ error: expect.any(String) }),
      expect.any(Number)
    );
  });
});
