// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { render, cleanup, flushAsyncUpdates, hasText } from '../test-harness';
import { LeoConsolePage } from './LeoConsolePage';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const HEALTH = {
  status: 'healthy',
  checks: [
    { name: 'core', status: 'pass' },
    { name: 'database', status: 'pass' },
  ],
};
const SESSION = { id: 'voice_123_abcdef', userId: 'u', status: 'connected', messages: [] };

/** Gateway responses keyed by path; real envelope shape ({ success, data }). */
const RESPONSES: Array<[RegExp, unknown]> = [
  [/^\/health$/, HEALTH],
  [
    /\/health\/metrics/,
    {
      cpu: { percent: 37, cores: 12 },
      memory: { total: 100, used: 50 },
      disk: { total: 200, free: 50 },
      uptime: 7200,
    },
  ],
  [
    /\/summary/,
    {
      tasks: { total: 5, pending: 3, completed: 2, overdue: 2, dueToday: 1 },
      notes: { total: 0, recent: 0, pinned: 0 },
      bookmarks: { total: 0, favorites: 0 },
      calendar: { total: 1, today: 1, upcoming: 0 },
      contacts: { total: 0, favorites: 0, upcomingBirthdays: 0 },
    },
  ],
  [
    /\/agents/,
    {
      items: [
        {
          id: 'a1',
          name: 'Research Agent',
          provider: 'ollama',
          model: 'qwen3',
          tools: [],
          createdAt: '',
        },
      ],
    },
  ],
  [
    /\/providers/,
    {
      providers: [
        {
          id: 'ollama',
          name: 'Ollama',
          type: 'local',
          apiKeyEnv: '',
          isConfigured: true,
          isEnabled: true,
          hasOverride: false,
          modelCount: 2,
        },
      ],
      total: 1,
    },
  ],
  [
    /\/tasks/,
    [
      {
        id: 't1',
        title: 'Ship the console',
        status: 'pending',
        priority: 'high',
        dueDate: '2026-10-26',
        tags: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
  ],
  [
    /\/memories\/stats/,
    { total: 42, byType: { fact: 30, preference: 12 }, avgImportance: 0.5, recentCount: 3 },
  ],
  [/\/workflows\/logs\/recent/, { logs: [], total: 0, limit: 4, offset: 0, hasMore: false }],
  [/\/voice\/sessions/, SESSION],
];

function fakeFetch(input: RequestInfo | URL) {
  const path = new URL(String(input), 'http://localhost').pathname;
  const match = RESPONSES.find(([re]) => re.test(path));
  const data = match ? match[1] : {};
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

const mount = () =>
  render(
    <MemoryRouter>
      <LeoConsolePage />
    </MemoryRouter>
  );

describe('LeoConsolePage (Command Center)', () => {
  beforeEach(() => {
    localStorage.clear();
    class MockEventSource {
      addEventListener = vi.fn();
      close = vi.fn();
    }
    vi.stubGlobal('EventSource', MockEventSource);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
      configurable: true,
    });
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('mounts offline and fills every panel from real endpoints', async () => {
    const container = mount();
    await flushAsyncUpdates();
    await flushAsyncUpdates();

    const text = container.textContent ?? '';
    expect(text).toContain('System optimal');
    expect(text).toContain('42 stored');
    expect(text).toContain('2 tasks overdue');
    expect(text).toContain('1 events today');
    expect(hasText(container, 'Research Agent')).toBe(true);
    expect(hasText(container, 'Ship the console')).toBe(true);
    expect(hasText(container, 'Ollama')).toBe(true);
    expect(container.querySelector('[aria-label="CPU 37%"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Disk 75%"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Start a voice session"]')).toBeTruthy();
  });

  it('shows empty states when the data endpoints fail', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error('down')));
    const container = mount();
    await flushAsyncUpdates();
    await flushAsyncUpdates();
    expect(hasText(container, 'All quiet') || hasText(container, 'Gateway unreachable')).toBe(true);
    expect(hasText(container, 'No upcoming deadlines')).toBe(true);
  });

  it('starts a session with the chosen speech output when the core is pressed', async () => {
    const container = mount();
    await flushAsyncUpdates();

    const select = container.querySelector<HTMLSelectElement>('#leo-speech-output')!;
    act(() => {
      select.value = 'local-gradium';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const core = container.querySelector<HTMLButtonElement>(
      '[aria-label="Start a voice session"]'
    )!;
    await act(async () => {
      core.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flushAsyncUpdates();

    const create = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/v1/voice/sessions');
    expect(JSON.parse((create?.[1] as RequestInit).body as string).provider).toBe('local-gradium');
    expect(hasText(container, 'Standing by')).toBe(true);
    expect(container.querySelector('[aria-label="Hold to talk to LEO"]')).toBeTruthy();
  });

  it('remembers the "Hey Leo" switch', async () => {
    const container = mount();
    await flushAsyncUpdates();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('leo-wake-word')).toBe('1');
  });

  it('stops polling on unmount', async () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    mount();
    await flushAsyncUpdates();
    cleanup();
    expect(clear).toHaveBeenCalled();
  });
});
