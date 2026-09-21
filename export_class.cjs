const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/client.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/class McpClientService implements IMcpClientService \{/, 'export class McpClientService implements IMcpClientService {');
fs.writeFileSync(file, code, 'utf8');
