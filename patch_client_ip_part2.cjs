const fs = require('fs');
let file = 'packages/gateway/src/utils/client-ip.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const TRUST_PROXY = process\.env\.TRUSTED_PROXY === 'true';\s*const RAW_TRUSTED_PROXY_IPS = process\.env\.TRUSTED_PROXY_IPS \?\? '';\s*const TRUSTED_PROXY_IPS = RAW_TRUSTED_PROXY_IPS\.split\(\/,\/\)\s*\.map\(\(s\) => s\.trim\(\)\)\s*\.filter\(Boolean\);\s*\/\*\* Special sentinel meaning "trust any proxy IP" \(useful in tests\) \*\/\s*const TRUST_ANY = TRUSTED_PROXY_IPS\.length > 0 && TRUSTED_PROXY_IPS\.includes\('\*'\);/,
  `function getTrustConfig() {
  const TRUST_PROXY = process.env.TRUSTED_PROXY === 'true';
  const RAW_TRUSTED_PROXY_IPS = process.env.TRUSTED_PROXY_IPS ?? '';
  const TRUSTED_PROXY_IPS = RAW_TRUSTED_PROXY_IPS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const TRUST_ANY = TRUSTED_PROXY_IPS.length > 0 && TRUSTED_PROXY_IPS.includes('*');
  return { TRUST_PROXY, TRUSTED_PROXY_IPS, TRUST_ANY };
}`
);

fs.writeFileSync(file, code, 'utf8');
