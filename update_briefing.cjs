const fs = require('fs');
const file = 'packages/gateway/src/services/dashboard/briefing.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const agent = await getOrCreateChatAgent\(\n\s*provider,\n\s*model,\n\s*undefined,\n\s*null,\n\s*'dashboard-briefing'\n\s*\);/g,
  `const agent = await getOrCreateChatAgent(
          provider,
          model,
          undefined,
          null,
          'dashboard-briefing',
          undefined,
          userId,
          'default'
        );`
);

code = code.replace(
  /const agent = await getOrCreateChatAgent\(\n\s*options\.provider,\n\s*model,\n\s*undefined,\n\s*null,\n\s*'dashboard-briefing-stream'\n\s*\);/g,
  `const agent = await getOrCreateChatAgent(
        options.provider,
        model,
        undefined,
        null,
        'dashboard-briefing-stream',
        undefined,
        options.userId,
        'default'
      );`
);

fs.writeFileSync(file, code, 'utf8');
