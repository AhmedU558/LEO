const fs = require('fs');
let file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const dockerFallbackReason = undefined;\n  \}/m,
  "const dockerFallbackReason = undefined;"
);

fs.writeFileSync(file, code, 'utf8');
