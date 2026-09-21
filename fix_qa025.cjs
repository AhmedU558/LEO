const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/qa025.integration.test.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/afterEach\(\(\) => \{/, `afterEach(() => {\n    vi.mocked(getSharedToolRegistry).mockReturnValue({ registerMcpTools: vi.fn() } as any);`);

code = code.replace(/beforeEach\(\(\) => \{/, `beforeEach(() => {\n    vi.mocked(getSharedToolRegistry).mockReturnValue({ registerMcpTools: vi.fn() } as any);`);

fs.writeFileSync(file, code, 'utf8');
