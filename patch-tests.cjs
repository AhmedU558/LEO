const fs = require('fs');

function addMiddleware(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(
    /const app = new Hono\(\);/g,
    "const app = new Hono();\napp.use('*', async (c, next) => { c.set('userId', 'default'); await next(); });"
  );
  fs.writeFileSync(file, content);
}

addMiddleware('packages/gateway/src/routes/agents/messages.test.ts');
addMiddleware('packages/gateway/src/routes/custom-tools/generation.test.ts');
addMiddleware('packages/gateway/src/tools/registry/core-registration.test.ts');
addMiddleware('packages/gateway/src/services/mcp/qa026.integration.test.ts');

console.log('Added test middleware');
