const fs = require('fs');

const appFile = 'packages/ui/src/App.tsx';
let appCode = fs.readFileSync(appFile, 'utf8');
appCode = appCode.replace(
  /const AutonomyPage = React\.lazy\(\(\) => import\('\.\/pages\/AutonomyPage'\)\);\n/g,
  ''
);
fs.writeFileSync(appFile, appCode);

const navFile = 'packages/ui/src/constants/nav-items.ts';
let navCode = fs.readFileSync(navFile, 'utf8');
navCode = navCode.replace(/\s+Monitor,\n/g, '\n');
navCode = navCode.replace(/\s+Mic,\n/g, '\n');
navCode = navCode.replace(/\s+LineChart,\n/g, '\n');
fs.writeFileSync(navFile, navCode);
