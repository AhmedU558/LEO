const fs = require('fs');
const file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

// For executeRunScript, remove the try-catch that sets useDocker = false, and remove the local fallback.
code = code.replace(/let useDocker = false;[\s\S]*?if \(sandboxPref === 'docker' \|\| sandboxPref === 'auto'\) \{[\s\S]*?catch \{[\s\S]*?\}[\s\S]*?\}/m, 
`let useDocker = true; // QA-009: local fallback strictly forbidden
  const dockerFallbackReason = undefined;`);

code = code.replace(/const localInterpreters[^}]*?};\s*/m, '');

code = code.replace(/} else \{[\s\S]*?cmd = interp\.cmd;[\s\S]*?cmdArgs = interp\.args;\s*\}/m, 
`} else {
    throw new Error('QA-009 Violation: Local execution fallback is forbidden. Untrusted code must run in Docker.');
  }`);

fs.writeFileSync(file, code, 'utf8');
