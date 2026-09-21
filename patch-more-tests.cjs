const fs = require('fs');

const files = [
  'packages/gateway/src/routes/custom-tools/integration.test.ts',
  'packages/gateway/src/routes/heartbeats/index.test.ts',
  'packages/gateway/src/routes/workflow/index.test.ts',
  'packages/gateway/src/routes/workspaces/integration.test.ts',
  'packages/gateway/src/tools/claw/tools.test.ts',
  'packages/gateway/src/routes/model-configs/pricing.test.ts',
  'packages/gateway/src/routes/custom-tools/generation.test.ts'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes("c.set('userId', 'default')")) {
      content = content.replace(
        /const app = new Hono\(\);/g,
        "const app = new Hono();\napp.use('*', async (c, next) => { c.set('userId', 'default'); await next(); });"
      );
      fs.writeFileSync(file, content);
      console.log("Patched", file);
    }
  }
}
