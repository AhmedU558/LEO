const fs = require('fs');
const file = 'packages/gateway/src/routes/model-configs/providers.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/await modelConfigsRepo\.(upsertProvider|updateProvider|deleteProvider|toggleProvider|upsertModel)\b([^\)]+)\);/g, "await modelConfigsRepo.$1$2);\n    invalidateAgentCache();");

fs.writeFileSync(file, code, 'utf8');
