const fs = require('fs');
let file = 'packages/core/src/agentic/composer.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /while \(completed\.size \+ failed\.size < steps\.length\) \{/m,
  "let _orchestratorLoopCount = 0;\n    const MAX_ORCHESTRATOR_STEPS = 100;\n    while (completed.size + failed.size < steps.length) {\n      if (++_orchestratorLoopCount > MAX_ORCHESTRATOR_STEPS) {\n        state.status = 'failed';\n        this.recordStepResult(state, ready[0] || steps[0], 'failed', null, { error: 'Maximum autonomous step limit exceeded' });\n        break;\n      }"
);

fs.writeFileSync(file, code, 'utf8');
