const fs = require('fs');
const file = 'packages/core/src/agent/tools/dynamic-tools.test.ts';
let code = fs.readFileSync(file, 'utf8');

// Insert process.env.OWNPILOT_TOOL_SANDBOX = 'vm'; before the imports or tests
code = code.replace(
  "import { describe, it, expect, vi, beforeEach } from 'vitest';",
  "import { describe, it, expect, vi, beforeEach } from 'vitest';\nprocess.env.OWNPILOT_TOOL_SANDBOX = 'vm';"
);

fs.writeFileSync(file, code, 'utf8');
