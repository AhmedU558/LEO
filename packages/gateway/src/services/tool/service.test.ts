/**
 * ToolService Implementation Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures the fns are available before vi.mock hoisting
// ---------------------------------------------------------------------------

const mockExecuteToolCall = vi.hoisted(() => vi.fn());
const mockGetDefinition = vi.hoisted(() => vi.fn());
const mockGetDefinitions = vi.hoisted(() => vi.fn());
const mockGetToolsBySource = vi.hoisted(() => vi.fn());
const mockHas = vi.hoisted(() => vi.fn());
const mockGetNames = vi.hoisted(() => vi.fn());
const mockUse = vi.hoisted(() => vi.fn());
const mockExecuteTool = vi.hoisted(() => vi.fn());

vi.mock('./executor.js', () => ({
  getSharedToolRegistry: () => ({
    executeToolCall: mockExecuteToolCall,
    getDefinition: mockGetDefinition,
    getDefinitions: mockGetDefinitions,
    getToolsBySource: mockGetToolsBySource,
    has: mockHas,
    getNames: mockGetNames,
    use: mockUse,
  }),
  executeTool: mockExecuteTool,
}));

// ---------------------------------------------------------------------------
// SUT — must be imported after vi.mock declarations
// ---------------------------------------------------------------------------

const { ToolService, createToolService } = await import('./service.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Provide sensible defaults so tests that don't mock individually don't break
    mockGetDefinitions.mockReturnValue([]);
    mockGetToolsBySource.mockReturnValue([]);
    mockGetNames.mockReturnValue([]);
  });

  // =========================================================================
  // execute
  // =========================================================================

  describe('execute', () => {
    // QA-016 / QA-007: execute() has exactly one path. It previously branched —
    // with `execSource` it went through executeTool() and got permission
    // checks, the atomic idempotency claim and the audit record; without it,
    // it called registry.executeToolCall() directly and got none of them. These
    // tests pin that the bypass is gone: an optional field on the context must
    // not decide whether an effect is policed.

    function okResult(result: unknown) {
      mockExecuteTool.mockResolvedValue({ success: true, result });
    }

    it('routes every call through executeTool, never the registry directly', async () => {
      okResult('ok');

      const svc = new ToolService('user-1');
      await svc.execute('my_tool', { key: 'val' });

      expect(mockExecuteTool).toHaveBeenCalledOnce();
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
      const [name, args, userId] = mockExecuteTool.mock.calls[0];
      expect(name).toBe('my_tool');
      expect(args).toEqual({ key: 'val' });
      expect(userId).toBe('user-1');
    });

    it('defaults the execution source to "system" when the caller declares none', async () => {
      okResult('ok');

      await new ToolService().execute('tool_a', {});

      const execContext = mockExecuteTool.mock.calls[0][4];
      expect(execContext.source).toBe('system');
    });

    it('forwards a declared execSource, operationId and signal', async () => {
      okResult('ok');
      const controller = new AbortController();

      await new ToolService().execute(
        'tool_a',
        {},
        { execSource: 'plan', operationId: 'op-1', signal: controller.signal }
      );

      const execContext = mockExecuteTool.mock.calls[0][4];
      expect(execContext).toEqual({
        source: 'plan',
        operationId: 'op-1',
        signal: controller.signal,
      });
    });

    it('returns string content as-is', async () => {
      okResult('result text');

      const result = await new ToolService().execute('tool_a', {});

      expect(result.content).toBe('result text');
    });

    it('stringifies object content to JSON', async () => {
      okResult({ data: 123, nested: { key: 'val' } });

      const result = await new ToolService().execute('tool_b', {});

      expect(result.content).toBe(JSON.stringify({ data: 123, nested: { key: 'val' } }));
    });

    it('stringifies array content to JSON', async () => {
      okResult([1, 2, 3]);

      const result = await new ToolService().execute('tool_c', {});

      expect(result.content).toBe('[1,2,3]');
    });

    it('stringifies number content to JSON', async () => {
      okResult(42);

      const result = await new ToolService().execute('tool_num', {});

      expect(result.content).toBe('42');
    });

    it('stringifies boolean content to JSON', async () => {
      okResult(true);

      const result = await new ToolService().execute('tool_bool', {});

      expect(result.content).toBe('true');
    });

    it('renders null content as empty string', async () => {
      okResult(null);

      const result = await new ToolService().execute('tool_null', {});

      expect(result.content).toBe('');
    });

    it('handles empty string content as string (no stringify)', async () => {
      okResult('');

      const result = await new ToolService().execute('tool_empty_str', {});

      expect(result.content).toBe('');
    });

    it('reports a failed execution as isError with its error message', async () => {
      mockExecuteTool.mockResolvedValue({ success: false, error: 'oops' });

      const result = await new ToolService().execute('tool_fail', {});

      expect(result.isError).toBe(true);
      expect(result.content).toBe('oops');
    });

    it('falls back to a generic message when a failure carries no error text', async () => {
      mockExecuteTool.mockResolvedValue({ success: false });

      const result = await new ToolService().execute('tool_fail', {});

      expect(result.isError).toBe(true);
      expect(result.content).toBe('Tool execution failed');
    });

    it('propagates isError: false from a successful execution', async () => {
      okResult('good');

      const result = await new ToolService().execute('tool_ok', {});

      expect(result.isError).toBe(false);
    });

    it('uses the constructor userId as default when context userId is omitted', async () => {
      okResult('');

      await new ToolService('my-user').execute('tool_x', {});

      expect(mockExecuteTool.mock.calls[0][2]).toBe('my-user');
    });

    it('uses "default" userId when constructed without userId and no context', async () => {
      okResult('');

      await new ToolService().execute('tool_x', {});

      expect(mockExecuteTool.mock.calls[0][2]).toBe('default');
    });

    it('uses provided userId from context', async () => {
      okResult('ok');

      await new ToolService('constructor-user').execute('tool_a', {}, { userId: 'ctx-user' });

      expect(mockExecuteTool.mock.calls[0][2]).toBe('ctx-user');
    });

    it('passes complex nested args through unchanged', async () => {
      okResult('');

      const args = { deep: { nested: { array: [1, 2], flag: true } } };
      await new ToolService().execute('tool_nested', args);

      expect(mockExecuteTool.mock.calls[0][1]).toEqual(args);
    });

    it('rejects unserialisable args before any operation is claimed', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const result = await new ToolService().execute('tool_circular', circular);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('cannot serialize');
      expect(mockExecuteTool).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by the executor', async () => {
      mockExecuteTool.mockRejectedValue(new Error('registry boom'));

      await expect(new ToolService().execute('tool_err', {})).rejects.toThrow('registry boom');
    });

    it('returns result with only content and isError fields', async () => {
      okResult('data');

      const result = await new ToolService().execute('tool_x', {});

      expect(Object.keys(result).sort()).toEqual(['content', 'isError']);
      expect(result.content).toBe('data');
      expect(result.isError).toBe(false);
    });
  });

  // =========================================================================
  // getDefinition
  // =========================================================================

  describe('getDefinition', () => {
    it('returns definition from registry when tool exists', () => {
      const def = { name: 'foo', description: 'bar', parameters: {} };
      mockGetDefinition.mockReturnValue(def);

      const svc = new ToolService();
      expect(svc.getDefinition('foo')).toEqual(def);
      expect(mockGetDefinition).toHaveBeenCalledWith('foo');
    });

    it('returns undefined for unknown tool', () => {
      mockGetDefinition.mockReturnValue(undefined);

      const svc = new ToolService();
      expect(svc.getDefinition('nonexistent')).toBeUndefined();
    });

    it('passes the exact name string to registry', () => {
      mockGetDefinition.mockReturnValue(undefined);

      const svc = new ToolService();
      svc.getDefinition('core.get_time');

      expect(mockGetDefinition).toHaveBeenCalledWith('core.get_time');
    });
  });

  // =========================================================================
  // getDefinitions
  // =========================================================================

  describe('getDefinitions', () => {
    it('returns all definitions from registry', () => {
      const defs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
      mockGetDefinitions.mockReturnValue(defs);

      const svc = new ToolService();
      expect(svc.getDefinitions()).toEqual(defs);
    });

    it('returns empty array when no tools are registered', () => {
      mockGetDefinitions.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getDefinitions()).toEqual([]);
    });

    it('returns the same reference from registry (readonly)', () => {
      const defs = [{ name: 'x' }];
      mockGetDefinitions.mockReturnValue(defs);

      const svc = new ToolService();
      const result = svc.getDefinitions();

      expect(result).toBe(defs);
    });
  });

  // =========================================================================
  // getDefinitionsBySource
  // =========================================================================

  describe('getDefinitionsBySource', () => {
    it('maps registered tools to their definitions', () => {
      const toolEntries = [
        { definition: { name: 'core_tool_1', description: 'd1' } },
        { definition: { name: 'core_tool_2', description: 'd2' } },
      ];
      mockGetToolsBySource.mockReturnValue(toolEntries);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('core');

      expect(result).toEqual([
        { name: 'core_tool_1', description: 'd1' },
        { name: 'core_tool_2', description: 'd2' },
      ]);
      expect(mockGetToolsBySource).toHaveBeenCalledWith('core');
    });

    it('returns empty array when no tools match the source', () => {
      mockGetToolsBySource.mockReturnValue([]);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('plugin');

      expect(result).toEqual([]);
    });

    it('works with each valid ToolSource value', () => {
      mockGetToolsBySource.mockReturnValue([]);

      const svc = new ToolService();
      const sources = ['core', 'gateway', 'plugin', 'custom', 'dynamic', 'mcp'] as const;

      for (const source of sources) {
        svc.getDefinitionsBySource(source);
        expect(mockGetToolsBySource).toHaveBeenCalledWith(source);
      }
    });

    it('extracts only the definition property from each tool entry', () => {
      const toolEntries = [
        { definition: { name: 'a' }, source: 'core', executor: () => {} },
        { definition: { name: 'b' }, source: 'core', executor: () => {} },
      ];
      mockGetToolsBySource.mockReturnValue(toolEntries);

      const svc = new ToolService();
      const result = svc.getDefinitionsBySource('core');

      // Should only contain definitions, not executor or source
      expect(result).toEqual([{ name: 'a' }, { name: 'b' }]);
    });
  });

  // =========================================================================
  // has
  // =========================================================================

  describe('has', () => {
    it('returns true when tool exists in registry', () => {
      mockHas.mockReturnValue(true);

      const svc = new ToolService();
      expect(svc.has('existing_tool')).toBe(true);
      expect(mockHas).toHaveBeenCalledWith('existing_tool');
    });

    it('returns false when tool does not exist in registry', () => {
      mockHas.mockReturnValue(false);

      const svc = new ToolService();
      expect(svc.has('missing_tool')).toBe(false);
    });

    it('passes exact name to registry', () => {
      mockHas.mockReturnValue(false);

      const svc = new ToolService();
      svc.has('plugin.telegram.send_message');

      expect(mockHas).toHaveBeenCalledWith('plugin.telegram.send_message');
    });
  });

  // =========================================================================
  // getNames
  // =========================================================================

  describe('getNames', () => {
    it('returns tool names from registry', () => {
      mockGetNames.mockReturnValue(['tool_a', 'tool_b', 'tool_c']);

      const svc = new ToolService();
      expect(svc.getNames()).toEqual(['tool_a', 'tool_b', 'tool_c']);
    });

    it('returns empty array when no tools registered', () => {
      mockGetNames.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getNames()).toEqual([]);
    });

    it('returns the same reference from registry (readonly)', () => {
      const names = ['x', 'y'];
      mockGetNames.mockReturnValue(names);

      const svc = new ToolService();
      expect(svc.getNames()).toBe(names);
    });
  });

  // =========================================================================
  // use
  // =========================================================================

  describe('use', () => {
    it('passes middleware to registry.use', () => {
      const middleware = { name: 'test-mw', handler: () => {} };

      const svc = new ToolService();
      svc.use(middleware as unknown as import('@ownpilot/core').ToolMiddleware);

      expect(mockUse).toHaveBeenCalledOnce();
      expect(mockUse).toHaveBeenCalledWith(middleware);
    });

    it('can register multiple middlewares', () => {
      const mw1 = { name: 'mw1' };
      const mw2 = { name: 'mw2' };

      const svc = new ToolService();
      svc.use(mw1 as unknown as import('@ownpilot/core').ToolMiddleware);
      svc.use(mw2 as unknown as import('@ownpilot/core').ToolMiddleware);

      expect(mockUse).toHaveBeenCalledTimes(2);
      expect(mockUse).toHaveBeenNthCalledWith(1, mw1);
      expect(mockUse).toHaveBeenNthCalledWith(2, mw2);
    });
  });

  // =========================================================================
  // getCount
  // =========================================================================

  describe('getCount', () => {
    it('returns the length of getNames result', () => {
      mockGetNames.mockReturnValue(['x', 'y', 'z']);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(3);
    });

    it('returns 0 when no tools registered', () => {
      mockGetNames.mockReturnValue([]);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(0);
    });

    it('reflects current count (not cached)', () => {
      mockGetNames.mockReturnValue(['a']);

      const svc = new ToolService();
      expect(svc.getCount()).toBe(1);

      mockGetNames.mockReturnValue(['a', 'b', 'c', 'd']);
      expect(svc.getCount()).toBe(4);
    });
  });

  // =========================================================================
  // constructor / userId behavior
  // =========================================================================

  describe('constructor', () => {
    it('accepts a userId parameter', () => {
      const svc = new ToolService('custom-user');
      // Verify it's used internally by calling a method that hits the registry
      mockGetNames.mockReturnValue([]);
      svc.getCount();
      // No error means the constructor accepted the userId
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('defaults userId to "default" when not provided', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: '' });

      const svc = new ToolService();
      await svc.execute('tool_x', {});

      expect(mockExecuteTool.mock.calls[0][2]).toBe('default');
    });
  });

  // =========================================================================
  // createToolService factory
  // =========================================================================

  describe('createToolService', () => {
    it('creates a ToolService instance with custom userId', () => {
      const svc = createToolService('user-x');
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('creates a ToolService instance with default userId when omitted', () => {
      const svc = createToolService();
      expect(svc).toBeInstanceOf(ToolService);
    });

    it('returned instance satisfies IToolService interface', () => {
      const svc = createToolService();

      expect(typeof svc.execute).toBe('function');
      expect(typeof svc.getDefinition).toBe('function');
      expect(typeof svc.getDefinitions).toBe('function');
      expect(typeof svc.getDefinitionsBySource).toBe('function');
      expect(typeof svc.has).toBe('function');
      expect(typeof svc.getNames).toBe('function');
      expect(typeof svc.use).toBe('function');
      expect(typeof svc.getCount).toBe('function');
    });

    it('returned instance uses the provided userId for execution', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: '' });

      const svc = createToolService('factory-user');
      await svc.execute('t', {});

      expect(mockExecuteTool.mock.calls[0][2]).toBe('factory-user');
    });
  });

  // =========================================================================
  // Multiple instances isolation
  // =========================================================================

  describe('instance isolation', () => {
    it('different instances use different userIds', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: '' });

      const svc1 = new ToolService('user-A');
      const svc2 = new ToolService('user-B');

      await svc1.execute('tool_x', {});
      await svc2.execute('tool_x', {});

      expect(mockExecuteTool.mock.calls[0][2]).toBe('user-A');
      expect(mockExecuteTool.mock.calls[1][2]).toBe('user-B');
    });
  });

  // =========================================================================
  // execSource branch (lines 42-51)
  // =========================================================================

  describe('execute with execSource', () => {
    it('routes through executeTool when execSource is provided', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: 'exec-result' });

      const svc = new ToolService('user-1');
      const result = await svc.execute('my_tool', { key: 'val' }, { execSource: 'webhook' });

      expect(mockExecuteTool).toHaveBeenCalledOnce();
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
      expect(result.content).toBe('exec-result');
      expect(result.isError).toBe(false);
    });

    it('returns error content when executeTool returns success: false', async () => {
      mockExecuteTool.mockResolvedValue({ success: false, error: 'Permission denied' });

      const svc = new ToolService('user-1');
      const result = await svc.execute('my_tool', {}, { execSource: 'agent' });

      expect(result.content).toBe('Permission denied');
      expect(result.isError).toBe(true);
    });

    it('falls back to "Tool execution failed" when execSource fails with no error message', async () => {
      mockExecuteTool.mockResolvedValue({ success: false, error: undefined });

      const svc = new ToolService('user-1');
      const result = await svc.execute('my_tool', {}, { execSource: 'trigger' });

      expect(result.content).toBe('Tool execution failed');
      expect(result.isError).toBe(true);
    });

    it('uses empty string for null result when execSource succeeds', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: null });

      const svc = new ToolService('user-1');
      const result = await svc.execute('my_tool', {}, { execSource: 'agent' });

      expect(result.content).toBe('');
      expect(result.isError).toBe(false);
    });

    it('passes execSource as source in ToolExecContext', async () => {
      mockExecuteTool.mockResolvedValue({ success: true, result: 'ok' });

      const svc = new ToolService('user-1');
      await svc.execute('my_tool', {}, { execSource: 'webhook', userId: 'u-2' });

      const [, , , , execContext] = mockExecuteTool.mock.calls[0];
      expect(execContext.source).toBe('webhook');
    });
  });

  // =========================================================================
  // Circular args (line 59) and circular content (line 79)
  // =========================================================================

  describe('execute edge cases', () => {
    it('returns isError: true when args cannot be serialized to JSON (circular reference)', async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular; // Creates circular reference

      const svc = new ToolService();
      const result = await svc.execute('tool_x', circular);

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid tool arguments');
      expect(mockExecuteToolCall).not.toHaveBeenCalled();
    });

    it('falls back to String() when result.content cannot be JSON.stringify-ed (line 79)', async () => {
      // Return an object whose JSON.stringify throws
      const unserializable = {
        toJSON: () => {
          throw new Error('no serialize');
        },
      };
      mockExecuteTool.mockResolvedValue({ success: true, result: unserializable });

      const svc = new ToolService();
      const result = await svc.execute('tool_x', {});

      // String(unserializable) gives '[object Object]'
      expect(result.content).toBe('[object Object]');
      expect(result.isError).toBe(false);
    });
  });
});
