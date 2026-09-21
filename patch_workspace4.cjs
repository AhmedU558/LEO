const fs = require('fs');
let file = 'packages/gateway/src/routes/file-workspaces.ts';
let code = fs.readFileSync(file, 'utf8');

code = `import { invalidateAgentCache } from '../agents/index.js';\n` + code;

code = code.replace(/const workspace = createSessionWorkspace\(\{\n\s*name: body\.name,\n\s*userId,\n\s*agentId: body\.agentId,\n\s*maxAgeDays: body\.maxAgeDays,\n\s*\}\);/g, "const workspace = createSessionWorkspace({\n        name: body.name,\n        userId,\n        agentId: body.agentId,\n        maxAgeDays: body.maxAgeDays,\n      });\n      invalidateAgentCache();");

code = code.replace(/deleteSessionWorkspace\(workspaceId\);/g, "deleteSessionWorkspace(workspaceId);\n    invalidateAgentCache();");

code = code.replace(/const workspace = getOrCreateSessionWorkspace\(sessionId, body\.agentId, userId\);/g, "const workspace = getOrCreateSessionWorkspace(sessionId, body.agentId, userId);\n    invalidateAgentCache();");

fs.writeFileSync(file, code, 'utf8');
