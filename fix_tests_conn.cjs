const fs = require('fs');

const files = [
  'packages/gateway/src/db/repositories/qa010.integration.test.ts',
  'packages/gateway/src/db/repositories/qa016.integration.test.ts',
  'packages/gateway/src/db/repositories/qa017.integration.test.ts',
  'packages/gateway/src/db/repositories/qa018.integration.test.ts'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/await initializeAdapter\(\{ connectionString: url \}\);/g, "await initializeAdapter({ postgresUrl: url, type: 'postgres' });");
  fs.writeFileSync(file, content);
}
