const fs = require('fs');

let f1 = fs.readFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', 'utf8');
f1 = f1.replace(/content: 'B content' \}/g, "content: 'B content', type: 'user' }");
f1 = f1.replace(/updateExecutionResult/g, 'updateExecutionStatus');
fs.writeFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', f1);

let f2 = fs.readFileSync('packages/gateway/src/db/repositories/workspaces.test.ts', 'utf8');
f2 = f2.replace(/toEqual\(\['ws-1'\]\)/g, "toEqual(['ws-1', 'user-1'])");
fs.writeFileSync('packages/gateway/src/db/repositories/workspaces.test.ts', f2);
