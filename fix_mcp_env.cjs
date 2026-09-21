const fs = require('fs');
let file = 'packages/gateway/src/services/mcp/client.ts';
let code = fs.readFileSync(file, 'utf8');

const replacement = `const baseEnv = {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USER: process.env.USER,
            APPDATA: process.env.APPDATA,
            LOCALAPPDATA: process.env.LOCALAPPDATA,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            LANG: process.env.LANG,
          };
          // Remove undefined values
          const cleanEnv = Object.fromEntries(
            Object.entries(baseEnv).filter(([_, v]) => v !== undefined)
          ) as Record<string, string>;

          return new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: {
              ...cleanEnv,
              ...server.env,
            },`;

code = code.replace(/return new StdioClientTransport\(\{\s*command: server\.command,\s*args: server\.args,\s*env: \{\s*\.\.\.\(process\.env as Record<string, string>\),\s*\.\.\.server\.env,\s*\},/g, replacement);
fs.writeFileSync(file, code, 'utf8');
