const fs = require('fs');
const file = 'packages/gateway/src/services/agent/service.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/export async function getOrCreateChatAgent\([\s\S]*?gatewayUrl\?: string\s*\): Promise<Agent> \{/m, 
`export async function getOrCreateChatAgent(
  provider: string,
  model: string,
  fallback?: { provider: string; model: string },
  pageContext?: { path?: string } | null,
  conversationId?: string,
  gatewayUrl?: string,
  userId = 'default',
  workspaceId = 'default'
): Promise<Agent> {`);

code = code.replace(/const sanitize = \(s: string\) => s\.replace\(\/\\|\/g, '_'\);\s*const fbSuffix = [\s\S]*?cacheKey = `chat\|\$\{sanitize\(provider\)\}\|\$\{sanitize\(model\)\}\$\{fbSuffix\}\$\{pathSuffix\}\$\{convSuffix\}`;/m, 
`const sanitize = (s: string) => s.replace(/\\|/g, '_');
  const fbSuffix = fallback ? \`|fb_\${sanitize(fallback.provider)}_\${sanitize(fallback.model)}\` : '';
  const pathSuffix = pageContext?.path ? \`|dir_\${sanitize(pageContext.path)}\` : '';
  const convSuffix = conversationId ? \`|conv_\${sanitize(conversationId)}\` : '';
  const cacheKey = \`chat|\${userId}|\${workspaceId}|\${sanitize(provider)}|\${sanitize(model)}\${fbSuffix}\${pathSuffix}\${convSuffix}\`;`);

code = code.replace(/const promise = createChatAgentInstance\([\s\S]*?\)\.finally\(\(\) => \{/m, 
`const promise = createChatAgentInstance(
    provider,
    model,
    cacheKey,
    fallback,
    pageContext,
    gatewayUrl,
    userId,
    workspaceId
  ).finally(() => {`);

code = code.replace(/async function createChatAgentInstance\([\s\S]*?gatewayUrl\?: string\s*\): Promise<Agent> \{/m, 
`async function createChatAgentInstance(
  provider: string,
  model: string,
  cacheKey: string,
  fallback?: { provider: string; model: string },
  _pageContext?: { path?: string } | null,
  gatewayUrl?: string,
  userId = 'default',
  workspaceId = 'default'
): Promise<Agent> {`);

code = code.replace(/const userId = 'default';/g, '');

fs.writeFileSync(file, code, 'utf8');
