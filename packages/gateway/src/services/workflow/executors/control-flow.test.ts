import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { executeConditionNode, executeSwitchNode, executeMergeNode } from './control-flow.js';

// --- Mocks ---

const mockResolveTemplates = vi.hoisted(() => {
  return (_templates: Record<string, string>, _nodeOutputs: unknown, _variables: unknown) =>
    _templates;
});

const mockSafeVmEval = vi.hoisted(() => vi.fn());

vi.mock('../template-resolver.js', () => ({
  resolveTemplates: mockResolveTemplates,
}));

vi.mock('./utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils.js')>();
  return {
    ...actual,
    safeVmEval: mockSafeVmEval,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Helpers ---

function makeNode(id: string, data: unknown): WorkflowNode {
  return { id, name: id, type: 'test', data: data as never, nextNodes: [] };
}

function makeNodeOutput(output: unknown, status: 'success' | 'error' = 'success'): NodeResult {
  return { nodeId: 'n', status, output };
}

// --- executeConditionNode ---

describe('executeConditionNode', () => {
  it('', async () => {
    mockSafeVmEval.mockReturnValue(true);
    const node = makeNode('cond1', { expression: 'x > 5' });
    const result = await executeConditionNode(node, {}, { x: 10 });
    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('true');
    expect(result.output).toBe(true);
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue(false);
    const node = makeNode('cond2', { expression: 'x > 5' });
    const result = await executeConditionNode(node, {}, { x: 3 });
    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('false');
    expect(result.output).toBe(false);
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue(true);
    const node = makeNode('cond3', { expression: 'a && b' });
    const nodeOutputs = { n1: makeNodeOutput('hello') };
    const variables = { a: true, b: false };
    await executeConditionNode(node, nodeOutputs, variables);
    expect(mockSafeVmEval).toHaveBeenCalledWith(
      'a && b',
      expect.objectContaining({ a: true, b: false, n1: 'hello', data: 'hello' }),
      5000
    );
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue(true);
    const node = makeNode('cond4', { expression: 'x', timeoutMs: 1000 });
    await executeConditionNode(node, {}, {});
    expect(mockSafeVmEval).toHaveBeenCalledWith(expect.any(String), expect.any(Object), 1000);
  });

  it('', async () => {
    mockSafeVmEval.mockImplementation(() => {
      throw new Error('Script error');
    });
    const node = makeNode('cond5', { expression: 'throw 1' });
    const result = await executeConditionNode(node, {}, {});
    expect(result.status).toBe('error');
    expect(result.error).toBe('Script error');
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue(false);
    const node = makeNode('cond6', { expression: 'x', timeoutMs: 2000 });
    await executeConditionNode(node, {}, {});
    expect(mockSafeVmEval).toHaveBeenCalledWith('x', expect.any(Object), 2000);
  });
});

// --- executeSwitchNode ---

describe('executeSwitchNode', () => {
  it('', async () => {
    mockSafeVmEval.mockReturnValue('beta');
    const node = makeNode('sw1', {
      expression: 'env',
      cases: [
        { label: 'alpha', value: 'alpha' },
        { label: 'beta', value: 'beta' },
        { label: 'gamma', value: 'gamma' },
      ],
    });
    const result = await executeSwitchNode(node, {}, {});
    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('beta');
    expect(result.output).toBe('beta');
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue('unknown');
    const node = makeNode('sw2', {
      expression: 'env',
      cases: [
        { label: 'alpha', value: 'alpha' },
        { label: 'beta', value: 'beta' },
      ],
    });
    const result = await executeSwitchNode(node, {}, {});
    expect(result.status).toBe('success');
    expect(result.branchTaken).toBe('default');
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue('alpha');
    const node = makeNode('sw3', {
      expression: 'env',
      cases: [{ label: 'alpha', value: 'alpha' }],
    });
    const result = await executeSwitchNode(node, {}, {});
    expect(result.resolvedArgs).toEqual({
      expression: 'env',
      evaluatedValue: 'alpha',
      matchedCase: 'alpha',
    });
  });

  it('', async () => {
    mockSafeVmEval.mockImplementation(() => {
      throw new Error('Switch eval error');
    });
    const node = makeNode('sw4', { expression: 'env', cases: [] });
    const result = await executeSwitchNode(node, {}, {});
    expect(result.status).toBe('error');
    expect(result.error).toBe('Switch eval error');
  });

  it('', async () => {
    mockSafeVmEval.mockReturnValue('alpha');
    const node = makeNode('sw5', { expression: 'env', cases: [], timeoutMs: 3000 });
    await executeSwitchNode(node, {}, {});
    expect(mockSafeVmEval).toHaveBeenCalledWith('env', expect.any(Object), 3000);
  });
});

// --- executeMergeNode ---

describe('executeMergeNode', () => {
  it('', async () => {
    const nodeOutputs = {
      n1: makeNodeOutput('result1'),
      n2: makeNodeOutput({ key: 'value' }),
    };
    const node = makeNode('merge1', { mode: 'waitAll' });
    const result = await executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2']);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({
      mode: 'waitAll',
      results: { n1: 'result1', n2: { key: 'value' } },
      count: 2,
    });
  });

  it('', async () => {
    const nodeOutputs = {
      n1: makeNodeOutput(null),
      n2: makeNodeOutput('winner'),
      n3: makeNodeOutput('loser'),
    };
    const node = makeNode('merge2', { mode: 'firstCompleted' });
    const result = await executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2', 'n3']);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({
      mode: 'firstCompleted',
      results: { n2: 'winner' },
      count: 1,
      selectedNode: 'n2',
    });
  });

  it('', async () => {
    const nodeOutputs = {
      n1: makeNodeOutput(null),
      n2: makeNodeOutput(undefined),
    };
    const node = makeNode('merge3', { mode: 'firstCompleted' });
    const result = await executeMergeNode(node, nodeOutputs, {}, ['n1', 'n2']);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({
      mode: 'firstCompleted',
      results: {},
      count: 0,
    });
  });

  it('', async () => {
    const nodeOutputs = { n1: makeNodeOutput('result') };
    const node = makeNode('merge4', { mode: 'waitAll' });
    const result = await executeMergeNode(node, nodeOutputs, {}, []);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({
      mode: 'waitAll',
      results: {},
      count: 0,
    });
  });

  it('', async () => {
    const nodeOutputs = { n1: makeNodeOutput('x') };
    const node = makeNode('merge5', {});
    const result = await executeMergeNode(node, nodeOutputs, {}, ['n1']);
    expect(result.output).toEqual({
      mode: 'waitAll',
      results: { n1: 'x' },
      count: 1,
    });
  });
});
