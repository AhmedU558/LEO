import { describe, it, expect, vi } from 'vitest';
import { AutonomyService } from './service.js';

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

describe('AutonomyService - QA-004 Regression', () => {
  it('does not fabricate success in the background loop', async () => {
    const service = new AutonomyService();
    const task = {
      id: 'task-1',
      goal: 'test',
      profileId: 'default',
      status: 'idle' as const,
      userId: 'user',
      workspaceId: 'workspace',
      plan: [],
      currentStepIndex: 0,
      failures: 0,
      spentUsd: 0,
      createdAt: '',
      updatedAt: '',
    };
    
    await service.startTask(task);
    
    // Wait for the background setTimeout loop
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const status = await service.getTaskStatus('task-1');
    expect(status).toBe('failed'); // Must fail, no real provider
  });
});
