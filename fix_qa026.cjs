const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/qa026.integration.test.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/registerMcpTools: vi\.fn\(\),/, 'registerMcpTools: vi.fn(),\n    unregisterMcpTools: vi.fn(),');
fs.writeFileSync(file, code, 'utf8');
