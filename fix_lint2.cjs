const fs = require('fs');

// Fix 2: lifecycle-executors.ts unused variables
let file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const sandboxPref/g, 'const _sandboxPref');
code = code.replace(/const localInterpreters/g, 'const _localInterpreters');
code = code.replace(/const toolArgs/g, 'const _toolArgs');

fs.writeFileSync(file, code, 'utf8');

// Fix 3: qa027.integration.test.ts unused variables
file = 'packages/gateway/src/utils/qa027.integration.test.ts';
code = fs.readFileSync(file, 'utf8');

code = code.replace(/const orchestrator/g, 'const _orchestrator');
code = code.replace(/const steps/g, 'const _steps');

fs.writeFileSync(file, code, 'utf8');
