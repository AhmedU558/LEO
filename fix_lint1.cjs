const fs = require('fs');
let file = 'packages/gateway/src/services/job-queue-service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const payloadWithDepth = \{ \.\.\.payload, _depth: currentDepth \+ 1 \};/m,
  "const payloadWithDepth = { ...payload, _depth: currentDepth + 1 } as Record<string, unknown>;"
);
code = code.replace(
  /depth: \(job\.payload as any\)\?\._depth \?\? 0/m,
  "depth: typeof job.payload === 'object' && job.payload !== null && '_depth' in job.payload ? (job.payload as { _depth: number })._depth : 0"
);

fs.writeFileSync(file, code, 'utf8');
