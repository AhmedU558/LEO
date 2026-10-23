const fs = require('fs');

function replaceFile(path, search, replace) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(path, content);
}

replaceFile(
  'packages/gateway/src/test-setup.ts',
  `import { vi } from 'vitest';`,
  `import { vi, expect } from 'vitest';`
);

function fixAgentsIndex(path, depth) {
  const prefix = depth === 1 ? '.' : '..';
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(/from '\.\.\/agents\/index\.js'/g, `from '${prefix}/agents/index.js'`);
  content = content.replace(
    /from '\.\.\/\.\.\/agents\/index\.js'/g,
    `from '${prefix}/agents/index.js'`
  );
  fs.writeFileSync(path, content);
}

fixAgentsIndex('packages/gateway/src/routes/execution-permissions.ts', 1);
fixAgentsIndex('packages/gateway/src/routes/local-providers.ts', 1);
fixAgentsIndex('packages/gateway/src/routes/model-configs/providers.ts', 2);

replaceFile(
  'packages/gateway/src/tools/registry/external-registration.ts',
  /context\?\.userId \?\? userId/g,
  `context?.userId ?? _userId`
);

replaceFile('packages/gateway/src/routes/voice.ts', /getUserId\(c\.req\)/g, `getUserId(c)`);
replaceFile(
  'packages/gateway/src/routes/voice.ts',
  /getWorkspaceId\(c\.req\)/g,
  `getWorkspaceId(c)`
);

replaceFile(
  'packages/gateway/src/test-setup.ts',
  /return \{\s*\.\.\.original,\s*executeIsolatedJavaScript/g,
  `return { ...((original || {}) as any), executeIsolatedJavaScript`
);
replaceFile(
  'packages/gateway/src/test-setup.ts',
  /return \{\s*\.\.\.actual,\s*getUserId/g,
  `return { ...((actual || {}) as any), getUserId`
);
replaceFile('packages/gateway/src/test-setup.ts', /getUserId: \(c\) =>/g, `getUserId: (c: any) =>`);
replaceFile(
  'packages/gateway/src/test-setup.ts',
  /getWorkspaceId: \(c\) =>/g,
  `getWorkspaceId: (c: any) =>`
);
replaceFile(
  'packages/gateway/src/test-setup.ts',
  /executeIsolatedJavaScript: async \(code, context, options\) =>/g,
  `executeIsolatedJavaScript: async (code: any, context: any, options: any) =>`
);

replaceFile(
  'packages/gateway/src/services/browser-service.ts',
  `session = await this.sessions.createSession(userId, { workspaceId });`,
  `session = await this.sessions.createSession(userId || 'default', { workspaceId: workspaceId || 'default' });`
);
