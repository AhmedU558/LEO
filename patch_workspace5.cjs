const fs = require('fs');
let file = 'packages/gateway/src/routes/file-workspaces.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const workspace = createSessionWorkspace\(\{([\s\S]+?)\}\);/g, "const workspace = createSessionWorkspace({$1});\n    invalidateAgentCache();");

fs.writeFileSync(file, code, 'utf8');
