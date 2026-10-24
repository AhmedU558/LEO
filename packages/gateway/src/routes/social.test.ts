/**
 * Social routes tests.
 *
 * Collaborators are mocked so these pin the route's own behaviour: input
 * validation, status codes, error mapping, idempotency and duplicate handling,
 * and -- in every OAuth callback -- that the tokens are stored by the same
 * upsert that creates the account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const m = vi.hoisted(() => ({
  social: {
    listAccounts: vi.fn(),
    getAccountStatus: vi.fn(),
    createPublishTask: vi.fn(),
    getPublishStatus: vi.fn(),
    cancelPublish: vi.fn(),
    reconcilePublish: vi.fn(),
  },
  repo: { listPublishRequests: vi.fn(), createAccount: vi.fn(), storeCredentials: vi.fn() },
  provider: { connect: vi.fn() },
  registryGet: vi.fn(),
  media: { getMedia: vi.fn() },
  campaign: {
    listCampaigns: vi.fn(),
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    getCampaignTargets: vi.fn(),
    cancelCampaign: vi.fn(),
    reconcileCampaign: vi.fn(),
  },
  idem: { getRecord: vi.fn(), setRecord: vi.fn() },
  ctor: { social: vi.fn(), repo: vi.fn() },
}));

vi.mock('../services/social/service.js', () => ({
  SocialService: vi.fn(function (this: unknown, ...args: unknown[]) {
    m.ctor.social(...args);
    return m.social;
  }),
}));
vi.mock('../db/repositories/social.js', () => ({
  SocialRepository: vi.fn(function (this: unknown, ...args: unknown[]) {
    m.ctor.repo(...args);
    return m.repo;
  }),
}));
vi.mock('../services/social/provider-registry.js', () => ({
  socialProviderRegistry: { get: m.registryGet },
}));
vi.mock('../services/media/service.js', () => ({
  MediaService: vi.fn(function () {
    return m.media;
  }),
}));
vi.mock('../services/social/campaign-service.js', () => ({
  CampaignService: vi.fn(function () {
    return m.campaign;
  }),
}));
vi.mock('../db/repositories/idempotency-keys.js', () => ({
  getIdempotencyKeysRepository: () => m.idem,
}));

const { socialRoutes } = await import('./social.js');

const BASE = '/api/v1/social';

describe('social routes', () => {
  let app: Hono;
  const json = (body: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    m.registryGet.mockReturnValue(m.provider);
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userId' as never, 'user-1' as never);
      await next();
    });
    app.route(BASE, socialRoutes);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('accounts', () => {
    it('lists accounts for the caller and workspace', async () => {
      m.social.listAccounts.mockResolvedValueOnce([{ id: 'acc-1' }]);
      const res = await app.request(`${BASE}/accounts`, { headers: { 'X-Workspace-ID': 'ws-9' } });
      expect(res.status).toBe(200);
      expect((await res.json()).data.accounts).toEqual([{ id: 'acc-1' }]);
      expect(m.ctor.social).toHaveBeenCalledWith('user-1', 'ws-9');
    });

    it('reports one account’s status', async () => {
      m.social.getAccountStatus.mockResolvedValueOnce('active');
      const res = await app.request(`${BASE}/accounts/acc-1/status`);
      expect((await res.json()).data.status).toBe('active');
      expect(m.social.getAccountStatus).toHaveBeenCalledWith('acc-1');
    });
  });

  describe('publishing', () => {
    it('lists publish requests', async () => {
      m.repo.listPublishRequests.mockResolvedValueOnce([{ id: 'req-1' }]);
      const res = await app.request(`${BASE}/publish`);
      expect((await res.json()).data.content).toEqual([{ id: 'req-1' }]);
      expect(m.ctor.repo).toHaveBeenCalledWith('user-1', 'default');
    });

    it.each([
      ['text', { platform: 'youtube', accountId: 'a' }],
      ['platform', { text: 't', accountId: 'a' }],
      ['accountId', { text: 't', platform: 'youtube' }],
    ])('rejects a publish request without %s', async (_field, body) => {
      const res = await app.request(`${BASE}/publish`, json(body));
      expect(res.status).toBe(400);
      expect(m.social.createPublishTask).not.toHaveBeenCalled();
    });

    it('resolves only the media assets that exist', async () => {
      m.media.getMedia.mockImplementation(async (id: string) => (id === 'm-1' ? { id } : null));
      m.social.createPublishTask.mockResolvedValueOnce({ taskId: 't-1' });
      const res = await app.request(
        `${BASE}/publish`,
        json({ text: 't', platform: 'youtube', accountId: 'a', mediaAssetIds: ['m-1', 'gone'] })
      );
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ taskId: 't-1' });
      expect(m.social.createPublishTask.mock.calls[0]![0].media).toEqual([{ id: 'm-1' }]);
    });

    it('publishes with no media when none are referenced', async () => {
      m.social.createPublishTask.mockResolvedValueOnce({ taskId: 't-2' });
      await app.request(
        `${BASE}/publish`,
        json({ text: 't', platform: 'youtube', accountId: 'a' })
      );
      expect(m.media.getMedia).not.toHaveBeenCalled();
      expect(m.social.createPublishTask.mock.calls[0]![0].media).toEqual([]);
    });

    it('maps a publish failure to 500', async () => {
      m.social.createPublishTask.mockRejectedValueOnce(new Error('Account disconnected'));
      const res = await app.request(
        `${BASE}/publish`,
        json({ text: 't', platform: 'youtube', accountId: 'a' })
      );
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Account disconnected');
    });

    it('returns a publish request, or 404 when unknown', async () => {
      m.social.getPublishStatus.mockResolvedValueOnce({ id: 'req-1' });
      expect((await (await app.request(`${BASE}/publish/req-1`)).json()).data.request).toEqual({
        id: 'req-1',
      });
      m.social.getPublishStatus.mockResolvedValueOnce(null);
      expect((await app.request(`${BASE}/publish/missing`)).status).toBe(404);
    });

    it.each([
      ['cancel', 'cancelPublish', { success: true }],
      ['reconcile', 'reconcilePublish', { state: 'PUBLISHED' }],
    ] as const)('%s succeeds and maps failure to 500', async (action, method, ok) => {
      m.social[method].mockResolvedValueOnce(method === 'cancelPublish' ? true : ok);
      const res = await app.request(`${BASE}/publish/req-1/${action}`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual(ok);
      m.social[method].mockRejectedValueOnce(new Error('boom'));
      expect(
        (await app.request(`${BASE}/publish/req-1/${action}`, { method: 'POST' })).status
      ).toBe(500);
    });
  });

  describe('OAuth connect', () => {
    it.each([
      ['youtube', 'accounts.google.com'],
      ['instagram', 'www.facebook.com'],
      ['facebook', 'www.facebook.com'],
      ['tiktok', 'tiktok.com'],
    ])('%s redirects to the provider with a callback and state', async (platform, host) => {
      const res = await app.request(`http://leo.test${BASE}/${platform}/connect`);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.host).toContain(host);
      expect(location.searchParams.get('state')).toMatch(/^[0-9a-f-]{36}$/);
      const redirect =
        location.searchParams.get('redirect_uri') ?? location.searchParams.get('redirect_url');
      expect(redirect).toBe(`http://leo.test${BASE}/${platform}/callback`);
    });
  });

  describe('OAuth callbacks', () => {
    it.each(['youtube', 'instagram', 'facebook', 'tiktok'])(
      '%s rejects a callback without a code',
      async (platform) => {
        const res = await app.request(`${BASE}/${platform}/callback`);
        expect(res.status).toBe(400);
        expect(m.repo.createAccount).not.toHaveBeenCalled();
      }
    );

    it.each(['youtube', 'instagram', 'tiktok'])(
      '%s stores the tokens with the account in one upsert',
      async (platform) => {
        m.provider.connect.mockResolvedValueOnce({
          accountId: 'platform-42',
          accountName: 'Me',
          profileUrl: 'https://example.com/me',
          accessToken: 'access',
          refreshToken: 'refresh',
        });
        const res = await app.request(`http://leo.test${BASE}/${platform}/callback?code=abc`);
        expect(res.status).toBe(200);
        expect(m.provider.connect).toHaveBeenCalledWith(
          'abc',
          `http://leo.test${BASE}/${platform}/callback`
        );
        expect(m.repo.createAccount).toHaveBeenCalledWith(
          expect.objectContaining({
            platform,
            accountId: 'platform-42',
            accessToken: 'access',
            refreshToken: 'refresh',
            status: 'active',
          })
        );
        // A follow-up storeCredentials(platformId) matched against the internal
        // row id and so stored nothing.
        expect(m.repo.storeCredentials).not.toHaveBeenCalled();
      }
    );

    it.each(['youtube', 'instagram', 'tiktok'])(
      '%s maps a provider failure to 500',
      async (platform) => {
        m.provider.connect.mockRejectedValueOnce(new Error('invalid_grant'));
        const res = await app.request(`${BASE}/${platform}/callback?code=abc`);
        expect(res.status).toBe(500);
        expect((await res.json()).error.message).toBe('invalid_grant');
      }
    );

    describe('facebook', () => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

      it('connects every page that has a token, storing each token with its account', async () => {
        const fetch = vi
          .fn()
          .mockResolvedValueOnce(ok({ access_token: 'user-token' }))
          .mockResolvedValueOnce(
            ok({
              data: [
                { id: 'p1', name: 'Page One', access_token: 'tok-1' },
                { id: 'p2', name: 'No token' },
                { id: 'p3', name: 'Page Three', access_token: 'tok-3' },
              ],
            })
          );
        vi.stubGlobal('fetch', fetch);
        const res = await app.request(`${BASE}/facebook/callback?code=abc`);
        expect(res.status).toBe(200);
        expect(m.repo.createAccount).toHaveBeenCalledTimes(2);
        expect(m.repo.createAccount).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ platform: 'facebook', accountId: 'p1', accessToken: 'tok-1' })
        );
        expect(m.repo.createAccount).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ accountId: 'p3', accessToken: 'tok-3' })
        );
        expect(m.repo.storeCredentials).not.toHaveBeenCalled();
        expect(fetch.mock.calls[1]![0]).toContain('access_token=user-token');
      });

      it('names a page by its id when Facebook omits the name, instead of failing the batch', async () => {
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce(ok({ access_token: 't' }))
            .mockResolvedValueOnce(ok({ data: [{ id: 'p9', access_token: 'tok-9' }] }))
        );
        const res = await app.request(`${BASE}/facebook/callback?code=abc`);
        expect(res.status).toBe(200);
        expect(m.repo.createAccount).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: 'p9', accountName: 'p9', accessToken: 'tok-9' })
        );
      });

      it('handles an account with no pages', async () => {
        vi.stubGlobal(
          'fetch',
          vi
            .fn()
            .mockResolvedValueOnce(ok({ access_token: 't' }))
            .mockResolvedValueOnce(ok({}))
        );
        const res = await app.request(`${BASE}/facebook/callback?code=abc`);
        expect(res.status).toBe(200);
        expect(m.repo.createAccount).not.toHaveBeenCalled();
      });

      it.each([
        ['the code exchange', [new Response('', { status: 400 })], 'Failed to exchange code'],
        [
          'the page lookup',
          [ok({ access_token: 't' }), new Response('', { status: 500 })],
          'Failed to fetch pages',
        ],
      ])('reports a failure in %s', async (_step, responses, message) => {
        const fetch = vi.fn();
        for (const r of responses) fetch.mockResolvedValueOnce(r);
        vi.stubGlobal('fetch', fetch);
        const res = await app.request(`${BASE}/facebook/callback?code=abc`);
        expect(res.status).toBe(500);
        expect((await res.json()).error.message).toBe(message);
      });
    });
  });

  describe('campaigns', () => {
    const body = { contentItemId: 'item-1', scheduledFor: '2026-05-01T09:00:00Z' };

    it('returns the cached result for a repeated idempotency key', async () => {
      m.idem.getRecord.mockResolvedValueOnce({ result: { id: 'camp-1', status: 'FAILED' } });
      const res = await app.request(`${BASE}/campaigns`, {
        ...json(body),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-1' },
      });
      expect((await res.json()).data).toEqual({ id: 'camp-1', status: 'FAILED' });
      expect(m.idem.getRecord).toHaveBeenCalledWith('user-1', 'k-1');
      expect(m.campaign.createCampaign).not.toHaveBeenCalled();
    });

    it('returns an existing live campaign instead of creating a duplicate', async () => {
      m.campaign.listCampaigns.mockResolvedValueOnce([
        { id: 'old', ...body, status: 'CANCELLED' },
        { id: 'live', ...body, status: 'SCHEDULED' },
      ]);
      const res = await app.request(`${BASE}/campaigns`, json(body));
      expect((await res.json()).data.id).toBe('live');
      expect(m.campaign.createCampaign).not.toHaveBeenCalled();
    });

    it('creates a campaign and records its idempotency key', async () => {
      m.idem.getRecord.mockResolvedValueOnce(null);
      m.campaign.listCampaigns.mockResolvedValueOnce([{ id: 'x', ...body, status: 'FAILED' }]);
      m.campaign.createCampaign.mockResolvedValueOnce({ id: 'new' });
      const res = await app.request(`${BASE}/campaigns`, {
        ...json(body),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-2' },
      });
      expect((await res.json()).data).toEqual({ id: 'new' });
      expect(m.idem.setRecord).toHaveBeenCalledWith('user-1', 'k-2', { id: 'new' });
    });

    it('creates without recording when no idempotency key is sent', async () => {
      m.campaign.listCampaigns.mockResolvedValueOnce([]);
      m.campaign.createCampaign.mockResolvedValueOnce({ id: 'new' });
      await app.request(`${BASE}/campaigns`, json(body));
      expect(m.idem.setRecord).not.toHaveBeenCalled();
    });

    it('maps a creation failure to 400', async () => {
      m.campaign.listCampaigns.mockResolvedValueOnce([]);
      m.campaign.createCampaign.mockRejectedValueOnce(new Error('Unknown content item'));
      const res = await app.request(`${BASE}/campaigns`, json(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toBe('Unknown content item');
    });

    it('lists campaigns', async () => {
      m.campaign.listCampaigns.mockResolvedValueOnce([{ id: 'c' }]);
      expect((await (await app.request(`${BASE}/campaigns`)).json()).data).toEqual([{ id: 'c' }]);
    });

    it('returns a campaign with its targets, or 404', async () => {
      m.campaign.getCampaign.mockResolvedValueOnce({ id: 'c' });
      m.campaign.getCampaignTargets.mockResolvedValueOnce([{ id: 't' }]);
      expect((await (await app.request(`${BASE}/campaigns/c`)).json()).data).toEqual({
        id: 'c',
        targets: [{ id: 't' }],
      });
      m.campaign.getCampaign.mockResolvedValueOnce(null);
      expect((await app.request(`${BASE}/campaigns/missing`)).status).toBe(404);
    });

    it('cancels a campaign and maps failure to 500', async () => {
      m.campaign.cancelCampaign.mockResolvedValueOnce(undefined);
      const res = await app.request(`${BASE}/campaigns/c/cancel`, { method: 'POST' });
      expect((await res.json()).data).toEqual({ success: true });
      m.campaign.cancelCampaign.mockRejectedValueOnce(new Error('Already published'));
      expect((await app.request(`${BASE}/campaigns/c/cancel`, { method: 'POST' })).status).toBe(
        500
      );
    });

    it('reconciles a campaign and returns its fresh state', async () => {
      m.campaign.reconcileCampaign.mockResolvedValueOnce(undefined);
      m.campaign.getCampaign.mockResolvedValueOnce({ id: 'c', status: 'PUBLISHED' });
      m.campaign.getCampaignTargets.mockResolvedValueOnce([]);
      const res = await app.request(`${BASE}/campaigns/c/reconcile`, { method: 'POST' });
      expect((await res.json()).data).toEqual({ id: 'c', status: 'PUBLISHED', targets: [] });
      m.campaign.reconcileCampaign.mockRejectedValueOnce(new Error('Provider down'));
      expect((await app.request(`${BASE}/campaigns/c/reconcile`, { method: 'POST' })).status).toBe(
        500
      );
    });
  });
});
