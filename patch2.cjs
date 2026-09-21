const fs = require('fs');
let file = 'packages/gateway/src/routes/execution-permissions.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/await executionPermissionsRepo\.set\(([^)]+)\);/g, "await executionPermissionsRepo.set($1);\n  invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

file = 'packages/gateway/src/routes/file-workspaces.ts';
code = fs.readFileSync(file, 'utf8');
code = code.replace(/await fileWorkspacesRepo\.(create|update|delete|setDefault)\b([^\)]+)\);/g, "await fileWorkspacesRepo.$1$2);\n  invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

file = 'packages/gateway/src/routes/local-providers.ts';
code = fs.readFileSync(file, 'utf8');
code = code.replace(/await localProvidersRepo\.(createProvider|updateProvider|deleteProvider|setProviderStatus|setDefault|setModelStatus)\b([^\)]+)\);/g, "await localProvidersRepo.$1$2);\n  invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

file = 'packages/gateway/src/routes/model-configs/providers.ts';
code = fs.readFileSync(file, 'utf8');
code = code.replace(/await providersRepo\.(create|update|delete|toggle|discoverModels)\b([^\)]+)\);/g, "await providersRepo.$1$2);\n  invalidateAgentCache();");
fs.writeFileSync(file, code, 'utf8');

