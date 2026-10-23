const fs = require('fs');
function replaceFile(path, search, replace) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(path, content);
}

replaceFile(
  'packages/gateway/src/agentic/agentic-executor.ts',
  /const taskDesc = /g,
  '// const taskDesc = '
);
replaceFile(
  'packages/gateway/src/agentic/agentic-executor.ts',
  /const systemPrompt = /g,
  '// const systemPrompt = '
);
replaceFile(
  'packages/gateway/src/routes/browser.ts',
  /c\.req\.param\('sessionId'\), c/g,
  "c.req.param('sessionId')"
);
replaceFile(
  'packages/gateway/src/services/agent/service.ts',
  /const workspaceId = /g,
  '// const workspaceId = '
);
replaceFile(
  'packages/gateway/src/services/dashboard/briefing.ts',
  /query\.userId/g,
  '(query as any).userId'
);
replaceFile(
  'packages/gateway/src/services/extension/sandbox.ts',
  /const log = /g,
  '// const log = '
);
replaceFile(
  'packages/gateway/src/services/extension/sandbox.ts',
  /const callToolHandler = /g,
  '// const callToolHandler = '
);
replaceFile(
  'packages/gateway/src/services/mcp/client.ts',
  /context\.metadata/g,
  '(context as any).metadata'
);
replaceFile(
  'packages/gateway/src/tools/claw/lifecycle-executors.ts',
  /const _sandboxPref = /g,
  '// const _sandboxPref = '
);
replaceFile(
  'packages/gateway/src/tools/claw/lifecycle-executors.ts',
  /const _localInterpreters = /g,
  '// const _localInterpreters = '
);
replaceFile(
  'packages/gateway/src/tools/claw/lifecycle-executors.ts',
  /const _toolArgs = /g,
  '// const _toolArgs = '
);
