const fs = require('fs');
let content = fs.readFileSync('packages/gateway/src/services/mcp/qa026.integration.test.ts', 'utf8');

content = content.replace(
  `let mockClientInstance: any;`,
  `let mockClientInstance: any;
export const connectMock = vi.fn().mockResolvedValue(undefined);`
);

content = content.replace(
  `connect = vi.fn().mockResolvedValue(undefined);`,
  `connect = connectMock;`
);

content = content.replace(
  /mockClientInstance\.connect\.mockRejectedValueOnce/g,
  `connectMock.mockRejectedValueOnce`
);

fs.writeFileSync('packages/gateway/src/services/mcp/qa026.integration.test.ts', content);
