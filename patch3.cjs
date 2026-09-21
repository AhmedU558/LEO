const fs = require('fs');
let file = 'packages/gateway/src/routes/local-providers.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/\)\n    invalidateAgentCache\(\);;/g, ");\n    invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

file = 'packages/gateway/src/routes/model-configs/providers.ts';
code = fs.readFileSync(file, 'utf8');
code = code.replace(/\)\n    invalidateAgentCache\(\);;/g, ");\n    invalidateAgentCache();");
code = code.replace(/await providersRepo\.(create|update|delete|toggle|discoverModels)\b([^\)]+)\);/g, "await providersRepo.$1$2);\n    invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

file = 'packages/gateway/src/routes/file-workspaces.ts';
code = fs.readFileSync(file, 'utf8');
code = code.replace(/await fileWorkspacesRepo\.(create|update|delete|setDefault)\b([^\)]+)\);/g, "await fileWorkspacesRepo.$1$2);\n    invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');
