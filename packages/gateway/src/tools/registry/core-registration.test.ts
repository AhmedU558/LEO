import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerGatewayTools, registerDynamicTools } from './core-registration.js';
import { ToolRegistry } from '@ownpilot/core/tools';
import * as permissionService from '../../services/tool/permission.js';

vi.mock('../../services/tool/permission.js', () => ({
  checkToolPermission: vi.fn(),
}));

describe('core-registration (QA-007)', () => {
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry();
    vi.clearAllMocks();
  });

  it('enforces PolicyEngine/permission checks on native tool executions (QA-007)', async () => {
    // Mock permission to DENY
    vi.mocked(permissionService.checkToolPermission).mockResolvedValue({
      allowed: false,
      reason: 'QA-007 test denial',
    });

    registerGatewayTools(tools, 'user-123', false);

    // Pick any registered tool, e.g., 'core.create_memory'
    const tool = tools.get('core.create_memory');
    if (!tool) throw new Error('Tool not registered');

    // Execute the native tool directly on the registry
    const result = await tools.execute(
      'core.create_memory',
      { text: 'test' },
      { userId: 'user-123' }
    );

    // It should have failed closed
    expect(result.ok).toBe(true);
    expect(result.value.isError).toBe(true);
    expect(String(result.value.content)).toContain('blocked: QA-007 test denial');

    // Verify checkToolPermission was called
    expect(permissionService.checkToolPermission).toHaveBeenCalled();
  });
});
