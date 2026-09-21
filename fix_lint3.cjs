const fs = require('fs');
let file = 'packages/gateway/src/services/job-queue-service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /catch \(error: any\) \{/m,
  "catch (error: unknown) {"
);
code = code.replace(
  /if \(error\.code === '23505' && options\.id\) \{/m,
  "if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505' && options.id) {"
);

fs.writeFileSync(file, code, 'utf8');
