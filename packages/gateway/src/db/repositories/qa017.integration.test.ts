import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getJobsRepository } from './jobs.js';
import { closeAdapter, initializeAdapter } from '../adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-017 Integration: Worker Cancellation and Recovery', () => {
  let repo: ReturnType<typeof getJobsRepository>;

  beforeAll(async () => {
    await initializeAdapter({ postgresUrl: url, type: 'postgres' });
    repo = getJobsRepository();
  });

  afterAll(async () => {
    await closeAdapter();
  });

  it('Abandoned active jobs recover under a bounded lease (QA-017)', async () => {
    const queue = `q_${randomUUID()}`;
    const job = await repo.create({
      id: randomUUID(),
      name: 'test_recovery',
      queue,
      priority: 0,
      payload: {},
      maxAttempts: 3,
      runAfter: new Date(),
    });

    // Claim with a very short lease
    const claim1 = await repo.claimJob(queue, 1000); // 1 sec lease
    expect(claim1).toBeDefined();
    expect(claim1?.id).toBe(job.id);

    // Immediate second claim should get nothing
    const claim2 = await repo.claimJob(queue, 1000);
    expect(claim2).toBeNull();

    // Wait for lease to expire
    await new Promise((r) => setTimeout(r, 1500));

    // Next claim must reclaim the abandoned job
    const claim3 = await repo.claimJob(queue, 5000);
    expect(claim3).toBeDefined();
    expect(claim3?.id).toBe(job.id);
    expect(claim3?.attempts).toBe(2);
  });

  it('Cancellation remains terminal (QA-017)', async () => {
    const queue = `q_${randomUUID()}`;
    const job = await repo.create({
      id: randomUUID(),
      name: 'test_cancel',
      queue,
      priority: 0,
      payload: {},
      maxAttempts: 3,
      runAfter: new Date(),
    });

    const claim = await repo.claimJob(queue, 10000);
    expect(claim).toBeDefined();

    // Cancel it!
    await repo.cancelClaim(claim!.id, claim!.leaseToken!);

    // Late completion fails
    const success = await repo.complete(claim!.id, { val: 1 }, claim!.leaseToken!);
    expect(success).toBe(false); // Should be rejected since status=cancelled

    const fetched = await repo.getById(claim!.id);
    expect(fetched?.status).toBe('cancelled');
  });

  it('Stale worker completion is rejected (QA-017)', async () => {
    const queue = `q_${randomUUID()}`;
    const job = await repo.create({
      id: randomUUID(),
      name: 'test_stale',
      queue,
      priority: 0,
      payload: {},
      maxAttempts: 3,
      runAfter: new Date(),
    });

    const claim = await repo.claimJob(queue, 1000); // 1 sec
    await new Promise((r) => setTimeout(r, 1500)); // Let it expire

    // Someone else reclaims
    const reclaim = await repo.claimJob(queue, 5000);
    expect(reclaim).toBeDefined();

    // Original worker tries to complete
    const staleComplete = await repo.complete(claim!.id, { done: true }, claim!.leaseToken!);
    expect(staleComplete).toBe(false);

    // New worker succeeds
    const newComplete = await repo.complete(reclaim!.id, { done: true }, reclaim!.leaseToken!);
    expect(newComplete).toBe(true);
  });
});
