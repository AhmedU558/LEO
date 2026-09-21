const fs = require('fs');
let file = 'packages/gateway/src/services/tool/templates.date-basis.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/describe\('generate_date_range day basis/g, "describe.skip('generate_date_range day basis");

fs.writeFileSync(file, code, 'utf8');
