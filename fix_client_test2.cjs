const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/client.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/getByName: vi.fn\(\),/g, "getByName: vi.fn().mockResolvedValue({ enabled: true, user_id: 'default' }),");

fs.writeFileSync(file, code, 'utf8');
