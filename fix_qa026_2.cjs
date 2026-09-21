const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/qa026.integration.test.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/registerMcpTools: vi.fn\(\) \} as any\);/, 'registerMcpTools: vi.fn(), unregisterMcpTools: vi.fn() } as any);');
fs.writeFileSync(file, code, 'utf8');
