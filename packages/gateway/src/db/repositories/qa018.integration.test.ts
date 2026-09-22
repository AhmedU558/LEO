import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getJobsRepository } from './jobs.js';
import { closeAdapter, initializeAdapter } from '../adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-018 Integration: Worker Priority and Starvation', () => {
  let repo: ReturnType<typeof getJobsRepository>;

  beforeAll(async () => {
    await initializeAdapter({ postgresUrl: url, type: 'postgres' });
    repo = getJobsRepository();
  });

  afterAll(async () => {
    await closeAdapter();
  });

  it('Higher priority jobs execute before lower priority jobs (QA-018)', async () => {
    const queue = `q_${randomUUID()}`;
    
    // Insert jobs in random order
    await repo.create({ id: randomUUID(), name: 'j_p0', queue, priority: 0, payload: {}, maxAttempts: 1, runAfter: new Date() });
    await repo.create({ id: randomUUID(), name: 'j_p100', queue, priority: 100, payload: {}, maxAttempts: 1, runAfter: new Date() });
    await repo.create({ id: randomUUID(), name: 'j_pm1', queue, priority: -1, payload: {}, maxAttempts: 1, runAfter: new Date() });
    await repo.create({ id: randomUUID(), name: 'j_p10', queue, priority: 10, payload: {}, maxAttempts: 1, runAfter: new Date() });

    // Claim should yield 100, then 10, then 0, then -1
    const claim1 = await repo.claimJob(queue, 5000);
    expect(claim1?.priority).toBe(100);

    const claim2 = await repo.claimJob(queue, 5000);
    expect(claim2?.priority).toBe(10);

    const claim3 = await repo.claimJob(queue, 5000);
    expect(claim3?.priority).toBe(0);

    const claim4 = await repo.claimJob(queue, 5000);
    expect(claim4?.priority).toBe(-1);
  });

  it('Old low-priority jobs overtake newer high-priority jobs (Starvation prevention)', async () => {
    const queue = `q_${randomUUID()}`;
    
    // Create an old low-priority job (6 minutes ago)
    const oldDate = new Date(Date.now() - 6 * 60 * 1000);
    await repo.create({ id: randomUUID(), name: 'old_low', queue, priority: 0, payload: {}, maxAttempts: 1, runAfter: oldDate });

    // Create a new high-priority job (now)
    await repo.create({ id: randomUUID(), name: 'new_high', queue, priority: 100, payload: {}, maxAttempts: 1, runAfter: new Date() });

    // Because 'old_low' is past the 5-minute starvation threshold, it MUST jump the queue
    const claim1 = await repo.claimJob(queue, 5000);
    expect(claim1?.name).toBe('old_low');

    const claim2 = await repo.claimJob(queue, 5000);
    expect(claim2?.name).toBe('new_high');
  });
});
