import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { executeSchemaValidatorNode, executeDataStoreNode, clearDataStore } from './data.js';

// --- Mocks ---

const mockResolveTemplates = vi.hoisted(() => {
  return (obj: Record<string, unknown>) => obj;
});

vi.mock('../template-resolver.js', () => ({
  resolveTemplates: mockResolveTemplates,
}));

beforeEach(() => {
  clearDataStore();
  vi.clearAllMocks();
});

// --- Helpers ---

function makeNode(id: string, data: unknown): WorkflowNode {
  return { id, name: id, type: 'test', data: data as never, nextNodes: [] };
}

// --- executeSchemaValidatorNode ---

describe('executeSchemaValidatorNode', () => {
  it('', async () => {
    const node = makeNode('v1', {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
        required: ['name'],
      },
    });
    const nodeOutputs = { src: { output: { name: 'Alice', age: 30 } } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ valid: true, errors: [] });
  });

  it('', async () => {
    const node = makeNode('v2', {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name', 'email'],
      },
    });
    const nodeOutputs = { src: { output: { name: 'Alice' } } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.output).toEqual({
      valid: false,
      errors: ['Missing required field: "email"'],
    });
  });

  it('', async () => {
    const node = makeNode('v3', {
      schema: {
        type: 'object',
        properties: { age: { type: 'number' } },
      },
    });
    const nodeOutputs = { src: { output: { age: 'thirty' } } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.output).toEqual({
      valid: false,
      errors: ['Field "age" expected type "number", got "string"'],
    });
  });

  it('', async () => {
    // JS quirk: typeof null === 'object'. The schema validator checks
    // typeof inputData === 'object' && inputData !== null separately, so null
    // falls through to the else-if which compares typeof null to the schema type.
    const node = makeNode('v4', {
      schema: { type: 'object' },
    });
    const nodeOutputs = { src: { output: null } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.output).toEqual({ valid: true, errors: [] });
  });

  it('', async () => {
    const node = makeNode('v5', {
      schema: { type: 'string' },
    });
    const nodeOutputs = { src: { output: 'hello' } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.output).toEqual({ valid: true, errors: [] });
  });

  it('', async () => {
    const node = makeNode('v6', {
      schema: {
        type: 'object',
        properties: { name: { type: 'string' }, count: { type: 'number' } },
        required: ['name', 'count'],
      },
    });
    const nodeOutputs = {
      src: { output: { count: 'five' } } as unknown as NodeResult,
    };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.output).toEqual({
      valid: false,
      errors: expect.arrayContaining([
        'Missing required field: "name"',
        'Field "count" expected type "number", got "string"',
      ]),
    });
  });

  it('', async () => {
    const node = makeNode('v7', {
      schema: { type: 'number' },
      strict: true,
    });
    const nodeOutputs = { src: { output: 'not-a-number' } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.status).toBe('error');
    expect(result.error).toContain('Validation failed');
  });

  it('', async () => {
    const node = makeNode('v8', {
      schema: { type: 'string' },
      strict: true,
    });
    const nodeOutputs = { src: { output: 'ok' } as unknown as NodeResult };
    const result = await executeSchemaValidatorNode(node, nodeOutputs, {});
    expect(result.status).toBe('success');
  });
});

// --- executeDataStoreNode ---

