/**
 * JobsRepository tests.
 *
 * The durable queue's guarantees, pinned at the SQL boundary: bounded leases,
 * atomic SKIP LOCKED claims, lease-fenced completion and effects, atomic
 * fail-or-retry with capped exponential backoff, and dead-lettering once the
 * attempts are spent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();
vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { JobsRepository, getJobsRepository } = await import('./jobs.js');

const t = new Date('2026-01-01T00:00:00Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  name: 'workflow_node',
  queue: 'default',
  priority: 0,
  payload: { workflowRunId: 'run-1', nodeId: 'node-1' },
  result: null,
  status: 'active',
  run_after: t,
  started_at: null,
  completed_at: null,
  attempts: 1,
  max_attempts: 3,
  created_at: t,
  updated_at: t,
  lease_expires_at: t,
  ...over,
});

const sqlAt = (fn: { mock: { calls: unknown[][] } }, i: number) => String(fn.mock.calls[i]![0]);

describe('JobsRepository', () => {
  let repo: InstanceType<typeof JobsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new JobsRepository();
  });

  afterEach(() => vi.useRealTimers());

  describe('claimJob', () => {
    it.each([999, 300_001, 1500.5, Number.NaN])('rejects a lease of %s ms', async (leaseMs) => {
      await expect(repo.claimJob('default', leaseMs)).rejects.toThrow(
        'Job lease must be between 1000 and 300000 milliseconds'
      );
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('fails expired final attempts before claiming', async () => {
      await repo.claimJob('q1');
      expect(sqlAt(mockAdapter.execute, 0)).toContain("SET status = 'failed'");
      expect(sqlAt(mockAdapter.execute, 0)).toContain('attempts >= max_attempts');
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual(['q1']);
    });

    it('returns null when nothing is claimable', async () => {
      expect(await repo.claimJob()).toBeNull();
    });

    it('claims atomically and returns the job with a fresh lease', async () => {
      mockAdapter.query.mockResolvedValueOnce([row()]);
      const job = await repo.claimJob('default', 60_000);
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('attempts < max_attempts');
      expect(params[0]).toBe('default');
      expect(params[2]).toBe(60_000);
      // The lease token returned is the one written in the claim.
      expect(job!.leaseToken).toBe(params[1]);
      expect(job!.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
      expect(job).toMatchObject({
        id: 'job-1',
        status: 'active',
        attempts: 1,
        maxAttempts: 3,
        startedAt: null,
        completedAt: null,
        workflowRunId: 'run-1',
        nodeId: 'node-1',
      });
    });

    it('tolerates a job whose payload carries no workflow ids', async () => {
      mockAdapter.query.mockResolvedValueOnce([row({ payload: {}, started_at: t })]);
      const job = await repo.claimJob();
      expect(job!.workflowRunId).toBeUndefined();
      expect(job!.startedAt).toEqual(t);
    });
  });

  describe('create', () => {
    it('applies defaults for queue, priority, payload, attempts and schedule', async () => {
      vi.useFakeTimers({ now: t });
      mockAdapter.query.mockResolvedValueOnce([row({ status: 'available', attempts: 0 })]);
      const job = await repo.create({ id: 'job-1', name: 'n' });
      expect(mockAdapter.query.mock.calls[0]![1]).toEqual([
        'job-1',
        'n',
        'default',
        0,
        '{}',
        3,
        t.toISOString(),
        t.toISOString(),
        t.toISOString(),
      ]);
      expect(job.workflowRunId).toBeUndefined();
    });

    it('honours explicit settings and carries workflow ids from the input', async () => {
      const runAfter = new Date('2026-02-01T00:00:00Z');
      mockAdapter.query.mockResolvedValueOnce([row({ started_at: t, completed_at: t })]);
      const job = await repo.create({
        id: 'job-2',
        name: 'n',
        queue: 'execution_tasks',
        priority: 5,
        payload: { a: 1 },
        maxAttempts: 1,
        runAfter,
        workflowRunId: 'run-9',
        nodeId: 'node-9',
      });
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params.slice(2, 7)).toEqual([
        'execution_tasks',
        5,
        '{"a":1}',
        1,
        runAfter.toISOString(),
      ]);
      expect(job).toMatchObject({
        workflowRunId: 'run-9',
        nodeId: 'node-9',
        startedAt: t,
        completedAt: t,
      });
    });
  });

  describe('lease-fenced operations', () => {
    it('completes only under a live lease', async () => {
      expect(await repo.complete('job-1', { ok: true }, 'lease')).toBe(true);
      expect(sqlAt(mockAdapter.execute, 0)).toContain(
        'lease_token = $3 AND lease_expires_at > NOW()'
      );
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual(['job-1', '{"ok":true}', 'lease']);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      expect(await repo.complete('job-1', {}, 'stale')).toBe(false);
    });

    it('renews only under a live lease', async () => {
      expect(await repo.renewLease('job-1', 'lease', 45_000)).toBe(true);
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual(['job-1', 'lease', 45_000]);
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });
      expect(await repo.renewLease('job-1', 'stale')).toBe(false);
      expect(mockAdapter.execute.mock.calls[1]![1]).toEqual(['job-1', 'stale', 30_000]);
    });

    it('refuses a fenced effect once the lease is lost', async () => {
      const effect = vi.fn(async () => 'done');
      await expect(repo.withLease('job-1', 'stale', effect)).rejects.toThrow('Job lease lost');
      expect(effect).not.toHaveBeenCalled();
      expect(sqlAt(mockAdapter.queryOne, 0)).toContain('FOR UPDATE');
    });

    it('runs a fenced effect while the lease is held', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'job-1' });
      expect(await repo.withLease('job-1', 'lease', async () => 'done')).toBe('done');
      expect(mockAdapter.transaction).toHaveBeenCalled();
    });
  });

  describe('fail', () => {
    it('does nothing for a job it no longer holds', async () => {
      await repo.fail('job-1', 'boom', 'stale');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('dead-letters a job whose attempts are spent', async () => {
      vi.useFakeTimers({ now: t });
      mockAdapter.queryOne.mockResolvedValueOnce({
        attempts: 3,
        max_attempts: 3,
        name: 'n',
        queue: 'q',
        payload: { a: 1 },
      });
      await repo.fail('job-1', 'boom', 'lease');
      expect(sqlAt(mockAdapter.execute, 0)).toContain('INSERT INTO job_history');
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual([
        `job-1_${t.getTime()}`,
        'job-1',
        'n',
        'q',
        '{"a":1}',
        '{"error":"boom"}',
        3,
        3,
        t.toISOString(),
        'boom',
      ]);
      expect(sqlAt(mockAdapter.execute, 1)).toContain('DELETE FROM jobs');
    });

    it('dead-letters a job with no payload', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({
        attempts: 1,
        max_attempts: 1,
        name: 'n',
        queue: 'q',
        payload: null,
      });
      await repo.fail('job-1', 'boom', 'lease');
      expect((mockAdapter.execute.mock.calls[0]![1] as unknown[])[4]).toBe('{}');
    });

    it.each([
      [1, 5_000],
      [2, 20_000],
      [100, 3_600_000], // capped at one hour
    ])('retries attempt %i after %i ms of backoff', async (attempts, backoff) => {
      vi.useFakeTimers({ now: t });
      mockAdapter.queryOne.mockResolvedValueOnce({
        attempts,
        max_attempts: 1000,
        name: 'n',
        queue: 'q',
        payload: {},
      });
      await repo.fail('job-1', 'boom', 'lease');
      const [sql, params] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("SET status = 'available'");
      expect(sql).toContain('lease_token = NULL');
      expect(params).toEqual([
        'job-1',
        '{"error":"boom"}',
        new Date(t.getTime() + backoff).toISOString(),
        t.toISOString(),
      ]);
    });
  });

  it('cancels a job, or a claim only under its own lease', async () => {
    await repo.cancel('job-1');
    expect(sqlAt(mockAdapter.execute, 0)).toContain("status IN ('available', 'active')");
    await repo.cancelClaim('job-1', 'lease');
    expect(sqlAt(mockAdapter.execute, 1)).toContain('lease_token = $2');
    expect(mockAdapter.execute.mock.calls[1]![1]).toEqual(['job-1', 'lease']);
  });

  it('reads a job by id, or null', async () => {
    expect(await repo.getById('missing')).toBeNull();
    mockAdapter.query.mockResolvedValueOnce([row({ payload: {} })]);
    expect(await repo.getById('job-1')).toMatchObject({
      id: 'job-1',
      workflowRunId: undefined,
      startedAt: null,
    });
    mockAdapter.query.mockResolvedValueOnce([row({ started_at: t, completed_at: t })]);
    expect(await repo.getById('job-1')).toMatchObject({
      nodeId: 'node-1',
      startedAt: t,
      completedAt: t,
    });
  });

  it('counts jobs by status, optionally per queue', async () => {
    mockAdapter.query.mockResolvedValueOnce([
      { status: 'available', count: '4' },
      { status: 'failed', count: '1' },
    ]);
    expect(await repo.getStats()).toEqual({
      available: 4,
      active: 0,
      completed: 0,
      failed: 1,
      cancelled: 0,
    });
    expect(mockAdapter.query.mock.calls[0]![1]).toEqual([]);
    await repo.getStats('q1');
    expect(sqlAt(mockAdapter.query, 1)).toContain('WHERE queue = $1');
    expect(mockAdapter.query.mock.calls[1]![1]).toEqual(['q1']);
  });

  it('lists jobs by status with a correctly numbered limit', async () => {
    mockAdapter.query.mockResolvedValueOnce([row({ started_at: t, completed_at: t })]);
    const [job] = await repo.listByStatus('active');
    expect(job).toMatchObject({ id: 'job-1', startedAt: t, completedAt: t });
    expect(sqlAt(mockAdapter.query, 0)).toContain('LIMIT $2');
    expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['active', 100]);
    mockAdapter.query.mockResolvedValueOnce([row()]);
    const [plain] = await repo.listByStatus('failed', 'q1', 5);
    expect(plain!.startedAt).toBeNull();
    expect(sqlAt(mockAdapter.query, 1)).toContain('status = $1 AND queue = $2');
    expect(sqlAt(mockAdapter.query, 1)).toContain('LIMIT $3');
    expect(mockAdapter.query.mock.calls[1]![1]).toEqual(['failed', 'q1', 5]);
  });

  it('purges old jobs and dead letters, reporting how many', async () => {
    mockAdapter.execute.mockResolvedValueOnce({ changes: 7 }).mockResolvedValueOnce({ changes: 2 });
    expect(await repo.cleanupOld()).toBe(7);
    expect(mockAdapter.execute.mock.calls[0]![1]).toEqual([30]);
    expect(await repo.cleanupHistory(10)).toBe(2);
    expect(mockAdapter.execute.mock.calls[1]![1]).toEqual([10]);
  });

  it('shares one repository instance', () => {
    expect(getJobsRepository()).toBe(getJobsRepository());
  });
});
