import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { StructuralScreenshotRedactor } from './screenshot-redactor.js';
import type { ScreenshotRedactor, ComputerRedactionLayout } from '@ownpilot/core/computer';

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
    expect(a.metadata).toMatchObject({ method: 'opaque-structural-v2', maskedRegions: 1 });
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

  // ---------------------------------------------------------------------------
  // Phase 6.9: trusted rich observation.
  //
  // The disclosure is drawn INTO the mask as pixels, so the model request shape
  // and the proposal schema are unchanged and no page string is ever added to
  // the JSON sent to the provider.
  // ---------------------------------------------------------------------------

  /** Render and return the SVG text layer actually composited over the pixels. */
  const captionsOf = async (controls: ComputerRedactionLayout['controls']) => {
    const fixture = await input();
    fixture.image.layout = { revision: 'local', controls };
    const seen: string[] = [];
    const original = Buffer.from;
    const spy = vi.spyOn(Buffer, 'from').mockImplementation(((value: never, ...rest: never[]) => {
      if (typeof value === 'string' && value.startsWith('<svg')) seen.push(value);
      return (original as (v: never, ...r: never[]) => Buffer)(value, ...rest);
    }) as typeof Buffer.from);
    try {
      const result = await redactor.redact(fixture);
      return { svg: seen.join(''), result };
    } finally {
      spy.mockRestore();
    }
  };

  it('discloses a safe visible label so the model can read the control', async () => {
    const { svg, result } = await captionsOf([
      { x: 10, y: 10, width: 150, height: 30, kind: 'Button', text: 'Continue' },
    ]);
    expect(svg).toContain('Button: Continue');
    expect(result.metadata.disclosedLabels).toBe(1);
  });

  it('never discloses text on a sensitive control, whatever the capture claimed', async () => {
    // A capture bug — or a compromised provider — must not be able to smuggle a
    // credential through by attaching it to a Password box.
    const { svg, result } = await captionsOf([
      { x: 10, y: 10, width: 150, height: 30, kind: 'Password', text: 'hunter2' },
      { x: 10, y: 50, width: 150, height: 30, kind: 'Secret', text: 'sk-live-abc' },
      { x: 10, y: 90, width: 150, height: 30, kind: 'Authentication', text: '123456' },
    ]);
    expect(svg).not.toContain('hunter2');
    expect(svg).not.toContain('sk-live-abc');
    expect(svg).not.toContain('123456');
    expect(result.metadata.sensitiveControls).toBe(3);
    expect(result.metadata.disclosedLabels).toBe(0);
  });

  it.each([
    ['an OTP', '123456'],
    ['a token', 'sk-or-v1-abcdef0123456789'],
    ['a credential word', 'Your password'],
    ['prose rather than a label', 'This is a long sentence that is clearly not a UI label'],
    ['an address', 'user@example.com'],
  ])('masks %s even on a non-sensitive control', async (_name, text) => {
    const { svg, result } = await captionsOf([
      { x: 10, y: 10, width: 300, height: 30, kind: 'Text', text },
    ]);
    expect(svg).not.toContain(text);
    expect(svg).toContain('>Text<');
    expect(result.metadata.disclosedLabels).toBe(0);
  });

  it('makes a non-control region observable and changes the output when it changes', async () => {
    const before = await captionsOf([
      { x: 10, y: 10, width: 300, height: 30, kind: 'Heading', text: 'Step one' },
    ]);
    const after = await captionsOf([
      { x: 10, y: 10, width: 300, height: 30, kind: 'Heading', text: 'Step two' },
    ]);
    expect(before.svg).toContain('Heading: Step one');
    expect(after.svg).toContain('Heading: Step two');
    // The pixels differ, so a dependent step can perceive the change.
    expect(before.result.observation.screenshot).not.toEqual(after.result.observation.screenshot);
  });

  it('escapes page-derived text instead of letting it build SVG', async () => {
    const { svg } = await captionsOf([
      { x: 10, y: 10, width: 300, height: 30, kind: 'Button', text: '<rect/>&"x"' },
    ]);
    expect(svg).not.toContain('<rect/>&"x"');
    expect(svg).toContain('&lt;rect/&gt;');
  });

  it('renders a server-constant state and refuses an invented one', async () => {
    const { svg } = await captionsOf([
      { x: 10, y: 10, width: 150, height: 30, kind: 'Button', text: 'Save', state: 'disabled' },
    ]);
    expect(svg).toContain('Button (disabled): Save');

    const fixture = await input();
    fixture.image.layout = {
      revision: 'local',
      controls: [
        {
          x: 10,
          y: 10,
          width: 150,
          height: 30,
          kind: 'Button',
          state: 'exfiltrating' as never,
        },
      ],
    };
    await expect(redactor.redact(fixture)).rejects.toThrow();
  });

  it('honors cancellation before decoding', async () => {
    const fixture = await input();
    await expect(redactor.redact({ ...fixture, signal: AbortSignal.abort() })).rejects.toThrow();
  });
});
