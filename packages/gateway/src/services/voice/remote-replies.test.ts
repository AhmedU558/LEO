import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProviderApiKey = vi.fn();
vi.mock('../agent/cache.js', () => ({
  getProviderApiKey: (p: string) => getProviderApiKey(p),
  loadProviderConfig: (p: string) =>
    p === 'openrouter' ? { baseUrl: 'https://openrouter.ai/api/v1' } : undefined,
  NATIVE_PROVIDERS: new Set(['openai', 'anthropic', 'google']),
}));

const complete = vi.fn();
const createProvider = vi.fn((_config: unknown) => ({ complete }));
vi.mock('@ownpilot/core/agent', () => ({
  createProvider: (config: unknown) => createProvider(config),
}));

const { checkRemoteProvider, remoteReply } = await import('./remote-replies.js');

const history = [
  { role: 'system', content: 'You are LEO.' },
  { role: 'user', content: 'Hi' },
];

describe('remote voice replies', () => {
  beforeEach(() => {
    getProviderApiKey.mockReset();
    complete.mockReset();
    createProvider.mockClear();
  });

  it('answers through an OpenAI-compatible provider with its configured base URL', async () => {
    getProviderApiKey.mockResolvedValue('sk-or-test');
    complete.mockResolvedValue({ ok: true, value: { content: 'Hello!' } });

    expect(await remoteReply('openrouter', 'z-ai/glm-5.3', history, 300)).toBe('Hello!');
    expect(createProvider).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-or-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      headers: undefined,
    });
    expect(complete).toHaveBeenCalledWith({
      messages: history,
      model: { model: 'z-ai/glm-5.3', maxTokens: 300, temperature: 0.7 },
    });
  });

  it('uses native providers directly', async () => {
    getProviderApiKey.mockResolvedValue('key');
    complete.mockResolvedValue({ ok: true, value: { content: 'Hi there.' } });

    await remoteReply('google', 'gemini-2.5-flash', history, 300);

    expect(createProvider.mock.calls[0]![0]).toMatchObject({ provider: 'google' });
  });

  it('reports provider errors and empty replies', async () => {
    getProviderApiKey.mockResolvedValue('key');
    complete.mockResolvedValueOnce({ ok: false, error: { message: '401 Unauthorized' } });
    await expect(remoteReply('openai', 'gpt-4o', history, 300)).rejects.toThrow(
      'openai: 401 Unauthorized'
    );

    complete.mockResolvedValueOnce({ ok: true, value: { content: '  ' } });
    await expect(remoteReply('openai', 'gpt-4o', history, 300)).rejects.toThrow('empty reply');
  });

  it('needs an API key', async () => {
    getProviderApiKey.mockResolvedValue(undefined);

    await expect(checkRemoteProvider('openai')).rejects.toThrow(
      'No API key is set for openai. Add it in Settings → Providers.'
    );
    await expect(remoteReply('openai', 'gpt-4o', history, 300)).rejects.toThrow('No API key');
    expect(complete).not.toHaveBeenCalled();
  });
});
