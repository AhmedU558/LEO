const fs = require('fs');
let file = 'packages/core/src/agent/tools/dynamic-tool-executor.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/import \{ UTILITY_TOOLS \} from '\.\.\/index\.js';/g, "");
code = code.replace(/import \{ getBaseName \} from '\.\.\/\.\.\/workspace\/path-utils\.js';/g, "");
code = code.replace(/import type \{ ExecutionPermissions, DynamicToolPermission \} from '\.\.\/\.\.\/security\/execution-permissions\.js';/g, "import type { ExecutionPermissions } from '../../security/execution-permissions.js';");
code = code.replace(/import \{ isToolCallAllowed \} from '\.\.\/\.\.\/security\/execution-permissions\.js';/g, "");

code = code.replace(/import \{\s*ActionLedger,\s*checkCriticalPatterns,\s*evaluateMathExpression,\s*\} from '\.\.\/\.\.\/security\/index\.js';/g, "");

code = code.replace(/const callableTools =.*?;/g, "");
code = code.replace(/const pluginId = context\.pluginId;/g, "");
code = code.replace(/const toolPermissions = context\.toolPermissions;/g, "");

fs.writeFileSync(file, code, 'utf8');
