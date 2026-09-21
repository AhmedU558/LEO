const fs = require('fs');
let file = 'packages/gateway/src/routes/settings.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(/import \{ invalidateAgentCache \} from '\.\.\/agents\/index\.js';/, "import { invalidateAgentCache } from '../services/agent/cache.js';");
fs.writeFileSync(file, code, 'utf8');
