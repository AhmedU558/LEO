import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { McpClientService } from './client.js';
import type { McpServerRecord } from '../../db/repositories/mcp-servers.js';
import { getMcpServersRepo } from '../../db/repositories/mcp-servers.js';
import { getSharedToolRegistry } from '../tool/executor.js';

let mockClientInstance: any;
export const connectMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class StdioClientTransportMock { constructor() {} }
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  return {
    Client: class ClientMock {
      constructor() { // eslint-disable-next-line @typescript-eslint/no-this-alias
      mockClientInstance = this; }
      connect = connectMock;
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
  getSharedToolRegistry: vi.fn(),
}));

describe('QA-026: MCP Provider Status and Integration', () => {
  let mcpClient: McpClientService;
  
  beforeEach(() => {
    mcpClient = new McpClientService();
    vi.mocked(getSharedToolRegistry).mockReturnValue({ registerMcpTools: vi.fn(), unregisterMcpTools: vi.fn() } as any);
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  it('surfaces provider failures accurately and sets isError = true', async () => {
    const server: McpServerRecord = {
      id: 'test-3', user_id: 'user-3', name: 'fail-mcp', display_name: 'Fail',
      transport: 'stdio', command: 'node', args: [], env: {}, url: null, headers: null,
      enabled: true, auto_connect: true, status: 'disconnected',
    };
    
    vi.mocked(getMcpServersRepo).mockReturnValue({
      updateStatus: vi.fn(),
      getByName: vi.fn().mockResolvedValue(server)
    } as any);
    
    await mcpClient.connect(server);
    
    const registryMock = vi.mocked(getSharedToolRegistry)().registerMcpTools as any;
    const toolsMap = registryMock.mock.calls[0][1];
    const executor = toolsMap.get('test-tool').executor;
    
    mockClientInstance.callTool.mockRejectedValueOnce(new Error('Internal MCP crash'));
    
    const res = await executor({ arg: '1' }, { userId: 'user-3', callId: '1', conversationId: '1' });
    
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/MCP tool error: Internal MCP crash/);
  });

  it('unavailable/disconnected providers fail cleanly', async () => {
    const server: McpServerRecord = {
      id: 'test-4', user_id: 'user-4', name: 'disc-mcp', display_name: 'Disc',
      transport: 'stdio', command: 'node', args: [], env: {}, url: null, headers: null,
      enabled: true, auto_connect: true, status: 'disconnected',
    };
    
    vi.mocked(getMcpServersRepo).mockReturnValue({
      updateStatus: vi.fn(),
      getByName: vi.fn().mockResolvedValue(server)
    } as any);
    
    await mcpClient.connect(server);
    
    const registryMock = vi.mocked(getSharedToolRegistry)().registerMcpTools as any;
    const toolsMap = registryMock.mock.calls[0][1];
    const executor = toolsMap.get('test-tool').executor;
    
    mcpClient.disconnect('disc-mcp');
    
    const res = await executor({ arg: '1' }, { userId: 'user-4', callId: '1', conversationId: '1' });
    
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/MCP server "disc-mcp" is not connected/);
  });
  
  it('handles connection failure during connect() cleanly', async () => {
    const server: McpServerRecord = {
      id: 'test-5', user_id: 'user-5', name: 'conn-fail-mcp', display_name: 'ConnFail',
      transport: 'stdio', command: 'node', args: [], env: {}, url: null, headers: null,
      enabled: true, auto_connect: true, status: 'disconnected',
    };
    
    const repoMock = {
      updateStatus: vi.fn(),
      getByName: vi.fn().mockResolvedValue(server)
    };
    vi.mocked(getMcpServersRepo).mockReturnValue(repoMock as any);
    
    // Simulate connection failure (e.g., spawn ENOENT)
    connectMock.mockRejectedValueOnce(new Error('spawn node ENOENT'));
    
    await expect(mcpClient.connect(server)).rejects.toThrow('spawn node ENOENT');
    expect(repoMock.updateStatus).toHaveBeenCalledWith(server.id, 'error', expect.any(String));
  });

  it('successful authorized execution', async () => {
    const server: McpServerRecord = {
      id: 'test-6', user_id: 'user-6', name: 'success-mcp', display_name: 'Success',
      transport: 'stdio', command: 'node', args: [], env: {}, url: null, headers: null,
      enabled: true, auto_connect: true, status: 'disconnected',
    };
    
    vi.mocked(getMcpServersRepo).mockReturnValue({
      updateStatus: vi.fn(),
      getByName: vi.fn().mockResolvedValue(server)
    } as any);
    
    await mcpClient.connect(server);
    
    const registryMock = vi.mocked(getSharedToolRegistry)().registerMcpTools as any;
    const toolsMap = registryMock.mock.calls[0][1];
    const executor = toolsMap.get('test-tool').executor;
    
    const res = await executor({ arg: '1' }, { userId: 'user-6', callId: '1', conversationId: '1' });
    
    expect(res.isError).toBeUndefined();
    expect(res.content).toContain('success');
  });
});


