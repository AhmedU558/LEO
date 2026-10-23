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

  // QA-016: the claim is what stands between a retry storm and a duplicated
  // side effect, so exercise it against a real side-effect counter rather than
  // only asserting on the returned claim flags. `executeTool()` runs exactly
  // this sequence — claim, execute only when claimed, finish — and its unit
  // tests pin that it has no path around it.
  describe('effect admission under concurrency', () => {
    /** Stands in for a non-idempotent effect: a charge, a send, a publish. */
    let effects: string[];

    async function admitAndRun(operationId: string, requestHash: string, payload: string) {
      const operations = new Operations();
      const owner = randomUUID();
      const claim = await operations.claimOperation('user', operationId, requestHash, owner);
      if (claim.requestHash !== requestHash) return { admitted: false, reason: 'args-mismatch' };
      if (!claim.claimed) {
        return claim.state === 'success'
          ? { admitted: false, replayed: claim.result }
          : { admitted: false, reason: claim.state };
      }
      effects.push(payload);
      const result = { success: true, result: payload };
      await operations.finishOperation('user', operationId, owner, 'success', result);
      return { admitted: true, result };
    }

    beforeEach(() => {
      effects = [];
    });

    it('runs the effect once when 12 retries race on one operation id', async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 12 }, () => admitAndRun('op-charge', 'hash-a', 'charged'))
      );

      expect(effects).toEqual(['charged']);
      expect(outcomes.filter((o) => o.admitted)).toHaveLength(1);
    });

    it('replays the recorded success for a later retry instead of re-running it', async () => {
      await admitAndRun('op-charge', 'hash-a', 'charged');
      const retry = await admitAndRun('op-charge', 'hash-a', 'charged');

      expect(effects).toEqual(['charged']);
      expect(retry.admitted).toBe(false);
      expect(retry.replayed).toMatchObject({ result: 'charged' });
    });

    it('runs distinct operation ids independently even with identical arguments', async () => {
      await Promise.all([
        admitAndRun('op-1', 'hash-a', 'charged'),
        admitAndRun('op-2', 'hash-a', 'charged'),
      ]);

      // Two intentional sends are two sends, not a deduplicated one.
      expect(effects).toEqual(['charged', 'charged']);
    });

    it('refuses an operation id replayed with different arguments', async () => {
      await admitAndRun('op-charge', 'hash-a', 'charged-10');
      const reused = await admitAndRun('op-charge', 'hash-b', 'charged-9999');

      expect(reused).toMatchObject({ admitted: false, reason: 'args-mismatch' });
      expect(effects).toEqual(['charged-10']);
    });

    it.each(['failed', 'cancelled', 'unknown'] as const)(
      'never re-runs or reports success after a %s outcome',
      async (state) => {
        const operations = new Operations();
        const owner = randomUUID();
        await operations.claimOperation('user', `op-${state}`, 'hash-a', owner);
        await operations.finishOperation('user', `op-${state}`, owner, state, { success: false });

        const retry = await admitAndRun(`op-${state}`, 'hash-a', 'charged');

        expect(retry).toMatchObject({ admitted: false, reason: state });
        expect(effects).toEqual([]);
      }
    );

    it('keeps one user’s operation id from blocking another’s', async () => {
      await admitAndRun('shared-id', 'hash-a', 'user-effect');

      const other = new Operations();
      const claim = await other.claimOperation('other-user', 'shared-id', 'hash-a', randomUUID());

      expect(claim.claimed).toBe(true);
    });
  });
});
