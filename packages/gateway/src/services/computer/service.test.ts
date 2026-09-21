import { describe, it, expect, vi } from 'vitest';
import { ComputerService } from './service.js';

// Mock ActionLedger so we don't hit DB
vi.mock('@ownpilot/core/security', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    ActionLedger: {
      record: vi.fn().mockResolvedValue({ actionId: 'test-action-id' }),
      updateResult: vi.fn(),
    },
    PolicyEngine: vi.fn().mockImplementation(function() { return {
      evaluate: vi.fn().mockReturnValue({ decision: 'ALLOW' }),
    }; }),
    RiskEngine: vi.fn().mockImplementation(function() { return { classify: vi.fn().mockReturnValue('LOW') }; }),
  };
});

import { ActionLedger } from '@ownpilot/core/security';

describe('ComputerService - QA-022 Regression', () => {
  it('does not fabricate success for production computer provider execution', async () => {
    const service = new ComputerService();
    
    const task = { id: 'task-1', userId: 'user', status: 'pending', actions: [], results: [], createdAt: '', updatedAt: '' };
    const action = { type: 'click', params: {} };
    
    const result = await service.executeTaskAction('user', 'workspace', task as any, action as any);
    
    // The service must NOT return success:true if there is no real provider.
    expect(result.success).toBe(false);
    expect(result.error).toContain('No production computer execution provider configured');
    
    // Must update ledger with failure
    expect(ActionLedger.updateResult).toHaveBeenCalledWith('test-action-id', expect.objectContaining({ error: expect.any(String) }), expect.any(Number));
  });
});
