const fs = require('fs');
let code = fs.readFileSync('packages/core/src/test-setup.ts', 'utf8');

// Remove the vi.mock('./sandbox/docker.js', ...) block
const start = code.indexOf("vi.mock('./sandbox/docker.js'");
if (start !== -1) {
  code = code.substring(0, start);
  fs.writeFileSync('packages/core/src/test-setup.ts', code, 'utf8');
}
