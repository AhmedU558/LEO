import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';
import {
  setVoiceSessionManager,
  type VoiceSessionManager,
} from '../services/voice/session-manager.js';

// A plain function, not vi.fn(): vitest tracks a vi.fn's returned promise and
// reports a rejected one as a test error even when the route catches it.
let listOllamaModels: () => Promise<unknown> = async () => [];
vi.mock('../services/voice/providers/local-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/voice/providers/local-provider.js')>()),
  listOllamaModels: () => listOllamaModels(),
}));

const { voiceRoutes } = await import('./voice.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('userId', 'default');
    c.set('sessionAuthenticated', true);
    await next();
  });
  app.route('/voice', voiceRoutes);
  app.onError(errorHandler);
  return app;
}

describe('GET /voice/models', () => {
  it('lists Ollama models with the default', async () => {
    listOllamaModels = async () => [{ name: 'gemma4:31b-cloud', cloud: true, sizeBytes: 384 }];

    const res = await createApp().request('/voice/models');

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      models: [{ name: 'gemma4:31b-cloud', cloud: true, sizeBytes: 384 }],
      default: 'qwen3:4b-instruct',
    });
  });

  it('reports 503 when Ollama is not running', async () => {
    listOllamaModels = async () => {
      throw new Error("Ollama isn't running.");
    };

    const res = await createApp().request('/voice/models');

    expect(res.status).toBe(503);
    expect((await res.json()).error.message).toContain("Ollama isn't running");
  });
});

describe('POST /voice/sessions with a model', () => {
  const createSession = vi.fn(async () => ({ id: 'voice_1' }));
  const post = (body: unknown) =>
    createApp().request('/voice/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    createSession.mockClear();
    setVoiceSessionManager({ createSession } as unknown as VoiceSessionManager);
  });

  afterEach(() => setVoiceSessionManager(null));

  it('passes a valid model name through', async () => {
    const res = await post({ provider: 'local', model: 'gemma4:31b-cloud' });

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(
      'default',
      expect.anything(),
      expect.objectContaining({ model: 'gemma4:31b-cloud' })
    );
  });

  it.each(['', 'a b', 'x'.repeat(121), 'model;rm -rf'])('rejects model %j', async (model) => {
    expect((await post({ model })).status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});
