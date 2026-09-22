import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresAdapter } from '../db/adapters/postgres-adapter.js';
import { initializeSchema } from '../db/schema/index.js';
import { SocialRepository } from '../db/repositories/social.js';
import { SocialService } from './social/service.js';
import { socialProviderRegistry } from './social/provider-registry.js';
import type { SocialProvider } from '@ownpilot/core/social';
import type { MediaAsset } from '@ownpilot/core/media';

import { executeSocialPublishNode } from './workflow/executors/social.js';
import pg from 'pg';

const url = process.env.LEO_QA_POSTGRES_URL;
const db = vi.hoisted(() => ({ adapter: null as unknown as PostgresAdapter }));
vi.mock('../db/adapters/index.js', () => ({ getAdapter: async () => db.adapter }));

describe.skipIf(!url)('Social Publish Integration', () => {
  const database = `leo_social_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;

  const mockProvider: SocialProvider = {
    platform: 'x',
    getCapabilities: () => ({
      supportsScheduling: true,
      supportsVideo: true,
      supportsImages: true,
      supportsCancellation: true,
      maxMediaCount: 4,
    }),
    connect: async () => ({ accessToken: 'mock-token' }),
    getConnectionStatus: async () => 'active',
    validateMedia: async (media) => {
      if (media.length > 4) return { valid: false, error: 'Too many media items' };
      return { valid: true };
    },
    publish: async () => ({ status: 'published', providerPostId: 'mock-id' }),
    checkPublishStatus: async () => ({ status: 'published' }),
    cancelPublish: async () => true,
    normalizeError: (e: any) => ({ code: 'ERR', message: e.message, retryable: false }),
  };

  const failingProvider: SocialProvider = {
    ...mockProvider,
    platform: 'linkedin',
    publish: async () => ({
      status: 'failed',
      error: { code: 'FAIL', message: 'Platform error', retryable: false },
    }),
  };

  const unknownProvider: SocialProvider = {
    ...mockProvider,
    platform: 'facebook',
    publish: async () => ({ status: 'unknown' }), // Simulate timeout/crash
  };

  beforeAll(async () => {
    console.log('beforeAll running', { url });
    if (!url) return;
    admin = new pg.Pool({ connectionString: url });
    console.log('Admin pool created with url:', url);
    await admin.query(`CREATE DATABASE "${database}"`);
    console.log('Database created:', database);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    db.adapter = new PostgresAdapter({ postgresUrl: testUrl.toString() } as any);
    await db.adapter.initialize();
    await initializeSchema(async (sql) => {
      await db.adapter!.query(sql);
    });
    const { readFile } = await import('node:fs/promises');
    await db.adapter!.query(
      await readFile(
        new URL('../db/migrations/postgres/003_action_ledger.sql', import.meta.url),
        'utf8'
      )
    );
    await db.adapter!.query(
      await readFile(
        new URL('../db/migrations/postgres/004_approval_integrity.sql', import.meta.url),
        'utf8'
      )
    );

    socialProviderRegistry.register(mockProvider);
    socialProviderRegistry.register(failingProvider);
    socialProviderRegistry.register(unknownProvider);
  });

  afterAll(async () => {
    if (db.adapter) await db.adapter.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  const userId = 'u1';
  const workspaceId = 'default';
  let repo: SocialRepository;
  let service: SocialService;

  beforeEach(async () => {
    repo = new SocialRepository(userId, workspaceId);
    service = new SocialService(userId, workspaceId);
  });

  it('provider success: completes flow and correlates execution task', async () => {
    const acc = await repo.createAccount({
      id: 'a1',
      platform: 'x',
      accountId: 'x1',
      accountName: 'Test X',
      status: 'active',
      accessToken: 'token',
    });
    const { request } = await service.createPublishTask({
      platform: 'x',
      accountId: acc.id,
      text: 'Hello',
      hashtags: [],
      media: [],
      metadata: {},
    });

    // Simulate dispatcher running the executor
    const res = await executeSocialPublishNode(
      { userId, workspaceId, workflowInputs: { publishRequestId: request.id } } as any,
      { id: 'n1' } as any
    );
    expect(res.status).toBe('success');

    const updated = await repo.getPublishRequest(request.id);
    expect(updated!.status).toBe('published');
    expect(updated!.providerPostId).toBe('mock-id');
  });

  it('provider failure: normalizes error and records failure', async () => {
    const acc = await repo.createAccount({
      id: 'a2',
      platform: 'linkedin',
      accountId: 'l1',
      accountName: 'Test L',
      status: 'active',
      accessToken: 'token',
    });
    const { request } = await service.createPublishTask({
      platform: 'linkedin',
      accountId: acc.id,
      text: 'Hello',
      hashtags: [],
      media: [],
      metadata: {},
    });

    const res = await executeSocialPublishNode(
      { userId, workspaceId, workflowInputs: { publishRequestId: request.id } } as any,
      { id: 'n1' } as any
    );
    expect(res.status).toBe('error');

    const updated = await repo.getPublishRequest(request.id);
    expect(updated!.status).toBe('failed');
    expect(updated!.error).toMatchObject({ code: 'FAIL' });
  });

  it('unknown provider outcome: safely prevents retry and records unknown', async () => {
    const acc = await repo.createAccount({
      id: 'a3',
      platform: 'facebook',
      accountId: 'f1',
      accountName: 'Test F',
      status: 'active',
      accessToken: 'token',
    });
    const { request } = await service.createPublishTask({
      platform: 'facebook',
      accountId: acc.id,
      text: 'Hello',
      hashtags: [],
      media: [],
      metadata: {},
    });

    const res = await executeSocialPublishNode(
      { userId, workspaceId, workflowInputs: { publishRequestId: request.id } } as any,
      { id: 'n1' } as any
    );
    expect(res.status).toBe('error');

    const updated = await repo.getPublishRequest(request.id);
    expect(updated!.status).toBe('unknown');
  });

  it('media validation: catches invalid media before publishing', async () => {
    const acc = await repo.createAccount({
      id: 'a4',
      platform: 'x',
      accountId: 'x2',
      accountName: 'Test X2',
      status: 'active',
      accessToken: 'token',
    });
    const media: MediaAsset[] = [1, 2, 3, 4, 5].map((i) => ({
      id: `m${i}`,
      userId: 'user',
      workspaceId: 'ws',
      storageKey: 'key',
      checksum: 'chk',
      mediaType: 'image',
      status: 'READY',
      filename: 'file.jpg',
      createdAt: new Date(),
      updatedAt: new Date(),
      mimeType: 'img',
      sizeBytes: 10,
    }));

    try {
      await service.createPublishTask({
        platform: 'x',
        accountId: acc.id,
        text: 'Hello',
        hashtags: [],
        media,
        metadata: {},
      });
      expect.fail('Should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('Platform limits media to 4 items');
    }
  });

  it('cancellation: stops publish and contacts provider if applicable', async () => {
    const acc = await repo.createAccount({
      id: 'a5',
      platform: 'x',
      accountId: 'x3',
      accountName: 'Test X3',
      status: 'active',
      accessToken: 'token',
    });
    const { request } = await service.createPublishTask({
      platform: 'x',
      accountId: acc.id,
      text: 'Hello',
      hashtags: [],
      media: [],
      metadata: {},
    });

    const cancelled = await service.cancelPublish(request.id);
    expect(cancelled).toBe(true);

    const updated = await repo.getPublishRequest(request.id);
    expect(updated!.status).toBe('cancelled');

    // Cannot run executor on cancelled request
    const res = await executeSocialPublishNode(
      { userId, workspaceId, workflowInputs: { publishRequestId: request.id } } as any,
      { id: 'n1' } as any
    );
    expect(res.status).toBe('error');
    expect(res.error).toBe('Request was cancelled');
  });

  it('credential isolation: backend exposes no secrets to frontend via list', async () => {
    await repo.createAccount({
      id: 'a6',
      platform: 'x',
      accountId: 'x4',
      accountName: 'Test X4',
      status: 'active',
      accessToken: 'super-secret',
    });
    const accounts = await service.listAccounts();
    expect(accounts[0]).toBeDefined();
    expect((accounts.find((a) => a.id === 'a6') as any).accessToken).toBeUndefined();
  });
});
