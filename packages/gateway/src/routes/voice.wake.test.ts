import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

const transcribeLocally = vi.fn();
vi.mock('../services/voice/providers/local-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/voice/providers/local-provider.js')>()),
  transcribeLocally: (...args: unknown[]) => transcribeLocally(...args),
}));

const { voiceRoutes } = await import('./voice.js');

function createApp(authenticated = true) {
  const app = new Hono();
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('userId', 'default');
    if (authenticated) c.set('sessionAuthenticated', true);
    await next();
  });
  app.route('/voice', voiceRoutes);
  app.onError(errorHandler);
  return app;
}

const clip = (bytes: number) => Buffer.alloc(bytes).toString('base64');
const post = (app: Hono, body: unknown) =>
  app.request('/voice/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /voice/wake', () => {
  beforeEach(() => {
    transcribeLocally.mockReset();
  });

  it('detects the wake phrase with local Whisper, biased toward it', async () => {
    transcribeLocally.mockResolvedValue('Hey Leo.');
    const res = await post(createApp(), { audio: clip(32000), sampleRate: 16000 });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ detected: true, text: 'Hey Leo.' });
    const [audio, rate, signal, prompt] = transcribeLocally.mock.calls[0]!;
    expect(audio).toBe(clip(32000));
    expect(rate).toBe(16000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(prompt).toBe('Hey Leo.');
  });

  it('reports ordinary speech as not detected', async () => {
    transcribeLocally.mockResolvedValue('what time is it');
    const res = await post(createApp(), { audio: clip(3200), sampleRate: 24000 });
    expect((await res.json()).data.detected).toBe(false);
  });

  it.each([
    [{ sampleRate: 16000 }, 'missing audio'],
    [{ audio: clip(10), sampleRate: 44100 }, 'unsupported rate'],
    [{ audio: clip(16000 * 2 * 5), sampleRate: 16000 }, 'clip over 4 s'],
  ])('rejects %j (%s) without transcribing', async (body) => {
    const res = await post(createApp(), body);
    expect(res.status).toBe(400);
    expect(transcribeLocally).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await post(createApp(false), { audio: clip(10), sampleRate: 16000 });
    expect(res.status).toBe(401);
  });

  it('runs one check per user at a time', async () => {
    let finish!: (text: string) => void;
    transcribeLocally.mockReturnValue(new Promise<string>((r) => (finish = r)));
    const app = createApp();
    const first = post(app, { audio: clip(10), sampleRate: 16000 });
    await vi.waitFor(() => expect(transcribeLocally).toHaveBeenCalled());

    const second = await post(app, { audio: clip(10), sampleRate: 16000 });
    expect(second.status).toBe(429);

    finish('hey leo');
    expect((await first).status).toBe(200);
  });

  it('returns 503 when local Whisper fails', async () => {
    transcribeLocally.mockImplementation(async () => {
      throw new Error('python missing');
    });
    const res = await post(createApp(), { audio: clip(10), sampleRate: 16000 });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('python missing');
  });
});
