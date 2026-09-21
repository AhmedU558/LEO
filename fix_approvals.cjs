const fs = require('fs');
let file = 'packages/gateway/src/db/repositories/workflows/approvals.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/expect\(params\[5\]\)\.toBe\('pending'\); \/\/ status default/g, "expect(params[8]).toBe('pending'); // status default");
code = code.replace(/expect\(params\[6\]\)\.toBe\('\{"key":"value"\}'\); \/\/ context JSON/g, "expect(params[9]).toBe('{\"key\":\"value\"}'); // context JSON");
code = code.replace(/expect\(params\[7\]\)\.toBe\('Please approve'\); \/\/ message/g, "expect(params[10]).toBe('Please approve'); // message");
code = code.replace(/expect\(params\[8\]\)\.toBeNull\(\); \/\/ expires_at/g, "expect(params[11]).toBeNull(); // expires_at");
code = code.replace(/expect\(typeof params\[9\]\)\.toBe\('string'\); \/\/ created_at ISO/g, "expect(typeof params[12]).toBe('string'); // created_at ISO");

code = code.replace(/expect\(params\[6\]\)\.toBe\('\{\}'\); \/\/ context defaults to \{\}/g, "expect(params[9]).toBe('{}'); // context defaults to {}");
code = code.replace(/expect\(params\[7\]\)\.toBeNull\(\); \/\/ message defaults to null/g, "expect(params[10]).toBeNull(); // message defaults to null");
code = code.replace(/expect\(params\[8\]\)\.toBeNull\(\); \/\/ expires_at defaults to null/g, "expect(params[11]).toBeNull(); // expires_at defaults to null");
code = code.replace(/expect\(params\[8\]\)\.toBe\(expiresAt\.toISOString\(\)\);/g, "expect(params[11]).toBe(expiresAt.toISOString());");

fs.writeFileSync(file, code, 'utf8');
