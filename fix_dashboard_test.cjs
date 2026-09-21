const fs = require('fs');
let file = 'packages/gateway/src/services/dashboard/index.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/'dashboard-briefing'/g, "'dashboard-briefing',\n          undefined,\n          'user-1',\n          'default'");
code = code.replace(/'dashboard-briefing-stream'/g, "'dashboard-briefing-stream',\n          undefined,\n          'user-1',\n          'default'");

fs.writeFileSync(file, code, 'utf8');
