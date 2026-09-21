const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/client.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/await executor\(\{([^}]*)\}\)/g, "await executor({$1}, { userId: 'default', callId: '1', conversationId: '1' })");

fs.writeFileSync(file, code, 'utf8');
