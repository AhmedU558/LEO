const fs = require('fs');
const file = 'packages/gateway/src/services/agent/service.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Update getOrCreateChatAgent signature
code = code.replace(
/export async function getOrCreateChatAgent\([\s\S]*?\n\): Promise<Agent> \{/,
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

// 2. Update cache key
code = code.replace(
/const sanitize = \(s: string\) => s\.replace\(\/\\|\/g, '_'\);\n\s*const fbSuffix[\s\S]*?const cacheKey = `chat\|\$\{sanitize\(provider\)\}\|\$\{sanitize\(model\)\}\$\{fbSuffix\}\$\{pathSuffix\}\$\{convSuffix\}`;/,
`const sanitize = (s: string) => s.replace(/\\|/g, '_');
  const fbSuffix = fallback ? \`|fb_\${sanitize(fallback.provider)}_\${sanitize(fallback.model)}\` : '';
  const pathSuffix = pageContext?.path ? \`|dir_\${sanitize(pageContext.path)}\` : '';
  const convSuffix = conversationId ? \`|conv_\${sanitize(conversationId)}\` : '';
  const usrSuffix = userId ? \`|usr_\${userId}\` : '';
  const wsSuffix = workspaceId ? \`|ws_\${workspaceId}\` : '';
  const cacheKey = \`chat|\${sanitize(provider)}|\${sanitize(model)}\${fbSuffix}\${pathSuffix}\${convSuffix}\${usrSuffix}\${wsSuffix}\`;`
);

// 3. Update createChatAgentInstance call
code = code.replace(
/const promise = createChatAgentInstance\(\n\s*provider,\n\s*model,\n\s*cacheKey,\n\s*fallback,\n\s*pageContext,\n\s*gatewayUrl\n\s*\)\.finally/,
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

// 4. Update createChatAgentInstance signature
code = code.replace(
/async function createChatAgentInstance\([\s\S]*?\n\): Promise<Agent> \{/,
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

// 5. Replace `const userId = 'default';` ONLY in createChatAgentInstance and createAgentFromRecord
code = code.replace(/const userId = 'default';\n\s*registerGatewayTools/g,
  `const resolvedUserId = userId ?? 'default';\n  registerGatewayTools`);

code = code.replace(/userId,\n\s*`chat_\$\{provider\}_\$\{model\}`/g,
  `resolvedUserId,\n      \`chat_\${provider}_\${model}\``);

code = code.replace(/registerExtensionTools\(tools, userId, false\);/g,
  `registerExtensionTools(tools, resolvedUserId, false);`);

fs.writeFileSync(file, code, 'utf8');
