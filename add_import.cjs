const fs = require('fs');
const file = 'packages/gateway/src/tools/registry/core-registration.ts';
let code = fs.readFileSync(file, 'utf8');
code = `import { checkToolPermission } from '../../services/tool/permission.js';\n` + code;
fs.writeFileSync(file, code, 'utf8');
