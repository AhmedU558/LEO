const fs = require('fs');
let file = 'packages/core/src/security/action-ledger.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /if \(this\.provider\) \{\s*return this\.provider\.record\(entryData\);\s*\}/,
  `if (this.provider) {
      return this.provider.record(entryData);
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ActionLedger: Production environment must use a persistent ActionLedgerProvider. Cannot silently fall back to in-memory.');
    }`
);

fs.writeFileSync(file, code, 'utf8');
