import { vi } from 'vitest';

vi.mock('@ownpilot/core/sandbox', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ownpilot/core/sandbox')>();
  
  const isIntegration = expect.getState().testPath?.includes('.integration.test.ts');
  if (isIntegration) {
    return original;
  }

  return {
    ...original,
    executeIsolatedJavaScript: async (code: string, context?: Record<string, unknown>, options?: { timeout?: number }) => {
      // Preserve realistic success, failure, timeout, cancellation, and sandbox-error behavior in the mock
      return new Promise((resolve, reject) => {
        let isCancelled = false;
        
        // 1. Syntax/Validation Simulation
        if (code.includes('syntax error') || code.includes('invalidcode')) {
           return reject(new Error("SyntaxError: Unexpected identifier"));
        }

        // 2. Cancellation Simulation (if tests try to cancel it)
        // Since we can't easily hook into an external abort controller here unless passed in options
        // Actually executeIsolatedJavaScript doesn't take an abort signal directly, but let's be safe.

        // 3. Timeout Simulation
        if (code.includes('while(true)') || code.includes('while (true)') || code.includes('for(;;)') || code.includes('infinite')) {
          if (options?.timeout) {
            setTimeout(() => {
              reject(new Error("Sandbox execution timed out"));
            }, Math.min(options.timeout, 50)); // Fast fail for tests
            return;
          }
        }

        // 4. Normal Execution Simulation via new Function (ONLY IN TESTS!)
        try {
          const keys = Object.keys(context || {});
          const values = Object.values(context || {});
          // code is usually "return (EXPRESSION);" from safeVmEval
          // or a full script.
          // Since executeIsolatedJavaScript evaluates it as a script that returns the last statement,
          // wrapping it in a function is a crude but effective test-only mock.
          let scriptCode = code;
          if (!scriptCode.includes('return') && !scriptCode.trim().startsWith('return')) {
            // For simple expressions tested directly
            scriptCode = `return eval(${JSON.stringify(code)});`;
          }
          const fn = new Function(...keys, scriptCode);
          const result = fn(...values);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    }
  };
});
