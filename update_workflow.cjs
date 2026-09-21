const fs = require('fs');
let file = 'packages/gateway/src/services/workflow/workflow-service.ts';
let code = fs.readFileSync(file, 'utf8');

const MAX_WORKFLOW_DEPTH = 10;
const MAX_NODES_PER_WORKFLOW = 1000;

code = code.replace(
  /const depth = options\?\.depth \?\? 0;/m,
  "const depth = options?.depth ?? 0;\n    if (depth >= 10) throw new Error('Maximum workflow recursion depth exceeded');"
);

code = code.replace(
  /if \(workflow\.nodes\.length === 0\) throw new Error\('Workflow has no nodes'\);/m,
  "if (workflow.nodes.length === 0) throw new Error('Workflow has no nodes');\n    if (workflow.nodes.length > 1000) throw new Error('Maximum workflow node limit exceeded');"
);

fs.writeFileSync(file, code, 'utf8');
