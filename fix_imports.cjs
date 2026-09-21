const fs = require('fs');

let f1 = 'packages/gateway/src/db/repositories/qa016.integration.test.ts';
let c1 = fs.readFileSync(f1, 'utf8');
c1 = c1.replace(/from '.\/index.js';/g, "from './idempotency-keys.js';");
fs.writeFileSync(f1, c1);

let f2 = 'packages/gateway/src/db/repositories/qa017.integration.test.ts';
let c2 = fs.readFileSync(f2, 'utf8');
c2 = c2.replace(/from '.\/index.js';/g, "from './jobs.js';");
fs.writeFileSync(f2, c2);

let f3 = 'packages/gateway/src/db/repositories/qa018.integration.test.ts';
let c3 = fs.readFileSync(f3, 'utf8');
c3 = c3.replace(/from '.\/index.js';/g, "from './jobs.js';");
fs.writeFileSync(f3, c3);

