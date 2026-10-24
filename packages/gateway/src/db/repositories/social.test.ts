/**
 * SocialRepository tests.
 *
 * Every query must be scoped to the caller's user and workspace, and every SQL
 * placeholder must actually be bound. Three of these tests pin defects that only
 * surfaced against a real database: unbound `status = 1` literals in the two
 * campaign updates, a nonexistent `token_expires_at` column, and an unscoped
 * getPost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();
vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { SocialRepository } = await import('./social.js');

const lastCall = (fn: typeof mockAdapter.execute) => fn.mock.calls.at(-1) as [string, unknown[]];

/**
 * Every `$n` in the SQL must exist in the parameter list, and the WHERE clause
 * must bind id, user and workspace -- not whatever happens to sit at a
 * miscounted index.
 */
function expectBound(sql: string, params: unknown[], id: string) {
  const used = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  expect(used.length).toBeGreaterThan(0);
  expect(Math.max(...used)).toBe(params.length);
  const where = /WHERE id = \$(\d+) AND user_id = \$(\d+) AND workspace_id = \$(\d+)/.exec(sql);
  expect(where).not.toBeNull();
  const [, i, u, w] = where!.map(Number);
  expect([params[i! - 1], params[u! - 1], params[w! - 1]]).toEqual([id, 'user-1', 'ws-1']);
}

