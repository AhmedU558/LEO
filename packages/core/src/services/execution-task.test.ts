import { describe, it, expect } from 'vitest';
import { canTransitionExecutionTask, EXECUTION_TASK_TERMINAL } from './execution-task.js';
describe('execution task lifecycle', () => {
  it('requires verification before completion', () => {
    expect(canTransitionExecutionTask('RUNNING', 'COMPLETED')).toBe(false);
    expect(canTransitionExecutionTask('RUNNING', 'VERIFYING')).toBe(true);
    expect(canTransitionExecutionTask('VERIFYING', 'COMPLETED')).toBe(true);
  });
  it('never resumes terminal states or bypasses approval', () => {
    for (const state of EXECUTION_TASK_TERMINAL)
      expect(canTransitionExecutionTask(state, 'READY')).toBe(false);
    expect(canTransitionExecutionTask('WAITING_APPROVAL', 'COMPLETED')).toBe(false);
    expect(canTransitionExecutionTask('WAITING_APPROVAL', 'READY')).toBe(true);
  });
});
