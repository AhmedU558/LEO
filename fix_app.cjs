const fs = require('fs');
const appFile = 'packages/ui/src/App.tsx';
let appCode = fs.readFileSync(appFile, 'utf8');
appCode = appCode.replace(
  /const AutonomyPage = lazy\(\(\) =>\s+import\('\.\/pages\/AutonomyPage'\)\.then\(\(m\) => \(\{ default: m\.AutonomyPage \}\)\)\s+\);\s+/g,
  ''
);
fs.writeFileSync(appFile, appCode);
