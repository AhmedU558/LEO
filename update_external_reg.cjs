const fs = require('fs');
const file = 'packages/gateway/src/tools/registry/external-registration.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('checkToolPermission')) {
  code = `import { checkToolPermission } from '../../services/tool/permission.js';\n` + code;
  code = `import { toToolResult } from './utils.js';\n` + code;
}

code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(toolDef\.name, args\)\n\s*: 0;\n\s*try \{/g,
  `const startTime = trace
          ? traceToolCallStart(toolDef.name, args)
          : 0;

        const perm = await checkToolPermission(context.userId ?? 'default', toolDef.name, {
          source: 'chat',
          executionPermissions: context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${toolDef.name}' blocked: \${perm.reason}\` });
        }

        try {`
);

fs.writeFileSync(file, code, 'utf8');
