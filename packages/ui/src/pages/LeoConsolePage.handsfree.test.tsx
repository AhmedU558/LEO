// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { render, cleanup, flushAsyncUpdates } from '../test-harness';
import { LeoConsolePage } from './LeoConsolePage';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// Capture the page's wake callback instead of running the microphone detector.
let fireWake: () => void = () => {};
vi.mock('../hooks/useWakeWord', () => ({
  useWakeWord: ({ onWake }: { onWake: () => void }) => {
    fireWake = onWake;
    return { state: 'listening', error: null };
  },
  useSilenceStop: vi.fn(),
}));

const SESSION = {
  id: 'voice_1',
  userId: 'u',
  provider: 'local',
  status: 'connected',
  messages: [],
};

/** Minimal gateway data in the real response shapes (see LeoConsolePage.test.tsx). */
const RESPONSES: Array<[RegExp, unknown]> = [
  [/^\/health$/, { status: 'healthy', checks: [] }],
  [
    /\/health\/metrics/,
    {
      cpu: { percent: 1, cores: 1 },
      memory: { total: 1, used: 0 },
      disk: { total: 1, free: 1 },
      uptime: 1,
    },
  ],
  [/\/voice\/sessions/, SESSION],
  [/\/tasks/, []],
  [
    /\/summary/,
    {
      tasks: { total: 0, pending: 0, completed: 0, overdue: 0, dueToday: 0 },
      notes: { total: 0, recent: 0, pinned: 0 },
      bookmarks: { total: 0, favorites: 0 },
      calendar: { total: 0, today: 0, upcoming: 0 },
      contacts: { total: 0, favorites: 0, upcomingBirthdays: 0 },
    },
  ],
  [/\/memories\/stats/, { total: 0, byType: {}, avgImportance: 0, recentCount: 0 }],
  [/\/agents/, { items: [] }],
  [/\/providers/, { providers: [], total: 0 }],
  [/\/workflows\/logs\/recent/, { logs: [], total: 0, limit: 4, offset: 0, hasMore: false }],
];

function fakeFetch(input: RequestInfo | URL) {
  const path = new URL(String(input), 'http://localhost').pathname;
  const data = RESPONSES.find(([re]) => re.test(path))?.[1] ?? {};
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

describe('LeoConsolePage hands-free and typed turns', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener = vi.fn();
        close = vi.fn();
      }
    );
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts a turn when the session is already connected', async () => {
    const container = render(
      <MemoryRouter>
        <LeoConsolePage />
      </MemoryRouter>
    );
    await flushAsyncUpdates();

    // Bring the session online first, as after an earlier turn.
    const core = container.querySelector<HTMLButtonElement>(
      '[aria-label="Start a voice session"]'
    )!;
    await act(async () => {
      core.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushAsyncUpdates();
    expect(container.querySelector('[aria-label="Hold to talk to LEO"]')).toBeTruthy();
    const before = getUserMedia.mock.calls.length;

    await act(async () => {
      fireWake();
    });
    await flushAsyncUpdates();

    // The hands-free turn opens the microphone to record.
    expect(getUserMedia.mock.calls.length).toBeGreaterThan(before);
  });

  it('starts the session for a typed message, then sends it to be answered aloud', async () => {
    const container = render(
      <MemoryRouter>
        <LeoConsolePage />
      </MemoryRouter>
    );
    await flushAsyncUpdates();

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="Type a message to LEO"]'
    )!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'open YouTube');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushAsyncUpdates();
    await flushAsyncUpdates();

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.some(([url]) => url === '/api/v1/voice/sessions')).toBe(true);
    const sent = calls.find(([url]) => url === '/api/v1/voice/sessions/voice_1/text');
    expect(JSON.parse((sent?.[1] as RequestInit).body as string)).toEqual({
      text: 'open YouTube',
    });
    expect(input.value).toBe('');
  });
});
