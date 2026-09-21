const fs = require('fs');
const file = 'packages/gateway/src/services/agent/service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /export async function getOrCreateChatAgent\(\s*provider: string,\s*model: string,\s*fallback\?: \{ provider: string; model: string \},\s*pageContext\?: \{ path\?: string \} \| null,\s*conversationId\?: string,\s*gatewayUrl\?: string\s*\): Promise<Agent> \{/g,
  `export async function getOrCreateChatAgent(
  provider: string,
  model: string,
  fallback?: { provider: string; model: string },
  pageContext?: { path?: string } | null,
  conversationId?: string,
  gatewayUrl?: string,
  userId?: string,
  workspaceId?: string
): Promise<Agent> {`
);

code = code.replace(
  /const sanitize = \(s: string\) => s\.replace\(\/\\|\/g, '_'\);\n\s*const fbSuffix[\s\S]*?const cacheKey = `chat\|\$\{sanitize\(provider\)\}\|\$\{sanitize\(model\)\}\$\{fbSuffix\}\$\{pathSuffix\}\$\{convSuffix\}`;/g,
  `const sanitize = (s: string) => s.replace(/\\|/g, '_');
  const fbSuffix = fallback ? \`|fb_\${sanitize(fallback.provider)}_\${sanitize(fallback.model)}\` : '';
  const pathSuffix = pageContext?.path ? \`|dir_\${sanitize(pageContext.path)}\` : '';
  const convSuffix = conversationId ? \`|conv_\${sanitize(conversationId)}\` : '';
  const usrSuffix = userId ? \`|usr_\${userId}\` : '';
  const wsSuffix = workspaceId ? \`|ws_\${workspaceId}\` : '';
  const cacheKey = \`chat|\${sanitize(provider)}|\${sanitize(model)}\${fbSuffix}\${pathSuffix}\${convSuffix}\${usrSuffix}\${wsSuffix}\`;`
);

code = code.replace(
  /const promise = createChatAgentInstance\(\n\s*provider,\n\s*model,\n\s*cacheKey,\n\s*fallback,\n\s*pageContext,\n\s*gatewayUrl\n\s*\)\.finally/g,
  `const promise = createChatAgentInstance(
    provider,
    model,
    cacheKey,
    fallback,
    pageContext,
    gatewayUrl,
    userId,
    workspaceId
  ).finally`
);

code = code.replace(
  /async function createChatAgentInstance\(\s*provider: string,\s*model: string,\s*cacheKey: string,\s*fallback\?: \{ provider: string; model: string \},\s*_pageContext\?: \{ path\?: string \} \| null,\s*gatewayUrl\?: string\s*\): Promise<Agent> \{/g,
  `async function createChatAgentInstance(
  provider: string,
  model: string,
  cacheKey: string,
  fallback?: { provider: string; model: string },
  _pageContext?: { path?: string } | null,
  gatewayUrl?: string,
  userId?: string,
  workspaceId?: string
): Promise<Agent> {`
);

code = code.replace(
  /const userId = 'default';/g,
  `const resolvedUserId = (typeof userId !== 'undefined' ? userId : 'default');`
);

code = code.replace(
  /registerGatewayTools\(tools, userId, false\);/g,
  `registerGatewayTools(tools, resolvedUserId, false);`
);

code = code.replace(
  /registerGatewayTools\(tools, userId, true\);/g,
  `registerGatewayTools(tools, resolvedUserId, true);`
);

code = code.replace(
  /registerDynamicTools\(\n\s*tools,\n\s*userId,/g,
  `registerDynamicTools(\n    tools,\n    resolvedUserId,`
);

code = code.replace(
  /registerExtensionTools\(tools, userId, false\);/g,
  `registerExtensionTools(tools, resolvedUserId, false);`
);

fs.writeFileSync(file, code, 'utf8');
