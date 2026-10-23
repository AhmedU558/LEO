// @vitest-environment happy-dom

/**
 * SocialPage smoke test.
 *
 * This page shipped in 9e9a347b with no import statements at all and with
 * references to `PageContainer` and `Card`, neither of which exists in this
 * codebase — it had never compiled or rendered. The test pins the repaired
 * page to the shape the other page tests use: it mounts, fires its data calls,
 * renders populated data, renders the empty state, and survives a failing API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flushAsyncUpdates, hasText, render } from '../test-harness';
import { SocialPage } from './SocialPage';

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('../components/ToastProvider', () => ({ useToast: () => mockToast }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    passwordConfigured: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshStatus: vi.fn(),
  }),
}));

const account = {
  id: 'acc-1',
  userId: 'u-1',
  platform: 'youtube',
  accountId: 'yt-1',
  accountName: 'LEO Channel',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const campaign = {
  id: 'camp-1',
  userId: 'u-1',
  workspaceId: 'w-1',
  contentItemId: 'content-1',
  status: 'PUBLISHING',
  version: 1,
  createdAt: '2026-01-02T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/** The page talks to the gateway through bare `fetch`, not the api barrel. */
function stubFetch(routes: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.keys(routes).find((r) => url.includes(r));
    if (!match) return Promise.reject(new Error(`unexpected request: ${url}`));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(routes[match]) } as Response);
  });
}

describe('SocialPage', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('fires its data calls and renders accounts and campaigns', async () => {
    const fetchMock = stubFetch({
      '/social/accounts': { data: [account] },
      '/social/campaigns': { data: [campaign] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = render(<SocialPage />);
    await flushAsyncUpdates();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/v1/social/accounts'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/v1/social/campaigns'))).toBe(true);

    expect(hasText(container, 'Social Publishing')).toBe(true);
    expect(hasText(container, 'LEO Channel')).toBe(true);
    expect(hasText(container, 'PUBLISHING')).toBe(true);
  });

  it('renders the empty state when nothing is connected', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/social/': { data: [] } }));

    const container = render(<SocialPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'No accounts connected yet.')).toBe(true);
    expect(hasText(container, 'No campaigns available.')).toBe(true);
  });

  it('survives a failing API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('gateway down')))
    );

    const container = render(<SocialPage />);
    await flushAsyncUpdates();

    expect(hasText(container, 'Social Publishing')).toBe(true);
  });
});
