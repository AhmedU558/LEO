const fs = require('fs');

const routes = [
  'packages/gateway/src/routes/settings.ts',
  'packages/gateway/src/routes/file-workspaces.ts',
  'packages/gateway/src/routes/local-providers.ts',
  'packages/gateway/src/routes/model-configs/providers.ts',
  'packages/gateway/src/routes/execution-permissions.ts'
];

for (const file of routes) {
  if (!fs.existsSync(file)) continue;
  let code = fs.readFileSync(file, 'utf8');

  // Skip if already imported
  if (!code.includes('invalidateAgentCache')) {
    // We need to figure out the relative path to agents/index.js
    let importPath = '';
    if (file.includes('model-configs')) {
      importPath = '../../agents/index.js';
    } else {
      importPath = '../agents/index.js';
    }
    code = `import { invalidateAgentCache } from '${importPath}';\n` + code;
    
    // Naively inject it before returns in POST/PATCH/DELETE routes
    // For safety and simplicity, let's just do it at the start of any 'return apiResponse' or 'return c.json' inside these files 
    // EXCEPT GET requests. But we can't easily parse that with regex.
    // Let's use a simpler approach: Just search for methods that save to repo and insert invalidateAgentCache() after.

    // execution-permissions
    if (file.includes('execution-permissions')) {
      code = code.replace(/await executionPermissionsRepo.set\(body\);/g, "await executionPermissionsRepo.set(body);\n    invalidateAgentCache();");
    }

    // settings
    if (file.includes('settings.ts')) {
      code = code.replace(/await settingsRepo\.set\(([^,]+),\s*([^)]+)\);/g, "await settingsRepo.set($1, $2);\n    invalidateAgentCache();");
      code = code.replace(/await settingsRepo\.delete\(([^)]+)\);/g, "await settingsRepo.delete($1);\n    invalidateAgentCache();");
    }

    // file-workspaces
    if (file.includes('file-workspaces')) {
      code = code.replace(/await fileWorkspacesRepo\.(create|update|delete|setDefault)\b([^\)]+)\)/g, "await fileWorkspacesRepo.$1$2)\n    invalidateAgentCache();");
    }

    // local-providers
    if (file.includes('local-providers')) {
      code = code.replace(/await localProvidersRepo\.(createProvider|updateProvider|deleteProvider|setProviderStatus|setDefault|setModelStatus)\b([^\)]+)\)/g, "await localProvidersRepo.$1$2)\n    invalidateAgentCache();");
    }

    // providers (model configs)
    if (file.includes('providers.ts') && !file.includes('local')) {
      code = code.replace(/await providersRepo\.(create|update|delete|toggle|discoverModels)\b([^\)]+)\)/g, "await providersRepo.$1$2)\n    invalidateAgentCache();");
    }

    fs.writeFileSync(file, code, 'utf8');
  }
}
console.log("Patched");
