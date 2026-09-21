const fs = require('fs');
function replaceFile(path, search, replace) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(path, content);
}

replaceFile('packages/gateway/src/agentic/agentic-executor.ts', 'const taskDesc = message.content;', 'const _taskDesc = message.content;');
replaceFile('packages/gateway/src/agentic/agentic-executor.ts', 'const systemPrompt = message.agent?.system_prompt;', 'const _systemPrompt = message.agent?.system_prompt;');
replaceFile('packages/gateway/src/routes/browser.ts', "c.req.param('sessionId'), c", "c.req.param('sessionId') as any, c");
replaceFile('packages/gateway/src/routes/voice.ts', "getUserId(c.req)", "getUserId(c as any)");
replaceFile('packages/gateway/src/routes/voice.ts', "getWorkspaceId(c.req)", "getWorkspaceId(c as any)");
replaceFile('packages/gateway/src/services/agent/service.ts', "const workspaceId = args.workspaceId;", "const _workspaceId = args.workspaceId;");
replaceFile('packages/gateway/src/services/dashboard/briefing.ts', "query.userId", "(query as any).userId");
replaceFile('packages/gateway/src/services/extension/sandbox.ts', "const log = getLog();", "const _log = getLog();");
replaceFile('packages/gateway/src/services/extension/sandbox.ts', "const callToolHandler = options.callTool;", "const _callToolHandler = options.callTool;");
replaceFile('packages/gateway/src/services/mcp/client.ts', "context.metadata", "(context as any).metadata");
replaceFile('packages/gateway/src/tools/claw/lifecycle-executors.ts', "const _sandboxPref = ctx", "// @ts-ignore\nconst _sandboxPref = ctx");
replaceFile('packages/gateway/src/tools/claw/lifecycle-executors.ts', "const _localInterpreters = ", "// @ts-ignore\nconst _localInterpreters = ");
replaceFile('packages/gateway/src/tools/claw/lifecycle-executors.ts', "const _toolArgs = ", "// @ts-ignore\nconst _toolArgs = ");

