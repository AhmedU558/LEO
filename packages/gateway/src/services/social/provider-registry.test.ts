import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialProvider } from '@ownpilot/core/social';

// One shared logger, so each test sees exactly what the registry logged.
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../log.js', () => ({ getLog: () => log }));

/** The registry is a module-level singleton: load a fresh copy per test. */
const load = async () => (await import('./provider-registry.js')).socialProviderRegistry;

describe('socialProviderRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('does nothing at import, so loading the gateway stays silent', async () => {
    // Every CLI command imports the gateway, --help included. Registering and
    // logging at import time printed a line per platform before any output.
    await load();
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it('loads every built-in provider on first use', async () => {
    const registry = await load();
    for (const platform of ['youtube', 'instagram', 'facebook', 'tiktok'] as const)
      expect(registry.get(platform).platform).toBe(platform);
    expect(log.debug).toHaveBeenCalledTimes(4);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('keeps a provider registered before first use instead of replacing it', async () => {
    const registry = await load();
    const custom = { platform: 'youtube' } as SocialProvider;
    registry.register(custom);
    expect(registry.get('youtube')).toBe(custom);
    expect(registry.get('tiktok').platform).toBe('tiktok');
  });

  it('refuses a platform with no provider rather than guessing', async () => {
    const registry = await load();
    expect(() => registry.get('myspace' as never)).toThrow(
      'No production social publish provider configured for platform: myspace'
    );
  });
});