describe('executeDataStoreNode', () => {
  it('', async () => {
    const setNode = makeNode('set1', {
      operation: 'set',
      key: 'k1',
      value: 'secret',
      namespace: 'ns1',
    });
    const getNode = makeNode('get1', { operation: 'get', key: 'k1', namespace: 'ns1' });
    const setResult = executeDataStoreNode(setNode, {}, {});
    expect(setResult.status).toBe('success');
    expect((setResult.output as { previousValue: unknown }).previousValue).toBeNull();

    const getResult = executeDataStoreNode(getNode, {}, {});
    expect(getResult.status).toBe('success');
    expect(getResult.output).toBe('secret');
  });

  it('', async () => {
    const set1 = makeNode('s1', { operation: 'set', key: 'counter', value: 10 });
    const set2 = makeNode('s2', { operation: 'set', key: 'counter', value: 20 });
    executeDataStoreNode(set1, {}, {});
    const result = await executeDataStoreNode(set2, {}, {});
    expect((result.output as { previousValue: number }).previousValue).toBe(10);
  });

  it('', async () => {
    const setNode = makeNode('set2', { operation: 'set', key: 'delkey', value: 1 });
    const delNode = makeNode('del1', { operation: 'delete', key: 'delkey' });
    executeDataStoreNode(setNode, {}, {});
    const result = await executeDataStoreNode(delNode, {}, {});
    expect((result.output as { existed: boolean }).existed).toBe(true);
  });

  it('', async () => {
    const delNode = makeNode('del2', { operation: 'delete', key: 'notexist' });
    const result = await executeDataStoreNode(delNode, {}, {});
    expect((result.output as { existed: boolean }).existed).toBe(false);
  });

  it('', async () => {
    const set1 = makeNode('l1', { operation: 'set', key: 'a', value: 1, namespace: 'listns' });
    const set2 = makeNode('l2', { operation: 'set', key: 'b', value: 2, namespace: 'listns' });
    executeDataStoreNode(set1, {}, {});
    executeDataStoreNode(set2, {}, {});
    const listNode = makeNode('list1', { operation: 'list', namespace: 'listns' });
    const result = await executeDataStoreNode(listNode, {}, {});
    expect(Array.isArray(result.output)).toBe(true);
    expect((result.output as string[]).sort()).toEqual(['a', 'b']);
  });

  it('', async () => {
    const setNode = makeNode('h1', { operation: 'set', key: 'exists', value: true });
    const hasNode = makeNode('has1', { operation: 'has', key: 'exists' });
    executeDataStoreNode(setNode, {}, {});
    const result = await executeDataStoreNode(hasNode, {}, {});
    expect(result.output).toBe(true);
  });

  it('', async () => {
    const hasNode = makeNode('has2', { operation: 'has', key: 'notthere' });
    const result = await executeDataStoreNode(hasNode, {}, {});
    expect(result.output).toBe(false);
  });

  it('', async () => {
    const getNode = makeNode('get2', { operation: 'get', key: 'missing' });
    const result = await executeDataStoreNode(getNode, {}, {});
    expect(result.status).toBe('success');
    expect(result.output).toBeNull();
  });

  it('', async () => {
    const setNode = makeNode('d1', { operation: 'set', key: 'dk', value: 'default-val' });
    const getNode = makeNode('d2', { operation: 'get', key: 'dk' });
    executeDataStoreNode(setNode, {}, {});
    const result = await executeDataStoreNode(getNode, {}, {});
    expect(result.output).toBe('default-val');
  });

  it('', async () => {
    const setA = makeNode('na1', { operation: 'set', key: 'k', value: 'ns-a', namespace: 'nsA' });
    const setB = makeNode('nb1', { operation: 'set', key: 'k', value: 'ns-b', namespace: 'nsB' });
    const getA = makeNode('ngA', { operation: 'get', key: 'k', namespace: 'nsA' });
    const getB = makeNode('ngB', { operation: 'get', key: 'k', namespace: 'nsB' });
    executeDataStoreNode(setA, {}, {});
    executeDataStoreNode(setB, {}, {});
    expect(executeDataStoreNode(getA, {}, {}).output).toBe('ns-a');
    expect(executeDataStoreNode(getB, {}, {}).output).toBe('ns-b');
  });

  it('', async () => {
    const set1 = makeNode('c1', { operation: 'set', key: 'x', value: 1 });
    executeDataStoreNode(set1, {}, {});
    clearDataStore();
    const listNode = makeNode('c2', { operation: 'list' });
    const result = await executeDataStoreNode(listNode, {}, {});
    expect(result.output).toEqual([]);
  });

  it('', async () => {
    const set1 = makeNode('cs1', { operation: 'set', key: 'x', value: 1, namespace: 'target' });
    const set2 = makeNode('cs2', { operation: 'set', key: 'x', value: 2, namespace: 'other' });
    executeDataStoreNode(set1, {}, {});
    executeDataStoreNode(set2, {}, {});
    clearDataStore('target');
    const listTarget = makeNode('clt', { operation: 'list', namespace: 'target' });
    const listOther = makeNode('clo', { operation: 'list', namespace: 'other' });
    expect(executeDataStoreNode(listTarget, {}, {}).output).toEqual([]);
    expect(executeDataStoreNode(listOther, {}, {}).output).toEqual(['x']);
  });
});
