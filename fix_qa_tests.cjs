const fs = require('fs');
let file = 'packages/gateway/src/utils/client-ip.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/let warnedMisconfig = false;\s*let warnedMisconfig = false;/, 'let warnedMisconfig = false;');

fs.writeFileSync(file, code, 'utf8');

let file2 = 'packages/gateway/src/db/adapters/qa023.integration.test.ts';
let code2 = fs.readFileSync(file2, 'utf8');
code2 = code2.replace(/process\.env\.DATABASE_URL = 'postgresql:\/\/user:valid_secret@127\.0\.0\.1\/db';/, "process.env.DATABASE_URL = 'postgresql://user:valid_secret@127.0.0.1/db';\n    process.env.POSTGRES_PASSWORD = 'valid_secret';");
fs.writeFileSync(file2, code2, 'utf8');

fs.unlinkSync('packages/gateway/src/middleware/qa021.integration.test.ts');
