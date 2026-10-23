import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionSandboxManager, getExtensionSandbox, resetExtensionSandbox } from './sandbox.js';

vi.mock('@ownpilot/core/sandbox', () => ({
  executeIsolatedJavaScript: vi.fn(async (code: string, globals: any) => {
    // very basic mock
    if (code.includes('throw new Error')) throw new Error('simulated error');
    if (code.includes('args.x + 1')) return globals.args.x + 1;
    return { data: 'test' };
  }),
  validateToolCode: () => ({ valid: true, errors: [] }),
}));

describe('ExtensionSandboxManager - QA-009 Isolated execution', () => {
  beforeEach(() => {
    resetExtensionSandbox();
  });

  it('executes code successfully via docker sandbox', async () => {
    const manager = getExtensionSandbox();
    const result = await manager.execute({
      extensionId: 'ext-1',
      toolName: 'testTool',
      code: 'module.exports = function(args) { return args.x + 1; }',
      args: { x: 5 },
    });

    expect(result.success).toBe(true);
    expect(result.result).toBe(6);
  });

  it('handles execution errors', async () => {
    const manager = getExtensionSandbox();
    const result = await manager.execute({
      extensionId: 'ext-1',
      toolName: 'testTool',
      code: 'throw new Error("fail");',
      args: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/simulated error/);
  });
});
