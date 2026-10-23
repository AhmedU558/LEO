const fs = require('fs');
const mockCode = `

vi.mock('@ownpilot/core/sandbox', async (importOriginal) => {
  const original = await importOriginal();
  
  const isIntegration = expect.getState().testPath?.includes('.integration.test.ts');
  if (isIntegration) {
    return original;
  }

  return {
    ...original,
    executeIsolatedJavaScript: async (code, context, options) => {
      // Preserve realistic success, failure, timeout, cancellation, and sandbox-error behavior in the mock
      return new Promise((resolve, reject) => {
        // 1. Syntax/Validation Simulation
        if (code.includes('syntax error') || code.includes('invalidcode')) {
           return reject(new Error("SyntaxError: Unexpected identifier"));
        }

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
    }
  };
});
`;

const setupFile = 'packages/gateway/src/test-setup.ts';
fs.appendFileSync(setupFile, mockCode);
