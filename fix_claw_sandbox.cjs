const fs = require('fs');
const file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

// I will just replace the executeRunScript to not use execFileAsync directly, but use executeShellSandbox, executeJavaScriptSandbox, executePythonSandbox.
// Or wait, they are exported from '@ownpilot/core/sandbox'
