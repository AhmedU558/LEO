import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAdapter } from '../adapters/postgres-adapter.js';
import { JobsRepository } from './jobs.js';
import { IdempotencyKeysRepository } from './idempotency-keys.js';

// Explicit opt-in: creates and drops only a uniquely named test database.
const url = process.env.LEO_QA_POSTGRES_URL;
describe.skipIf(!url)('Priority 4 PostgreSQL claims', () => {
  const database = `leo_qa_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let adapter: PostgresAdapter;
  class Jobs extends JobsRepository {
    constructor() {
      super();
      this.adapter = adapter;
    }
  }
  class Operations extends IdempotencyKeysRepository {
    constructor() {
      super();
      this.adapter = adapter;
    }
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
    await adapter.initialize();
    const initial = await readFile(
      new URL('../migrations/postgres/001_initial_schema.sql', import.meta.url),
      'utf8'
    );
    for (const table of ['jobs', 'job_history', 'idempotency_keys']) {
      const statement = initial.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`)
      );
      if (!statement) throw new Error(`Missing schema for ${table}`);
      await adapter.exec(statement[0]);
    }
    const migration = await readFile(
      new URL('../migrations/postgres/002_job_leases.sql', import.meta.url),
      'utf8'
    );
    await adapter.exec(migration);
    await adapter.exec(migration);
  });
  beforeEach(async () => {
    await adapter.exec('TRUNCATE jobs, job_history, idempotency_keys');
  });
  afterAll(async () => {
    await adapter?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('one of concurrent workers claims a job; expired leases fence stale completion and failure', async () => {
    const jobs = new Jobs();
    await jobs.create({ id: 'one', name: 'test' });
    const claims = await Promise.all(Array.from({ length: 12 }, () => new Jobs().claimJob()));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    await adapter.execute("UPDATE jobs SET lease_expires_at = NOW() - INTERVAL '1 second'");
    const next = await new Jobs().claimJob();
    expect(next?.leaseToken).not.toBe(old.leaseToken);
    expect(await jobs.complete('one', {}, old.leaseToken!)).toBe(false);
    await jobs.fail('one', 'stale', old.leaseToken!);
    expect((await jobs.getById('one'))?.status).toBe('active');
    expect(await jobs.complete('one', { ok: true }, next!.leaseToken!)).toBe(true);
  });

  it('cancellation cannot be resurrected or overwrite a completed job', async () => {
    const jobs = new Jobs();
    await jobs.create({ id: 'one', name: 'test' });
    const claim = await jobs.claimJob();
    await jobs.cancel('one');
    expect(await jobs.complete('one', {}, claim!.leaseToken!)).toBe(false);
    await jobs.fail('one', 'late', claim!.leaseToken!);
    expect(await jobs.claimJob()).toBeNull();
    expect((await jobs.getById('one'))?.status).toBe('cancelled');
  });

  it('claims positive, zero, negative priorities; aged work precedes fresh high priorities; queues stay isolated', async () => {
    const jobs = new Jobs();
    for (const priority of [-10, 0, 100]) {
      await jobs.create({ id: String(priority), name: 'test', priority });
    }
    await jobs.create({ id: 'other', name: 'test', priority: 1000, queue: 'other' });
    expect((await jobs.claimJob())?.id).toBe('100');
    expect((await jobs.claimJob())?.id).toBe('0');
    expect((await jobs.claimJob())?.id).toBe('-10');
    expect(await jobs.claimJob()).toBeNull();
    await jobs.create({
      id: 'aged',
      name: 'test',
      priority: -100,
      runAfter: new Date(Date.now() - 360_000),
    });
    await jobs.create({ id: 'fresh', name: 'test', priority: 100 });
    expect((await jobs.claimJob())?.id).toBe('aged');
    expect((await jobs.claimJob('other'))?.id).toBe('other');
    expect(await jobs.listByStatus('active', 'other', 1)).toHaveLength(1);
  });

  it('atomically claims one operation and persists terminal states across repository instances', async () => {
    const operations = new Operations();
    const owners = Array.from({ length: 12 }, () => randomUUID());
    const claims = await Promise.all(
      owners.map((owner) => new Operations().claimOperation('user', 'op', 'args', owner))
    );
    expect(claims.filter((c) => c.claimed)).toHaveLength(1);
    const owner = owners[claims.findIndex((c) => c.claimed)]!;
    await operations.finishOperation('user', 'op', owner, 'success', {
      success: true,
      result: 'effect',
    });
    const retry = await new Operations().claimOperation('user', 'op', 'args', randomUUID());
    expect(retry).toMatchObject({ claimed: false, state: 'success', result: { result: 'effect' } });
    expect(
      (await operations.claimOperation('user', 'different-op', 'args', randomUUID())).claimed
    ).toBe(true);
    expect(
      (await operations.claimOperation('other-user', 'op', 'args', randomUUID())).claimed
    ).toBe(true);
    for (const state of ['failed', 'cancelled', 'unknown'] as const) {
      await operations.claimOperation('user', state, 'args', owner);
      await operations.finishOperation('user', state, owner, state, { success: false });
      expect(
        await new Operations().claimOperation('user', state, 'args', randomUUID())
      ).toMatchObject({ claimed: false, state });
    }
    expect(await operations.purgeExpired()).toBe(0);
  });
});
