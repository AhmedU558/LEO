/**
 * Global Test Setup — runs before every test file in gateway.
 *
 * Provides the most commonly duplicated mock (getLog) so individual
 * test files no longer need to repeat it.
 *
 * IMPORTANT: Tests that need to ASSERT on log method calls (e.g.,
 * `expect(mockLog.error).toHaveBeenCalledWith(...)`) should declare
 * their own `vi.mock` for the log module — the local mock will
 * override this global one for that file.
 */

import { vi, expect } from 'vitest';

vi.mock('./services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Production safeFetch uses undici.fetch so its pinned Agent and fetch share
// the same dispatcher ABI. Route/tool tests historically stub global fetch;
// bridge undici.fetch to that stub while retaining the real Agent class.
vi.mock('undici', async (importOriginal) => {
  const original = await importOriginal<typeof import('undici')>();
  return {
    ...original,
    fetch: (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
  };
});

// Pin the at-rest encryption key so any test that touches encrypted columns
// stays hermetic — without this, the first encrypt would auto-generate a
// real key file under the user's data directory.
// (data-encryption.test.ts manages this env var itself for key-resolution tests.)
process.env.OWNPILOT_ENCRYPTION_KEY ??= 'gateway-test-suite-encryption-key';

vi.mock('@ownpilot/core/sandbox', async (importOriginal) => {
  const original = await importOriginal();

  const isIntegration = expect.getState().testPath?.includes('.integration.test.ts');
  if (isIntegration) {
    return original;
  }

  return {
    ...((original || {}) as any),
    executeIsolatedJavaScript: async (code: any, context: any, options: any) => {
      // Preserve realistic success, failure, timeout, cancellation, and sandbox-error behavior in the mock
      return new Promise((resolve, reject) => {
        // 1. Syntax/Validation Simulation
        if (code.includes('syntax error') || code.includes('invalidcode')) {
          return reject(new Error('SyntaxError: Unexpected identifier'));
        }

        // 3. Timeout Simulation
        if (
          code.includes('while(true)') ||
          code.includes('while (true)') ||
          code.includes('for(;;)') ||
          code.includes('infinite')
        ) {
          if (options?.timeout) {
            setTimeout(
              () => {
                reject(new Error('Sandbox execution timed out'));
              },
              Math.min(options.timeout, 50)
            ); // Fast fail for tests
            return;
          }
        }

        // 4. Normal Execution Simulation via new Function (ONLY IN TESTS!)
        try {
          const keys = Object.keys(context || {});
          const values = Object.values(context || {});
          let scriptCode = code;
          if (!scriptCode.includes('return') && !scriptCode.trim().startsWith('return')) {
            scriptCode = 'return eval(' + JSON.stringify(code) + ');';
          }
          const fn = new Function(...keys, scriptCode);
          const result = fn(...values);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    },
  };
});

vi.mock('./routes/helpers.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...((actual || {}) as any),
    getUserId: (c: any) => {
      try {
        return c.get('userId') || 'default';
      } catch {
        return 'default';
      }
    },
    getWorkspaceId: (c: any) => {
      try {
        return c.req.header('X-Workspace-ID') || 'default';
      } catch {
        return 'default';
      }
    },
  };
});
