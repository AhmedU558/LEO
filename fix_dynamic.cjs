const fs = require('fs');
let file = 'packages/core/src/agent/tools/dynamic-tool-executor.ts';
let code = fs.readFileSync(file, 'utf8');

// The unused variables and imports can be just @ts-ignoring them or removing them
code = code.replace(/import \* as crypto from 'node:crypto';/g, "");
code = code.replace(/import \{ UTILITY_TOOLS \} from '\.\.\/index\.js';/g, "");
code = code.replace(/import \{ getBaseName \} from '\.\.\/\.\.\/workspace\/path-utils\.js';/g, "");
code = code.replace(/import type \{ DynamicToolPermission \} from '\.\.\/\.\.\/security\/execution-permissions\.js';/g, "");
code = code.replace(/import \{ isToolCallAllowed \} from '\.\.\/\.\.\/security\/execution-permissions\.js';/g, "");
code = code.replace(/import \{\n  ActionLedger,\n  checkCriticalPatterns,\n  evaluateMathExpression,\n\} from '\.\.\/\.\.\/security\/index\.js';/g, "import {\n  ActionLedger,\n  checkCriticalPatterns,\n  evaluateMathExpression,\n} from '../../security/index.js';"); // Keep evaluateMathExpression if used, wait, all are unused?
code = code.replace(/import \{.*?ActionLedger.*?\} from '\.\.\/\.\.\/security\/index\.js';/s, "");

fs.writeFileSync(file, code, 'utf8');
