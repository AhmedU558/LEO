const fs = require('fs');
let file = 'packages/core/src/agentic/composer.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const entry = ActionLedger\.getByActionId\(ledgerEntry\.actionId\);/g, "const entry = await ActionLedger.getByActionId(ledgerEntry.actionId);");
fs.writeFileSync(file, code, 'utf8');
