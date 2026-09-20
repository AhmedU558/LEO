const fs = require('fs');
const file = 'packages/gateway/src/services/computer/service.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/return 'browser';/g, "return 'browser.navigate';");
code = code.replace(/return \{ result: /g, 'return { data: ');
code = code.replace(/return \{ error: /g, 'return { data: JSON.stringify({ error: ');
fs.writeFileSync(file, code);