describe('SocialRepository', () => {
  let repo: InstanceType<typeof SocialRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new SocialRepository('user-1', 'ws-1');
  });

  it('refuses to construct without a full identity', () => {
    expect(() => new SocialRepository('', 'ws-1')).toThrow('Social identity required');
    expect(() => new SocialRepository('user-1', '')).toThrow('Social identity required');
  });

  describe('accounts', () => {
    it('reads one account scoped to the caller', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'acc-1' });
      expect(await repo.getAccount('acc-1')).toEqual({ id: 'acc-1' });
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id=$1 AND user_id=$2 AND workspace_id=$3');
      expect(params).toEqual(['acc-1', 'user-1', 'ws-1']);
    });

    it('lists the caller’s accounts', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
      expect(await repo.listAccounts()).toHaveLength(2);
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['user-1', 'ws-1']);
    });

    it('creates or refreshes an account together with its credentials', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'acc-1', platform: 'tiktok' });
      const account = await repo.createAccount({
        id: 'acc-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        platform: 'tiktok',
        accountId: 'tt-42',
        accountName: 'Me',
        profileUrl: 'https://tiktok.com/@me',
        status: 'active',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt,
      });
      expect(account).toEqual({ id: 'acc-1', platform: 'tiktok' });
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      // On reconnect the upsert refreshes the tokens on the existing row.
      expect(sql).toContain('ON CONFLICT (user_id, workspace_id, platform, account_id) DO UPDATE');
      expect(sql).toContain('access_token=EXCLUDED.access_token');
      expect(params).toEqual([
        'acc-1',
        'user-1',
        'ws-1',
        'tiktok',
        'tt-42',
        'Me',
        'https://tiktok.com/@me',
        'active',
        'access',
        'refresh',
        expiresAt,
      ]);
    });

    it('reads credentials scoped to the caller', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ accessToken: 't' });
      expect(await repo.getAccountCredentials('acc-1')).toEqual({ accessToken: 't' });
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['acc-1', 'user-1', 'ws-1']);
    });

    it('stores credentials in expires_at, on the caller’s own row only', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');
      await repo.storeCredentials('acc-1', { accessToken: 'a', refreshToken: 'r', expiresAt });
      const [sql, params] = lastCall(mockAdapter.execute);
      // The schema has expires_at; token_expires_at does not exist.
      expect(sql).toContain('expires_at = $3');
      expect(sql).not.toContain('token_expires_at');
      // Scoped by user as well as workspace.
      expect(sql).toContain('WHERE id = $5 AND user_id = $6 AND workspace_id = $7');
      expect(params).toEqual([
        'a',
        'r',
        expiresAt.toISOString(),
        expect.any(String),
        'acc-1',
        'user-1',
        'ws-1',
      ]);
    });

    it('stores null for missing optional credentials', async () => {
      await repo.storeCredentials('acc-1', { accessToken: 'a' });
      const [, params] = lastCall(mockAdapter.execute);
      expect(params.slice(0, 3)).toEqual(['a', null, null]);
    });
  });

  describe('posts and publish requests', () => {
    it('creates a post with JSON-encoded collections', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'post-1' });
      await repo.createPost({
        id: 'post-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        accountId: 'acc-1',
        platform: 'youtube',
        title: 'T',
        text: 'Body',
        hashtags: ['a'],
        media: [],
        metadata: { k: 1 },
        scheduledFor: undefined,
      });
      const params = mockAdapter.queryOne.mock.calls[0]![1] as unknown[];
      expect(params.slice(7, 10)).toEqual(['["a"]', '[]', '{"k":1}']);
    });

    it('reads a post only within the caller’s scope', async () => {
      await repo.getPost('post-1');
      const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE id=$1 AND user_id=$2 AND workspace_id=$3');
      expect(params).toEqual(['post-1', 'user-1', 'ws-1']);
    });

    it('creates, reads and lists publish requests scoped to the caller', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'req-1' });
      await repo.createPublishRequest({
        id: 'req-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        postId: 'post-1',
        accountId: 'acc-1',
        status: 'PENDING',
        executionTaskId: 'task-1',
      });
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual([
        'req-1',
        'user-1',
        'ws-1',
        'post-1',
        'acc-1',
        'PENDING',
        'task-1',
      ]);
      await repo.getPublishRequest('req-1');
      expect(mockAdapter.queryOne.mock.calls[1]![1]).toEqual(['req-1', 'user-1', 'ws-1']);
      await repo.listPublishRequests();
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['user-1', 'ws-1']);
    });

    it('refuses to update a publish request that does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);
      await expect(repo.updatePublishRequest('missing', { status: 'FAILED' })).rejects.toThrow(
        'Publish request not found'
      );
    });

    it('merges updates over the current request and encodes errors', async () => {
      const current = {
        id: 'req-1',
        status: 'PENDING',
        providerPostId: 'p-1',
        publishedUrl: undefined,
        error: { code: 'OLD' },
        executionTaskId: 'task-1',
      };
      mockAdapter.queryOne.mockResolvedValueOnce(current).mockResolvedValueOnce({ id: 'req-1' });
      await repo.updatePublishRequest('req-1', {
        status: 'FAILED',
        error: { code: 'NEW' } as never,
      });
      const params = mockAdapter.queryOne.mock.calls[1]![1] as unknown[];
      expect(params).toEqual([
        'FAILED',
        'p-1',
        undefined,
        '{"code":"NEW"}',
        'task-1',
        'req-1',
        'user-1',
        'ws-1',
      ]);
    });

    it('keeps the current error, or null when there is none', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ id: 'r', status: 'S', error: { code: 'KEEP' } })
        .mockResolvedValueOnce({ id: 'r' })
        .mockResolvedValueOnce({ id: 'r', status: 'S' })
        .mockResolvedValueOnce({ id: 'r' });
      await repo.updatePublishRequest('r', {});
      expect((mockAdapter.queryOne.mock.calls[1]![1] as unknown[])[3]).toBe('{"code":"KEEP"}');
      await repo.updatePublishRequest('r', {});
      expect((mockAdapter.queryOne.mock.calls[3]![1] as unknown[])[3]).toBeNull();
    });
  });

  describe('campaigns', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'camp-1',
      user_id: 'user-1',
      workspace_id: 'ws-1',
      content_item_id: 'item-1',
      execution_task_id: null,
      status: 'DRAFT',
      scheduled_for: null,
      version: 1,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
      ...over,
    });

    it('creates a campaign, defaulting optional fields to null', async () => {
      await repo.createCampaign({
        id: 'camp-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        contentItemId: 'item-1',
        status: 'DRAFT',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      const [, params] = lastCall(mockAdapter.execute);
      expect(params.slice(0, 8)).toEqual([
        'camp-1',
        'user-1',
        'ws-1',
        'item-1',
        null,
        'DRAFT',
        null,
        1,
      ]);
    });

    it('converts a scheduled time to a Date', async () => {
      await repo.createCampaign({
        id: 'c',
        userId: 'user-1',
        workspaceId: 'ws-1',
        contentItemId: 'i',
        executionTaskId: 'task-1',
        status: 'SCHEDULED',
        scheduledFor: '2026-05-01T09:00:00Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      const [, params] = lastCall(mockAdapter.execute);
      expect(params[4]).toBe('task-1');
      expect((params[6] as Date).toISOString()).toBe('2026-05-01T09:00:00.000Z');
    });

    it('maps a stored campaign, or returns null when absent', async () => {
      expect(await repo.getCampaign('missing')).toBeNull();
      mockAdapter.query.mockResolvedValueOnce([
        row({ execution_task_id: 'task-1', scheduled_for: new Date('2026-05-01T09:00:00Z') }),
      ]);
      expect(await repo.getCampaign('camp-1')).toEqual({
        id: 'camp-1',
        userId: 'user-1',
        workspaceId: 'ws-1',
        contentItemId: 'item-1',
        executionTaskId: 'task-1',
        status: 'DRAFT',
        scheduledFor: '2026-05-01T09:00:00.000Z',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
      expect(mockAdapter.query.mock.calls[1]![1]).toEqual(['camp-1', 'user-1', 'ws-1']);
    });

    it('lists campaigns, leaving absent optional fields undefined', async () => {
      mockAdapter.query.mockResolvedValueOnce([row()]);
      const [campaign] = await repo.listCampaigns();
      expect(campaign!.executionTaskId).toBeUndefined();
      expect(campaign!.scheduledFor).toBeUndefined();
    });

    it('binds every field of a campaign update as a real parameter', async () => {
      await repo.updateCampaign('camp-1', {
        status: 'ACTIVE',
        executionTaskId: 'task-2',
        scheduledFor: '2026-06-01T00:00:00Z',
        version: 3,
      });
      const [sql, params] = lastCall(mockAdapter.execute);
      expect(sql).toContain(
        'status = $1, execution_task_id = $2, scheduled_for = $3, version = $4'
      );
      expect(params.slice(0, 4)).toEqual(['ACTIVE', 'task-2', new Date('2026-06-01T00:00:00Z'), 3]);
      expectBound(sql, params, 'camp-1');
    });

    it('binds a single-field campaign update and clears a schedule', async () => {
      await repo.updateCampaign('camp-1', { scheduledFor: undefined });
      const [sql, params] = lastCall(mockAdapter.execute);
      expect(sql).toContain('scheduled_for = $1');
      expect(params[0]).toBeNull();
      expectBound(sql, params, 'camp-1');
    });

    it('does nothing for an empty or irrelevant campaign update', async () => {
      await repo.updateCampaign('camp-1', {});
      await repo.updateCampaign('camp-1', { contentItemId: 'ignored' } as never);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });
  });

  describe('campaign targets', () => {
    const target = {
      id: 't-1',
      campaignId: 'camp-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      platform: 'youtube' as const,
      publishRequestId: 'req-1',
      status: 'PENDING' as const,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('creates a target, encoding an error only when present', async () => {
      await repo.createCampaignTarget(target);
      expect(lastCall(mockAdapter.execute)[1][8]).toBeNull();
      await repo.createCampaignTarget({ ...target, error: { code: 'X' } as never });
      expect(lastCall(mockAdapter.execute)[1][8]).toBe('{"code":"X"}');
    });

    it('maps stored targets', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        {
          id: 't-1',
          campaign_id: 'camp-1',
          user_id: 'user-1',
          workspace_id: 'ws-1',
          account_id: 'acc-1',
          platform: 'youtube',
          publish_request_id: 'req-1',
          status: 'PENDING',
          error: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
      const [mapped] = await repo.getCampaignTargets('camp-1');
      expect(mapped).toMatchObject({ id: 't-1', campaignId: 'camp-1', error: undefined });
      expect(mapped!.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['camp-1', 'user-1', 'ws-1']);
    });

    it('binds a target update as real parameters', async () => {
      await repo.updateCampaignTarget('t-1', { status: 'FAILED', error: { code: 'E' } as never });
      const [sql, params] = lastCall(mockAdapter.execute);
      expect(sql).toContain('status = $1, error = $2');
      expect(params.slice(0, 2)).toEqual(['FAILED', '{"code":"E"}']);
      expectBound(sql, params, 't-1');
    });

    it('clears a target error and ignores an empty update', async () => {
      await repo.updateCampaignTarget('t-1', { error: undefined });
      expect(mockAdapter.execute).not.toHaveBeenCalled();
      await repo.updateCampaignTarget('t-1', { error: null as never });
      const [sql, params] = lastCall(mockAdapter.execute);
      expect(params[0]).toBeNull();
      expectBound(sql, params, 't-1');
    });
  });
});
