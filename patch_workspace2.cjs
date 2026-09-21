const fs = require('fs');
let file = 'packages/gateway/src/routes/file-workspaces.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const workspace = await createSessionWorkspace\(([^)]+)\);/g, "const workspace = await createSessionWorkspace($1);\n  invalidateAgentCache();");
code = code.replace(/await deleteSessionWorkspace\(([^)]+)\);/g, "await deleteSessionWorkspace($1);\n  invalidateAgentCache();");

fs.writeFileSync(file, code, 'utf8');
