import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getClientIp, isProxyAwareConfigured, isRequestFromTrustedProxy } from './client-ip.js';
import { getRequestOrigin } from './trusted-proxy.js';
import { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

vi.mock('@hono/node-server/conninfo', () => ({
  getConnInfo: vi.fn(),
}));

function mockContext(headers: Record<string, string>, url: string = 'http://localhost/test') {
  return {
    req: {
      header: (name: string) => {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : undefined;
      },
      url,
    },
  } as unknown as Context;
}

describe('QA-021: Network/Proxy Security', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    vi.mocked(getConnInfo).mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  it('fails safe when TRUSTED_PROXY is set without TRUSTED_PROXY_IPS', () => {
    process.env.TRUSTED_PROXY = 'true';
    delete process.env.TRUSTED_PROXY_IPS;

    const c = mockContext({ 'X-Forwarded-For': '10.0.0.1' });
    vi.mocked(getConnInfo).mockReturnValue({ remote: { address: '192.168.1.5' } } as any);

    expect(isProxyAwareConfigured()).toBe(false);
    expect(getClientIp(c)).toBe('192.168.1.5');
    expect(isRequestFromTrustedProxy(c)).toBe(false);
  });

  it('honors X-Forwarded-For if socket peer is in TRUSTED_PROXY_IPS', () => {
    process.env.TRUSTED_PROXY = 'true';
    process.env.TRUSTED_PROXY_IPS = '192.168.1.100,192.168.1.101';

    const c = mockContext({ 'X-Forwarded-For': '10.0.0.5, 10.0.0.6' });
    vi.mocked(getConnInfo).mockReturnValue({ remote: { address: '192.168.1.100' } } as any);

    expect(isProxyAwareConfigured()).toBe(true);
    expect(isRequestFromTrustedProxy(c)).toBe(true);
    // Gets the LAST IP in the X-Forwarded-For chain
    expect(getClientIp(c)).toBe('10.0.0.6');
  });

  it('ignores X-Forwarded-For if socket peer is NOT in TRUSTED_PROXY_IPS', () => {
    process.env.TRUSTED_PROXY = 'true';
    process.env.TRUSTED_PROXY_IPS = '192.168.1.100';

    const c = mockContext({ 'X-Forwarded-For': '10.0.0.5, 10.0.0.6' });
    vi.mocked(getConnInfo).mockReturnValue({ remote: { address: '192.168.1.99' } } as any);

    expect(isProxyAwareConfigured()).toBe(true);
    expect(isRequestFromTrustedProxy(c)).toBe(false);
    // Ignores spoofed headers and uses the socket peer
    expect(getClientIp(c)).toBe('192.168.1.99');
  });

  it('honors X-Forwarded-Host only from trusted proxies', () => {
    process.env.TRUSTED_PROXY = 'true';
    process.env.TRUSTED_PROXY_IPS = '192.168.1.100';

    const c = mockContext(
      { 'X-Forwarded-Host': 'evil.com', 'X-Forwarded-Proto': 'https' },
      'http://localhost/test'
    );

    // Untrusted socket
    vi.mocked(getConnInfo).mockReturnValue({ remote: { address: '1.2.3.4' } } as any);
    expect(getRequestOrigin(c)).toBe('http://localhost');

    // Trusted socket
    vi.mocked(getConnInfo).mockReturnValue({ remote: { address: '192.168.1.100' } } as any);
    expect(getRequestOrigin(c)).toBe('https://evil.com');
  });
});
