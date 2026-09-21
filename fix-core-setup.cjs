const fs = require('fs');
let setupCode = fs.readFileSync('packages/core/src/test-setup.ts', 'utf8');

setupCode = setupCode.replace(
  "const isIntegration = expect.getState().testPath?.includes('.integration.test.ts');\n  if (isIntegration) {",
  "const testPath = expect.getState().testPath;\n  if (testPath?.includes('.integration.test.ts') || testPath?.includes('docker.test.ts') || testPath?.includes('priority4-unavailable.test.ts') || testPath?.includes('docker-security.test.ts')) {"
);

fs.writeFileSync('packages/core/src/test-setup.ts', setupCode, 'utf8');
