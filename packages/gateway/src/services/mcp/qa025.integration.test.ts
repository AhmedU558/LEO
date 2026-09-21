import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpClientService } from './client.js';
import type { McpServerRecord } from '../../db/repositories/mcp-servers.js';
import { getMcpServersRepo } from '../../db/repositories/mcp-servers.js';
import { getSharedToolRegistry } from '../tool/executor.js';

let capturedArgs: any = null;

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  return {
    StdioClientTransport: class StdioClientTransportMock {
      constructor(args: any) {
        capturedArgs = args;
      }
    }
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class ClientMock {
      connect = vi.fn().mockResolvedValue(undefined);
      listTools = vi.fn().mockResolvedValue({
        tools: [{ name: 'test-tool', description: 'desc', inputSchema: {} }],
      });
      getServerVersion = vi.fn().mockReturnValue({ name: 'test', version: '1.0' });
      close = vi.fn();
      callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'success' }] });
    }
  };
});

vi.mock('../../db/repositories/mcp-servers.js', () => ({
  getMcpServersRepo: vi.fn().mockReturnValue({
    getByName: vi.fn(),
    getEnabled: vi.fn(),
    updateStatus: vi.fn(),
  }),
}));

vi.mock('../tool/executor.js', () => ({
  getSharedToolRegistry: vi.fn().mockReturnValue({
    registerMcpTools: vi.fn(),
  }),
}));

describe('QA-025 and QA-026: MCP Credentials and Process Boundary', () => {
  let mcpClient: McpClientService;
  
  beforeEach(() => {
    vi.mocked(getSharedToolRegistry).mockReturnValue({ registerMcpTools: vi.fn() } as any);
    mcpClient = new McpClientService();
    process.env.SUPER_SECRET_KEY = 'should-not-leak';
    process.env.PATH = '/mock/path';
    process.env.HOME = '/mock/home';
    capturedArgs = null;
  });
  
  afterEach(() => {
    vi.mocked(getSharedToolRegistry).mockReturnValue({ registerMcpTools: vi.fn() } as any);
    delete process.env.SUPER_SECRET_KEY;
    vi.resetAllMocks();
  });
  
  it('does not inherit unrestricted host environment variables in StdioClientTransport', async () => {
    const server: McpServerRecord = {
      id: 'test-1',
      user_id: 'user-1',
      name: 'test-mcp',
      display_name: 'Test MCP',
      transport: 'stdio',
      command: 'node',
      args: ['dummy.js'],
      env: { AUTHORIZED_KEY: 'abc' },
      url: null,
      headers: null,
      enabled: true,
      auto_connect: true,
      status: 'disconnected',
    };
    
    await mcpClient.connect(server);
    
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.env).toHaveProperty('PATH', '/mock/path');
    expect(capturedArgs.env).toHaveProperty('HOME', '/mock/home');
    expect(capturedArgs.env).toHaveProperty('AUTHORIZED_KEY', 'abc');
    expect(capturedArgs.env).not.toHaveProperty('SUPER_SECRET_KEY');
  });

  it('fails closed when context (workspace/user) is missing for tool execution', async () => {
    const server: McpServerRecord = {
      id: 'test-2',
      user_id: 'user-2',
      name: 'test-mcp-2',
      display_name: 'Test MCP 2',
      transport: 'stdio',
      command: 'node',
      args: ['dummy.js'],
      env: {},
      url: null,
      headers: null,
      enabled: true,
      auto_connect: true,
      status: 'disconnected',
    };
    
    const repoMock = {
      updateStatus: vi.fn(),
      getByName: vi.fn().mockResolvedValue(server)
    };
    vi.mocked(getMcpServersRepo).mockReturnValue(repoMock as any);
    
    await mcpClient.connect(server);
    
    const registryMock = vi.mocked(getSharedToolRegistry);
    expect(registryMock).toHaveBeenCalled();
    const registerCall = registryMock().registerMcpTools as any;
    expect(registerCall).toHaveBeenCalled();
    
    const toolsMap = registerCall.mock.calls[0][1];
    const tool = toolsMap.get('test-tool');
    expect(tool).toBeDefined();
    
    const executor = tool.executor;
    
    // Attempt to execute WITHOUT context
    const resNoContext = await executor({ arg1: 'value' }, undefined);
    expect(resNoContext.isError).toBe(true);
    expect(resNoContext.content).toMatch(/PolicyEngine DENY: Missing execution context/);
    
    // Attempt to execute with WRONG user context (cross-workspace)
    repoMock.getByName.mockResolvedValueOnce(null); // Simulated not found for wrong user
    const resWrongContext = await executor({ arg1: 'value' }, { userId: 'wrong-user', callId: '1', conversationId: '1' });
    expect(resWrongContext.isError).toBe(true);
    expect(resWrongContext.content).toMatch(/PolicyEngine DENY: MCP server "test-mcp-2" is not authorized/);

    // Attempt to execute with DISABLED server
    repoMock.getByName.mockResolvedValueOnce({ ...server, enabled: false });
    const resDisabled = await executor({ arg1: 'value' }, { userId: 'user-2', callId: '1', conversationId: '1' });
    expect(resDisabled.isError).toBe(true);
    expect(resDisabled.content).toMatch(/PolicyEngine DENY: MCP server "test-mcp-2" is disabled/);

    // Valid execution
    repoMock.getByName.mockResolvedValueOnce(server);
    const resValid = await executor({ arg1: 'value' }, { userId: 'user-2', callId: '1', conversationId: '1' });
    expect(resValid.isError).toBeUndefined(); // No error!
  });
});
