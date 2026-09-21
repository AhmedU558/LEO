const fs = require('fs');
let f = 'packages/gateway/src/db/repositories/qa017.integration.test.ts';
let c = fs.readFileSync(f, 'utf8');
c = c.replace(/await repo\.get\(/g, "await repo.getById(");
fs.writeFileSync(f, c);
