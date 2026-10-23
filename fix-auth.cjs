const fs = require('fs');
const file = 'packages/gateway/src/middleware/auth.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /if \(config\.type === 'none'\) \{\s*c\.set\('userId', 'default'\);\s*return next\(\);\s*\}/g,
  "if (config.type === 'none') {\n        return next();\n      }"
);
fs.writeFileSync(file, content);
