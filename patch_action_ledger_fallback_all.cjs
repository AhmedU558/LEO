const fs = require('fs');
let file = 'packages/core/src/security/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

const methods = ['updateResult', 'getEntries', 'getByWorkspaceId', 'getByActionId'];

for (const m of methods) {
  // We need to inject the production check right after the `if (this.provider)` block.
  // We can do it by finding the first `const` or `let` after the provider check, or just searching for the provider check itself.
  const regex = new RegExp(`(public static async ${m}[\\s\\S]*?if \\(this\\.provider\\) [^;]+;\\s*)`);
  code = code.replace(regex, `$1\n    if (process.env.NODE_ENV === 'production') {\n      throw new Error('ActionLedger: Production environment must use a persistent ActionLedgerProvider. Cannot silently fall back to in-memory.');\n    }\n`);
}

fs.writeFileSync(file, code, 'utf8');
