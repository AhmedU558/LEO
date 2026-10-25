import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config: Record<string, string | undefined> = {};
vi.mock('@ownpilot/core/services', () => ({
  getConfigCenter: () => ({
    getApiKey: () => config.api_key,
    getFieldValue: (_service: string, field: string) => config[field],
  }),
}));

const { streamGradiumSpeech, gradiumSpeech, GRADIUM_MAX_CHARS } = await import('./gradium-tts.js');

const KEY = 'gd_test_key_never_shown';
const VOICE = 'AmZXCTQPK0hzJlcw';

function audioResponse(chunks: Uint8Array[], contentType = 'audio/pcm'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

function collect() {
  const chunks: Buffer[] = [];
  return { chunks, onPcm: (pcm: Buffer) => chunks.push(Buffer.from(pcm)) };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  Object.assign(config, {
    api_key: KEY,
    voice_id: VOICE,
    base_url: undefined,
    model_name: undefined,
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('streamGradiumSpeech', () => {
  it('posts the reply text with the configured voice and server-side key', async () => {
    fetchMock.mockResolvedValue(audioResponse([new Uint8Array(4)]));
    await streamGradiumSpeech('Hello there.', new AbortController().signal, () => {});

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.gradium.ai/api/post/speech/tts');
    expect((init!.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(init!.body as string)).toEqual({
      text: 'Hello there.',
      voice_id: VOICE,
      output_format: 'pcm_24000',
      model_name: 'default',
      only_audio: true,
    });
  });

  it('uses a configured base URL without doubling slashes', async () => {
    config.base_url = 'https://eu.api.gradium.ai/api/';
    fetchMock.mockResolvedValue(audioResponse([new Uint8Array(2)]));
    await streamGradiumSpeech('Hi.', new AbortController().signal, () => {});
    expect(fetchMock.mock.calls[0]![0]).toBe('https://eu.api.gradium.ai/api/post/speech/tts');
  });

  it('accepts raw PCM labelled application/octet-stream, as the live API sends it', async () => {
    fetchMock.mockResolvedValue(audioResponse([new Uint8Array(4)], 'application/octet-stream'));
    const { chunks, onPcm } = collect();
    await streamGradiumSpeech('Hi.', new AbortController().signal, onPcm);
    expect(Buffer.concat(chunks)).toHaveLength(4);
  });

  it('re-aligns odd network chunks so no 16-bit sample is split', async () => {
    const pcm = Uint8Array.from({ length: 30001 * 2 }, (_, i) => i % 256);
    fetchMock.mockResolvedValue(
      audioResponse([pcm.subarray(0, 24001), pcm.subarray(24001, 50001), pcm.subarray(50001)])
    );
    const { chunks, onPcm } = collect();
    await streamGradiumSpeech('Long reply.', new AbortController().signal, onPcm);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length % 2 === 0)).toBe(true);
    expect(Buffer.concat(chunks).equals(Buffer.from(pcm))).toBe(true);
  });

  it('fails clearly without making a request when the key or voice is missing', async () => {
    config.api_key = undefined;
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(/GRADIUM_API_KEY/);
    config.api_key = KEY;
    config.voice_id = undefined;
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(/GRADIUM_VOICE_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => gradiumSpeech.check()).toThrow(/voice/);
  });

  it.each([
    [500, 'error from server 1008: API key is revoked or expired', /code 1008: API key is revoked/],
    [500, 'error from server 1008: voice not found', /code 1008: voice not found/],
    [401, '', /rejected the API key/],
    [404, '', /could not find/],
    [402, '', /credits are exhausted/],
    [429, '', /rate limit/],
    [503, 'upstream busy', /HTTP 503: upstream busy/],
  ])('maps HTTP %i failures to a sanitized message', async (status, body, message) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(message);
  });

  it('never repeats the API key in an error', async () => {
    fetchMock.mockResolvedValue(
      new Response(`error from server 1008: bad key ${KEY}`, { status: 500 })
    );
    const error = await streamGradiumSpeech('Hi.', new AbortController().signal, () => {}).catch(
      (e: Error) => e
    );
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message).toContain('[redacted]');
  });

  it('rejects a non-audio body as malformed', async () => {
    fetchMock.mockResolvedValue(
      audioResponse([new TextEncoder().encode('{"type":"error"}')], 'application/json')
    );
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(/unexpected response/);
  });

  it('rejects an empty audio body', async () => {
    fetchMock.mockResolvedValue(audioResponse([]));
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(/no audio/);
  });

  it('refuses text over the free-tier per-session limit without a request', async () => {
    await expect(
      streamGradiumSpeech('x'.repeat(GRADIUM_MAX_CHARS + 1), new AbortController().signal, () => {})
    ).rejects.toThrow(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a timeout', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(
      streamGradiumSpeech('Hi.', new AbortController().signal, () => {})
    ).rejects.toThrow(/timed out/);
  });

  it('passes the abort signal to fetch and rejects as aborted on cancellation', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = streamGradiumSpeech('Hi.', controller.signal, () => {});
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
