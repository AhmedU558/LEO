const fs = require('fs');
let file = 'packages/core/src/agent/tools/dynamic-tool-executor.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/import \{ UTILITY_TOOLS \} from '\.\/utility-tools\.js';/g, "");
code = code.replace(/import \{ getBaseName \} from '\.\.\/tool-namespace\.js';/g, "");
code = code.replace(/import type \{ DynamicToolDefinition, DynamicToolPermission \} from '\.\/dynamic-tool-types\.js';/g, "import type { DynamicToolDefinition } from './dynamic-tool-types.js';");
code = code.replace(/import \{ isToolCallAllowed \} from '\.\/dynamic-tool-permissions\.js';/g, "");
code = code.replace(/import \{ createSafeFetch, mapPermissions, createSandboxUtils \} from '\.\/dynamic-tool-sandbox\.js';/g, "import { createSafeFetch, mapPermissions, createSandboxUtils } from './dynamic-tool-sandbox.js';");

code = code.replace(/const pluginId = `dynamic:\$\{tool\.name\}` as PluginId;/g, "const pluginId = `dynamic:${tool.name}` as PluginId; pluginId;");
code = code.replace(/const toolPermissions = tool\.permissions \?\? \[\];/g, "const toolPermissions = tool.permissions ?? []; toolPermissions;");
code = code.replace(/callableTools\?: Array<\{ definition: ToolDefinition; executor: ToolExecutor \}>/g, "callableTools?: any");

fs.writeFileSync(file, code, 'utf8');
