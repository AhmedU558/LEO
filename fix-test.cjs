const fs = require('fs');
const file = 'packages/gateway/src/services/workflow/workflow-service.test.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  "await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e), { depth: 10 });",
  "await service.executeWorkflow('wf-1', 'user1', (e) => progressEvents.push(e), { depth: 9 });"
);
fs.writeFileSync(file, code, 'utf8');
