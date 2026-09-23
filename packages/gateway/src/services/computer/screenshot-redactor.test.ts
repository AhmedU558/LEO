import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { StructuralScreenshotRedactor } from './screenshot-redactor.js';
import type { ScreenshotRedactor } from '@ownpilot/core/computer';

const redactor = new StructuralScreenshotRedactor();
async function input(color = '#ff00ff'): Promise<Parameters<ScreenshotRedactor['redact']>[0]> {
  const screenshot = await sharp({
    create: { width: 1280, height: 800, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return {
    image: {
      screenshot: screenshot.toString('base64'),
      width: 1280,
      height: 800,
      layout: {
        revision: 'local',
        controls: [{ x: 10, y: 10, width: 150, height: 30, kind: 'Button' }],
      },
    },
    binding: { userId: 'u', workspaceId: 'w', executionTaskId: 't', sessionId: 's' },
    observationId: 'obs',
    signal: new AbortController().signal,
  };
}
describe('trusted structural screenshot redaction', () => {
  it('masks every source pixel while preserving control positions and the viewport', async () => {
    const a = await redactor.redact(await input('#ff00ff'));
    const b = await redactor.redact(await input('#0000ff'));
    expect(a.observation.screenshot).toBe(b.observation.screenshot);
    const image = sharp(Buffer.from(a.observation.screenshot, 'base64'));
    expect(await image.metadata()).toMatchObject({ width: 1280, height: 800, format: 'png' });
    const raw = await image.removeAlpha().raw().toBuffer();
    expect([...raw.subarray((700 * 1280 + 700) * 3, (700 * 1280 + 700) * 3 + 3)]).toEqual([
      255, 255, 255,
    ]);
    expect(a.observation.disclosure).toBe('redacted');
    expect(a.metadata).toMatchObject({ method: 'opaque-structural-v1', maskedRegions: 1 });
  });
  it.each(['Password', 'Secret', 'Authentication'] as const)(
    'protects %s fields without retaining their values',
    async (kind) => {
      const fixture = await input();
      fixture.image.layout = {
        revision: 'local',
        controls: [{ x: 10, y: 10, width: 150, height: 30, kind }],
      };
      expect((await redactor.redact(fixture)).metadata.sensitiveControls).toBe(1);
    }
  );
  it.each([
    'missing-layout',
    'no-controls',
    'oversized',
    'wrong-size',
    'invalid-png',
    'invalid-region',
  ])('refuses unsafe screenshot: %s', async (mode) => {
    const fixture = await input();
    if (mode === 'missing-layout') fixture.image.layout = undefined;
    if (mode === 'no-controls') fixture.image.layout = { revision: 'local', controls: [] };
    if (mode === 'oversized') fixture.image.screenshot = 'A'.repeat(6_000_000);
    if (mode === 'wrong-size') fixture.image.width = 1920;
    if (mode === 'invalid-png') fixture.image.screenshot = Buffer.from('secret').toString('base64');
    if (mode === 'invalid-region')
      fixture.image.layout = {
        revision: 'local',
        controls: [{ x: -1, y: 0, width: 150, height: 30, kind: 'Field' }],
      };
    await expect(redactor.redact(fixture)).rejects.toThrow();
  });
  it('honors cancellation before decoding', async () => {
    const fixture = await input();
    await expect(redactor.redact({ ...fixture, signal: AbortSignal.abort() })).rejects.toThrow();
  });
});
