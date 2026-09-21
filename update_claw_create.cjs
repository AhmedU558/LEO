const fs = require('fs');
const file = 'packages/gateway/src/tools/claw/lifecycle-executors.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /try \{\s*const vm = await import\('node:vm'\);[\s\S]*?\} catch \(err\) \{[\s\S]*?getErrorMessage\(err\)\}` \};\s*\}/m;

const replacement = `try {
    const { getExtensionSandbox } = await import('../../services/extension/sandbox.js');
    const result = await getExtensionSandbox().execute({
      extensionId: \`claw:\${ctx.clawId}\`,
      toolName: name,
      code,
      args: invokeArgs,
      ownerUserId: 'claw', // Ephemeral
      maxExecutionTime: CLAW_EXEC_TIMEOUT_MS,
    });
    
    if (result.success) {
      return { success: true, result: { tool: name, output: result.result } };
    } else {
      return { success: false, error: \`Tool execution failed: \${result.error}\` };
    }
  } catch (err) {
    return { success: false, error: \`Tool wrapper error: \${getErrorMessage(err)}\` };
  }`;

code = code.replace(regex, replacement);
fs.writeFileSync(file, code, 'utf8');
