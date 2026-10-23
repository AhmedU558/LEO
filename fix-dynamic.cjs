const fs = require('fs');
const file = 'packages/core/src/agent/tools/dynamic-tool-executor.test.ts';
let code = fs.readFileSync(file, 'utf8');

// The test currently hoisted mocks createSandbox.
// We should replace that with mocking executeIsolatedJavaScript.

code = code.replace(
  'const mockCreateSandbox = vi.hoisted(() => vi.fn(() => ({ execute: mockSandboxExecute })));',
  "const mockExecuteIsolatedJavaScript = vi.hoisted(() => vi.fn(async () => 'mock-result'));\nvi.mock('../../sandbox/docker.js', () => ({ executeIsolatedJavaScript: mockExecuteIsolatedJavaScript }));"
);

// Any test that uses mockCreateSandbox.mock.calls[0]![0].globals -> mockExecuteIsolatedJavaScript.mock.calls[0]![1]
code = code.replace(
  /mockCreateSandbox\.mock\.calls\[0\]!\[0\]\.globals/g,
  'mockExecuteIsolatedJavaScript.mock.calls[0]![1]'
);

code = code.replace(
  /mockCreateSandbox\.mock\.calls\[0\]!\[0\]/g,
  'mockExecuteIsolatedJavaScript.mock.calls[0]![2]'
);

code = code.replace(
  /expect\(mockCreateSandbox\)\.toHaveBeenCalledTimes\(1\);/g,
  'expect(mockExecuteIsolatedJavaScript).toHaveBeenCalledTimes(1);'
);

code = code.replace(
  /expect\(mockSandboxExecute\)\.toHaveBeenCalledTimes\(1\);/g,
  '' // delete
);

// If there are specific limits checked: config.limits.maxExecutionTime -> config.timeout
code = code.replace(/config\.limits\.maxExecutionTime/g, 'config.timeout');

// If permissions are checked: config.permissions.network
// Actually executeIsolatedJavaScript doesn't take these granular permissions in the test mock right now,
// but the tests expect them. Wait, dynamic-tool-executor.ts doesn't pass permissions to docker anymore?
// Let's check what executeIsolatedJavaScript is actually called with in dynamic-tool-executor.ts.
