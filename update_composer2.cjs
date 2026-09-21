const fs = require('fs');
let file = 'packages/core/src/agentic/composer.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /this\.recordStepResult\(state, ready\[0\] \|\| steps\[0\], 'failed', null, \{ error: 'Maximum autonomous step limit exceeded' \}\);/m,
  "this.recordStepResult(state, steps[0]!, 'failed', null, { error: 'Maximum autonomous step limit exceeded' });"
);

fs.writeFileSync(file, code, 'utf8');
