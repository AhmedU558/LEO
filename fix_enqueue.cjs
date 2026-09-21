const fs = require('fs');
let file = 'packages/gateway/src/services/job-queue-service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const payloadWithDepth = \{ \.\.\.payload: payloadWithDepth, _depth: currentDepth \+ 1 \};\n    const jobInput: CreateJobInput = \{\n      id: jobId,\n      name,\n      queue: options\.queue \?\? DEFAULT_QUEUE,\n      priority: options\.priority \?\? 0,\n      payload,\n/m,
  "const payloadWithDepth = { ...payload, _depth: currentDepth + 1 };\n    const jobInput: CreateJobInput = {\n      id: jobId,\n      name,\n      queue: options.queue ?? DEFAULT_QUEUE,\n      priority: options.priority ?? 0,\n      payload: payloadWithDepth,\n"
);

fs.writeFileSync(file, code, 'utf8');
