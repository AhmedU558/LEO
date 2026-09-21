const fs = require('fs');
const file = 'packages/gateway/src/services/extension/sandbox.ts';
let code = fs.readFileSync(file, 'utf8');

// The file currently spawns worker threads. We need to rip that out and replace it with executeIsolatedJavaScript.
// Actually, it might be easier to just rewrite the main exported functions in sandbox.ts
