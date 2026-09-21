const fs = require('fs');
const file = 'packages/gateway/src/tools/registry/external-registration.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(definition\.name, args as Record<string, unknown>\)\n\s*: 0;\n\s*try \{/g,
  `const startTime = trace
          ? traceToolCallStart(definition.name, args as Record<string, unknown>)
          : 0;

        const perm = await checkToolPermission(context.userId ?? 'default', definition.name, {
          source: 'chat',
          executionPermissions: context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${definition.name}' blocked: \${perm.reason}\` });
        }

        try {`
);

code = code.replace(
  /const startTime = trace \? traceToolCallStart\(def\.name, args as Record<string, unknown>\) : 0;\n\s*try \{/g,
  `const startTime = trace ? traceToolCallStart(def.name, args as Record<string, unknown>) : 0;
          
          const perm = await checkToolPermission(context.userId ?? userId, def.name, {
            source: 'chat',
            executionPermissions: context.executionPermissions
          });
          if (!perm.allowed) {
            return toToolResult({ success: false, error: \`Tool '\${def.name}' blocked: \${perm.reason}\` });
          }

          try {`
);

code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(getBaseName\(definition\.name\), args as Record<string, unknown>\)\n\s*: 0;\n\s*try \{/g,
  `const startTime = trace
          ? traceToolCallStart(getBaseName(definition.name), args as Record<string, unknown>)
          : 0;
          
        const perm = await checkToolPermission(context.userId ?? 'default', getBaseName(definition.name), {
          source: 'chat',
          executionPermissions: context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${getBaseName(definition.name)}' blocked: \${perm.reason}\` });
        }

        try {`
);

fs.writeFileSync(file, code, 'utf8');
