const fs = require('fs');
const file = 'packages/gateway/src/tools/registry/core-registration.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(toolDef\.name, args as Record<string, unknown>\)\n\s*: 0;\n\s*const result = await executeCustomToolTool/g,
  `const startTime = trace
          ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
          : 0;
          
        const perm = await checkToolPermission(_context.userId ?? userId, toolDef.name, {
          source: 'chat',
          executionPermissions: _context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${toolDef.name}' blocked: \${perm.reason}\` });
        }

        const result = await executeCustomToolTool`
);

code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(toolDef\.name, args as Record<string, unknown>\)\n\s*: 0;\n\n\s*const result = await executeActiveCustomTool/g,
  `const startTime = trace
          ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
          : 0;
          
        const perm = await checkToolPermission(_context.userId ?? userId, toolDef.name, {
          source: 'chat',
          executionPermissions: _context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${toolDef.name}' blocked: \${perm.reason}\` });
        }

        const result = await executeActiveCustomTool`
);

fs.writeFileSync(file, code, 'utf8');
