/**
 * SocialRepository against real PostgreSQL.
 *
 * The unit test pins the SQL that is sent; only a real database proves it is
 * accepted and touches the right rows. Each case here failed against the
 * original code: campaign/target updates emitted `status = 1` literals with no
 * bound parameters, storeCredentials wrote a nonexistent token_expires_at
 * column, and getPost was readable across tenants.
 *
 * Gated like the other database suites: set LEO_QA_POSTGRES_URL to run it.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PostgresAdapter } from '../adapters/postgres-adapter.js';
import { initializeSchema } from '../schema/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;
const db = vi.hoisted(() => ({ adapter: null as unknown as PostgresAdapter }));
vi.mock('../adapters/index.js', () => ({ getAdapter: async () => db.adapter }));

const { SocialRepository } = await import('./social.js');

describe.skipIf(!url)('SocialRepository on PostgreSQL', () => {
  const database = `leo_socialrepo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  const mine = () => new SocialRepository('user-1', 'ws-1');
  const theirs = () => new SocialRepository('user-2', 'ws-1'); // same workspace, other user
  const now = new Date().toISOString();

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    db.adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
    await db.adapter.initialize();
    await initializeSchema((sql) => db.adapter.exec(sql));
  }, 60_000);

  afterAll(async () => {
    await db.adapter?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  const account = (repo: InstanceType<typeof SocialRepository>, id: string, accountId: string) =>
    repo.createAccount({
      id,
      userId: repo.userId,
      workspaceId: repo.workspaceId,
      platform: 'tiktok',
      accountId,
      accountName: 'Me',
      status: 'active',
      accessToken: 'first-token',
    });

  it('stores tokens with the account, and refreshes them on reconnect', async () => {
    await account(mine(), 'acc-1', 'tt-1');
    expect((await mine().getAccountCredentials('acc-1'))!.accessToken).toBe('first-token');
    // Reconnecting the same platform account updates the existing row's tokens.
    await mine().createAccount({
      id: 'acc-ignored',
      userId: 'user-1',
      workspaceId: 'ws-1',
      platform: 'tiktok',
      accountId: 'tt-1',
      accountName: 'Me',
      status: 'active',
      accessToken: 'second-token',
    });
    expect((await mine().getAccountCredentials('acc-1'))!.accessToken).toBe('second-token');
  });

  it('stores credentials in expires_at, and only on the caller’s own row', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    await mine().storeCredentials('acc-1', { accessToken: 'stored', refreshToken: 'r', expiresAt });
    const creds = await mine().getAccountCredentials('acc-1');
    expect(creds).toMatchObject({ accessToken: 'stored', refreshToken: 'r' });
    expect(new Date(creds!.expiresAt!).toISOString()).toBe(expiresAt.toISOString());

    // Another user in the same workspace cannot overwrite it.
    await theirs().storeCredentials('acc-1', { accessToken: 'hijacked' });
    expect((await mine().getAccountCredentials('acc-1'))!.accessToken).toBe('stored');
  });

  it('keeps a post invisible to another tenant', async () => {
    await mine().createPost({
      id: 'post-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      platform: 'tiktok',
      text: 'hello',
      hashtags: [],
      media: [],
      metadata: {},
    });
    expect((await mine().getPost('post-1'))!.text).toBe('hello');
    expect(await theirs().getPost('post-1')).toBeNull();
  });

  it('applies a campaign update, and only to the caller’s campaign', async () => {
    await mine().createCampaign({
      id: 'camp-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      contentItemId: 'item-1',
      status: 'DRAFT',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await mine().updateCampaign('camp-1', {
      status: 'SCHEDULED',
      scheduledFor: '2026-12-01T09:00:00Z',
      version: 2,
    });
    expect(await mine().getCampaign('camp-1')).toMatchObject({
      status: 'SCHEDULED',
      scheduledFor: '2026-12-01T09:00:00.000Z',
      version: 2,
    });

    await theirs().updateCampaign('camp-1', { status: 'CANCELLED' });
    expect((await mine().getCampaign('camp-1'))!.status).toBe('SCHEDULED');
  });

  it('applies a campaign target update', async () => {
    await mine().createPublishRequest({
      id: 'req-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      postId: 'post-1',
      accountId: 'acc-1',
      status: 'PENDING',
    } as never);
    await mine().createCampaignTarget({
      id: 'target-1',
      campaignId: 'camp-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
      accountId: 'acc-1',
      platform: 'tiktok',
      publishRequestId: 'req-1',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    } as never);
    await mine().updateCampaignTarget('target-1', {
      status: 'FAILED',
      error: { code: 'QUOTA', message: 'Daily limit', retryable: true },
    });
    const [target] = await mine().getCampaignTargets('camp-1');
    expect(target).toMatchObject({ status: 'FAILED', error: { code: 'QUOTA' } });

    await mine().updateCampaignTarget('target-1', { error: null as never });
    expect((await mine().getCampaignTargets('camp-1'))[0]!.error).toBeUndefined();
  });
});
