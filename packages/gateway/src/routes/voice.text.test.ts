import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';
import {
  setVoiceSessionManager,
  type VoiceSessionManager,
} from '../services/voice/session-manager.js';

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

const post = (app: Hono, body: unknown) =>
  app.request('/voice/sessions/voice_1/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /voice/sessions/:id/text', () => {
  const sendText = vi.fn();

  beforeEach(() => {
    sendText.mockReset();
    setVoiceSessionManager({ sendText } as unknown as VoiceSessionManager);
  });

  afterEach(() => {
    setVoiceSessionManager(null);
  });

  it('sends trimmed text into the session', async () => {
    const res = await post(createApp(), { text: '  open YouTube  ' });

    expect(res.status).toBe(200);
    expect(sendText).toHaveBeenCalledWith('voice_1', 'default', 'open YouTube');
  });

  it.each([{}, { text: '   ' }, { text: 42 }, { text: 'x'.repeat(2001) }])(
    'rejects invalid text: %j',
    async (body) => {
      const res = await post(createApp(), body);

      expect(res.status).toBe(400);
      expect(sendText).not.toHaveBeenCalled();
    }
  );

  it('returns 404 for an unknown session', async () => {
    sendText.mockImplementation(() => {
      throw new Error('Session voice_1 not found or unauthorized');
    });

    expect((await post(createApp(), { text: 'hi' })).status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await post(createApp(false), { text: 'hi' })).status).toBe(401);
    expect(sendText).not.toHaveBeenCalled();
  });
});
