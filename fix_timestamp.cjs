const fs = require('fs');
let file = 'packages/gateway/src/db/repositories/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const actionId = generateId\('act'\);\s*const timestamp = new Date\(\);\s*\/\//, "const actionId = generateId('act');\n\n    //");

code = code.replace(/const tailRow = await this\.queryOne<\{ last_hash: string \}>\(\s*'SELECT last_hash FROM action_ledger_tail WHERE id = 1 FOR UPDATE'\s*\);\s*/, "const tailRow = await this.queryOne<{ last_hash: string }>('SELECT last_hash FROM action_ledger_tail WHERE id = 1 FOR UPDATE');\n      const timestamp = new Date();\n      ");

fs.writeFileSync(file, code, 'utf8');
