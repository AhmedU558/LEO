const fs = require('fs');
let file = 'packages/gateway/src/utils/client-ip.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const TRUST_PROXY = process\.env\.TRUSTED_PROXY === 'true';\nconst RAW_TRUSTED_PROXY_IPS = process\.env\.TRUSTED_PROXY_IPS \?\? '';\nconst TRUSTED_PROXY_IPS = RAW_TRUSTED_PROXY_IPS\.split\(\/,\/\)\n  \.map\(\(s\) => s\.trim\(\)\)\n  \.filter\(Boolean\);\n\/\*\* Special sentinel meaning "trust any proxy IP" \(useful in tests\) \*\/\nconst TRUST_ANY = TRUSTED_PROXY_IPS\.length > 0 && TRUSTED_PROXY_IPS\.includes\('\*'\);/,
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

// We need to replace usages in `isProxyAwareConfigured`, `warnIfMisconfigured`, `getClientIp`, and `isRequestFromTrustedProxy`.
code = code.replace(
  /export function isProxyAwareConfigured\(\): boolean \{[^}]+\}/,
  `export function isProxyAwareConfigured(): boolean {
  const { TRUST_PROXY, TRUSTED_PROXY_IPS, TRUST_ANY } = getTrustConfig();
  return TRUST_PROXY && (TRUSTED_PROXY_IPS.length > 0 || TRUST_ANY);
}`
);

code = code.replace(
  /function warnIfMisconfigured\(\): void \{[^}]+}[^}]+}/,
  `let warnedMisconfig = false;
function warnIfMisconfigured(): void {
  const { TRUST_PROXY, TRUSTED_PROXY_IPS } = getTrustConfig();
  if (TRUST_PROXY && TRUSTED_PROXY_IPS.length === 0 && !warnedMisconfig) {
    warnedMisconfig = true;
    log.warn(
      '[client-ip] TRUSTED_PROXY=true but TRUSTED_PROXY_IPS is empty ?" ' +
        'X-Forwarded-For will be IGNORED (fail-safe). Set TRUSTED_PROXY_IPS to ' +
        'a comma-separated list of your reverse-proxy IPs to enable per-IP ' +
        'rate limiting / login throttle.'
    );
  }
}`
);

code = code.replace(
  /if \(!TRUST_ANY && \(socketIp === null \|\| !TRUSTED_PROXY_IPS\.includes\(socketIp\)\)\) \{/,
  `const { TRUSTED_PROXY_IPS, TRUST_ANY } = getTrustConfig();
  if (!TRUST_ANY && (socketIp === null || !TRUSTED_PROXY_IPS.includes(socketIp))) {`
);

code = code.replace(
  /if \(TRUST_ANY\) return true;[\s\S]*?if \(socketIp && TRUSTED_PROXY_IPS\.includes\(socketIp\)\) \{/,
  `const { TRUSTED_PROXY_IPS, TRUST_ANY } = getTrustConfig();
  if (TRUST_ANY) return true;

  try {
    const info = getConnInfo(c);
    const socketIp = info?.remote?.address;
    if (socketIp && TRUSTED_PROXY_IPS.includes(socketIp)) {`
);


fs.writeFileSync(file, code, 'utf8');
