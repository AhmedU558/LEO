import { describe, expect, it, vi } from 'vitest';
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  exec: (_command: string, _options: unknown, callback: (error: Error) => void) =>
    callback(new Error('Docker unavailable')),
}));
import { executeIsolatedJavaScript } from './docker.js';
describe('isolation unavailable', () => {
  it('fails closed without executing user code in the host', async () => {
    await expect(
      executeIsolatedJavaScript('globalThis.qaIsolationMarker = true; return 1')
    ).rejects.toThrow('Docker is not available');
    expect('qaIsolationMarker' in globalThis).toBe(false);
  });
});
