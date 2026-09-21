const fs = require('fs');
const file = 'packages/core/src/agent/tools/dynamic-tool-executor.ts';
let code = fs.readFileSync(file, 'utf8');

// Strip out inWorker and inVm execution logic
code = code.replace(/if \(process\.env\.OWNPILOT_TOOL_SANDBOX === 'worker'\) \{[\s\S]*?\}/m, '');
code = code.replace(/if \(process\.env\.OWNPILOT_TOOL_SANDBOX === 'vm'\) \{[\s\S]*?\}/m, '');
code = code.replace(/async function executeDynamicToolInVm[\s\S]*?^}/m, '');
code = code.replace(/async function executeDynamicToolInWorker[\s\S]*?^}/m, '');

// Strip imports that are no longer used
code = code.replace(/import \{ createSandbox \} from '\.\.\/\.\.\/sandbox\/executor\.js';\n/, '');
code = code.replace(/import \{ runInWorkerSandbox, type HostHandlers \} from '\.\.\/\.\.\/sandbox\/worker-sandbox\.js';\n/, '');
code = code.replace(/import \{ createScopedFs, createScopedExec \} from '\.\.\/\.\.\/sandbox\/scoped-apis\.js';\n/, '');
code = code.replace(/import \{ createSafeFetch, mapPermissions, createSandboxUtils \} from '\.\.\/dynamic-tool-sandbox\.js';\n/, '');

fs.writeFileSync(file, code, 'utf8');
