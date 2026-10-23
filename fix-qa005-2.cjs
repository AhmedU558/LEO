const fs = require('fs');
let f1 = fs.readFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', 'utf8');
f1 = f1.replace(/type: 'user'/g, "type: 'fact'");
fs.writeFileSync('packages/gateway/src/db/repositories/qa005.integration.test.ts', f1);
