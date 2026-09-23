import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIComputerActionProposer,
  parseComputerProposal,
  COMPUTER_MODEL_LIMITS,
} from './model-adapter.js';
import { COMPUTER_VIEWPORT, type ComputerModelObservation } from './provider.js';
import * as debug from '../agent/debug.js';

const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.writeUInt32BE(1280, 16);
png.writeUInt32BE(800, 20);
const observation: ComputerModelObservation = {
  screenshot: png.toString('base64'),
  viewport: COMPUTER_VIEWPORT,
  untrusted: true,
  disclosure: 'redacted',
};
const proposal = (type = 'click', params: Record<string, unknown> = { x: 10, y: 20 }) => ({
  type,
  params,
  viewport: COMPUTER_VIEWPORT,
});
const envelope = (content: string, finish_reason: unknown = 'stop') => ({
  choices: [{ message: { content }, finish_reason }],
});
const request = () => ({ observation, signal: new AbortController().signal });
const adapter = () =>
  new OpenAIComputerActionProposer({ apiKey: 'test-only-key', model: 'gpt-4o' });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('strict computer model proposals', () => {
  it.each([
    ['screenshot', {}],
    ['mouseMove', { x: 0, y: 0 }],
    ['click', { x: 1279, y: 799 }],
    ['doubleClick', { x: 1, y: 2 }],
    ['mouseDown', { x: 1, y: 2 }],
    ['mouseUp', { x: 1, y: 2 }],
    ['scroll', { deltaX: 0, deltaY: 800 }],
    ['keyPress', { key: 'Enter' }],
    ['typeText', { text: 'Plain text' }],
    ['hotkey', { keys: ['Control', 'A'] }],
  ])('accepts known action %s', (type, params) => {
    expect(
      parseComputerProposal(
        JSON.stringify(proposal(type as string, params as Record<string, unknown>))
      ).type
    ).toBe(type);
  });
  it.each([
    'execute_shell',
    'read_file',
    'write_file',
    'navigate',
    'fetch',
    'clipboard',
    'constructor',
    '__proto__',
  ])('rejects %s', (type) => {
    expect(() => parseComputerProposal(JSON.stringify(proposal(type, {})))).toThrow();
  });
  it.each([
    '',
    'null',
    '[]',
    '{}',
    '```json\n{}\n```',
    JSON.stringify({ ...proposal(), capability: 'system.execute' }),
    JSON.stringify({ ...proposal(), userId: 'other' }),
    JSON.stringify({ ...proposal(), workspaceId: 'other' }),
    JSON.stringify({ ...proposal(), executionTaskId: 'other' }),
    JSON.stringify({ ...proposal(), sessionId: 'other' }),
    JSON.stringify({ ...proposal(), viewport: { width: 1920, height: 1080 } }),
    JSON.stringify(proposal('click', { x: -1, y: 0 })),
    JSON.stringify(proposal('click', { x: 1280, y: 0 })),
    JSON.stringify(proposal('click', { x: Infinity, y: 0 })),
    JSON.stringify(proposal('click', { x: '1', y: 0 })),
    JSON.stringify(proposal('click', { x: 1, y: 2, selector: 'body' })),
    JSON.stringify(proposal('scroll', { deltaX: 0, deltaY: 801 })),
    JSON.stringify(proposal('typeText', { text: 'x'.repeat(2001) })),
    JSON.stringify(proposal('typeText', { text: 'fetch("https://example.com")' })),
    JSON.stringify(proposal('typeText', { text: 'powershell' })),
    JSON.stringify(proposal('hotkey', { keys: ['Control', 'V'] })),
    JSON.stringify(proposal('keyPress', { key: 'Meta' })),
    ' '.repeat(COMPUTER_MODEL_LIMITS.responseBytes + 1),
  ])('denies malformed or unsafe output %#', (raw) =>
    expect(() => parseComputerProposal(raw)).toThrow()
  );
});

describe('real OpenAI adapter transport with local fixtures', () => {
  it('uses the existing provider, sends only the image/instructions, and never logs payloads', async () => {
    const logs = [
      vi.spyOn(debug, 'logRequest'),
      vi.spyOn(debug, 'logResponse'),
      vi.spyOn(debug, 'logError'),
    ];
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(envelope(JSON.stringify(proposal())))));
    vi.stubGlobal('fetch', fetch);
    expect(await adapter().propose(request())).toEqual(proposal());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.tools).toBeUndefined();
    expect(body.user).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    expect(init.body).not.toContain('test-only-key');
    expect(init.redirect).toBe('error');
    expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
  });
  it.each([undefined, 'length', 'tool_calls', 'content_filter', 'mystery'])(
    'rejects unverified provider finish status %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                { message: { content: JSON.stringify(proposal()) }, finish_reason: status },
              ],
            })
          )
        )
      );
      await expect(adapter().propose(request())).rejects.toThrow();
    }
  );
  it.each(['', '{}', ' '.repeat(20000)])(
    'rejects empty, malformed or oversized response %#',
    async (content) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope(content))))
      );
      await expect(adapter().propose(request())).rejects.toThrow();
    }
  );
  it('never retries provider failures or logs raw errors', async () => {
    const log = vi.spyOn(debug, 'logError');
    const fetch = vi.fn().mockRejectedValue(new Error('SECRET'));
    vi.stubGlobal('fetch', fetch);
    await expect(adapter().propose(request())).rejects.toThrow('unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
  it('requires credentials without fabricating success', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      new OpenAIComputerActionProposer({ apiKey: '', model: 'gpt-4o' }).propose(request())
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['timeout', 'cancel'])('aborts a pending model request on %s', async (mode) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          })
      )
    );
    const result = adapter()
      .propose({ observation, signal: controller.signal })
      .catch((error: unknown) => error);
    if (mode === 'cancel') controller.abort();
    else await vi.advanceTimersByTimeAsync(COMPUTER_MODEL_LIMITS.timeoutMs);
    expect(await result).toMatchObject({ code: mode === 'cancel' ? 'CANCELLED' : 'TIMEOUT' });
  });
  it('rejects unredacted or oversized observations before contacting the model', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      adapter().propose({
        ...request(),
        observation: { ...observation, disclosure: 'raw' } as unknown as ComputerModelObservation,
      })
    ).rejects.toThrow();
    await expect(
      adapter().propose({
        ...request(),
        observation: { ...observation, screenshot: 'A'.repeat(6000000) },
      })
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
