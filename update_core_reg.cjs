const fs = require('fs');
const file = 'packages/gateway/src/tools/registry/core-registration.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('checkToolPermission')) {
  code = code.replace(
    /import { traceToolCallStart, traceToolCallEnd, traceDbRead, traceDbWrite } from '\.\.\/\.\.\/tracing\/index\.js';/g,
    `import { traceToolCallStart, traceToolCallEnd, traceDbRead, traceDbWrite } from '../../tracing/index.js';\nimport { checkToolPermission } from '../../services/tool/permission.js';`
  );
}

// 1. Inject check in registerGatewayTools
code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(toolDef\.name, args as Record<string, unknown>\)\n\s*: 0;\n\n\s*const result = group\.needsUserId/g,
  `const startTime = trace
            ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
            : 0;
            
          const perm = await checkToolPermission(context.userId ?? userId, toolDef.name, {
            source: 'chat',
            executionPermissions: context.executionPermissions
          });
          if (!perm.allowed) {
            return toToolResult({ success: false, error: \`Tool '\${toolDef.name}' blocked: \${perm.reason}\` });
          }

          const result = group.needsUserId`
);

// 2. Inject check in Artifact tools
code = code.replace(
  /const startTime = trace\n\s*\? traceToolCallStart\(toolDef\.name, args as Record<string, unknown>\)\n\s*: 0;\n\n\s*const result = await executeArtifactTool/g,
  `const startTime = trace
          ? traceToolCallStart(toolDef.name, args as Record<string, unknown>)
          : 0;
          
        const perm = await checkToolPermission(context.userId ?? userId, toolDef.name, {
          source: 'chat',
          executionPermissions: context.executionPermissions
        });
        if (!perm.allowed) {
          return toToolResult({ success: false, error: \`Tool '\${toolDef.name}' blocked: \${perm.reason}\` });
        }

        const result = await executeArtifactTool`
);

fs.writeFileSync(file, code, 'utf8');
