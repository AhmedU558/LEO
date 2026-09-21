/**
 * ActionLedger — chain integrity regression tests (QA-011).
 *
 * The ledger hash used to be a base64 *encoding* of a string that embedded the
 * previous hash, so every entry was ~4/3 longer than the last. A few dozen
 * records pushed it past V8's maximum string length and record() started
 * throwing — which, because dispatch records before it executes, silently
 * stopped workflow nodes from running at all.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ActionLedger } from './action-ledger.js';

function record(action: string) {
  return ActionLedger.record({
    userId: 'user-1',
    workspaceId: 'ws-1',
    tool: 'test_tool',
    action,
    resource: 'res',
    resourceType: 'test',
    capability: 'task.execute',
    policyDecision: 'ALLOW',
    riskLevel: 'LOW',
    executionEnvironment: 'test',
    durationMs: 0,
  });
}

describe('ActionLedger', () => {
  beforeEach(() => {
    ActionLedger.clear();
  });

  it('keeps the hash a fixed width as the chain grows', async () => {
    const first = await record('a');
    const widths = new Set<number>([first.hash.length]);

    for (let i = 0; i < 500; i++) {
      widths.add((await record(`a${i}`)).hash.length);
    }

    // A single width across 501 entries. Under the base64 bug this set held
    // 501 distinct, exponentially increasing values.
    expect(widths.size).toBe(1);
    expect(first.hash).toHaveLength(64);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records thousands of entries without throwing', async () => {
    // The old implementation threw "Cannot create a string longer than
    // 0x1fffffe8 characters" well before this point.
    for (let i = 0; i < 2000; i++) {
      await record(`bulk-${i}`);
    }
    expect(await ActionLedger.getEntries()).toHaveLength(2000);
  });

  it('chains each entry to its predecessor', async () => {
    const first = await record('first');
    const second = await record('second');
    const third = await record('third');

    expect(first.previousHash).toBe('genesis');
    expect(second.previousHash).toBe(first.hash);
    expect(third.previousHash).toBe(second.hash);
  });

  it('does not emit a reversible encoding of its input', async () => {
    const entry = await record('sensitive-action');
    // base64 of the hash data would decode back to a string containing the
    // userId and action. A digest must not.
    const decoded = Buffer.from(entry.hash, 'base64').toString('utf8');
    expect(decoded).not.toContain('sensitive-action');
    expect(decoded).not.toContain('user-1');
  });

  it('clear() resets the chain back to genesis', async () => {
    await record('a');
    ActionLedger.clear();
    const afterClear = await record('b');

    expect(afterClear.previousHash).toBe('genesis');
    expect(await ActionLedger.getEntries()).toHaveLength(1);
  });
});
