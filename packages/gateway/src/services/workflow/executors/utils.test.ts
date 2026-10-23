/**
 * safeVmEval — security + functionality regression tests.
 *
 * Covers RCE-001/RCE-003: the expression evaluator must not let user-supplied
 * expressions escape the VM via the host Function constructor reached through an
 * injected (host-realm) context value's prototype chain.
 */

import { describe, it, expect } from 'vitest';
import { safeVmEval } from './utils.js';

describe('safeVmEval — sandbox escape resistance', () => {
  it('blocks constructor-walk escape via an injected context object (split-string)', async () => {
    // `data` is an attacker-influenced upstream node output. Before the fix this
    // reached the host `process` (host-realm object — host Function).
    const expr = `data['constructo'+'r']['constructo'+'r']('return process')()`;
    await expect(safeVmEval(expr, { data: { x: 1 } }, 2000)).rejects.toThrow();
  });

  it('blocks direct constructor-walk escape', async () => {
    const expr = `data.constructor.constructor('return process')()`;
    await expect(safeVmEval(expr, { data: { x: 1 } }, 2000)).rejects.toThrow();
  });

  it('does not expose host process even if the escape were to run', async () => {
    // Sanity: the bound `data` must be a plain context-realm object, so reaching
    // a Function constructor that actually compiles code is impossible.
    let leaked: unknown;
    try {
      leaked = await safeVmEval(
        `(() => { try { return data['constructo'+'r']['constructo'+'r']('return process')().pid; } catch (e) { return 'blocked'; } })()`,
        { data: {} },
        2000
      );
    } catch {
      leaked = 'threw';
    }
    expect(leaked === 'blocked' || leaked === 'threw').toBe(true);
  });
});

describe('safeVmEval — functionality preserved', () => {
  it('evaluates a simple arithmetic expression', async () => {
    expect(await safeVmEval('data.x + 1', { data: { x: 5 } }, 2000)).toBe(6);
  });

  it('reads workflow variables', async () => {
    expect(await safeVmEval('variables.y * 10', { variables: { y: 4 } }, 2000)).toBe(40);
  });

  it('returns object literals', async () => {
    expect(
      await safeVmEval(
        '({ sum: data.x + variables.y })',
        { data: { x: 1 }, variables: { y: 2 } },
        2000
      )
    ).toEqual({ sum: 3 });
  });

  it('rejects expressions over the length limit', async () => {
    await expect(safeVmEval('1'.repeat(10_001), {}, 2000)).rejects.toThrow(/maximum length/);
  });
});
