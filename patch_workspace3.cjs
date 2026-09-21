const fs = require('fs');
let file = 'packages/gateway/src/routes/file-workspaces.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/const workspace = createSessionWorkspace\(\{/g, "const workspace = createSessionWorkspace({\n  invalidateAgentCache();");
code = code.replace(/deleteSessionWorkspace\(workspaceId\);/g, "deleteSessionWorkspace(workspaceId);\n  invalidateAgentCache();");

fs.writeFileSync(file, code, 'utf8');
