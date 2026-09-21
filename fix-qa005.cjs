const fs = require('fs');
let f1 = fs.readFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', 'utf8');
f1 = f1.replace(/content: 'Secret Memory', source: 'test' \}/g, "content: 'Secret Memory', source: 'test', type: 'user' }");
f1 = f1.replace(/updateExecutionStatus/g, "updateExecution");
fs.writeFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', f1);
