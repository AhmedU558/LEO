import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getIdempotencyKeysRepository } from './idempotency-keys.js';
import { closeAdapter, initializeAdapter } from '../adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-016 Integration: Idempotency and Retries', () => {
  let repo: ReturnType<typeof getIdempotencyKeysRepository>;

  beforeAll(async () => {
    await initializeAdapter({ postgresUrl: url, type: 'postgres' });
    repo = getIdempotencyKeysRepository();
  });

  afterAll(async () => {
    await closeAdapter();
  });

  it('Two concurrent requests with one operation key produce one effect (QA-016)', async () => {
    const userId = randomUUID();
    const operationId = randomUUID();
    const requestHash = 'hash1';

    const owner1 = randomUUID();
    const owner2 = randomUUID();

    // Concurrent claims
    const [claim1, claim2] = await Promise.all([
      repo.claimOperation(userId, operationId, requestHash, owner1),
      repo.claimOperation(userId, operationId, requestHash, owner2)
    ]);

    // Exactly one should win
    expect([claim1.claimed, claim2.claimed]).toContain(true);
    expect([claim1.claimed, claim2.claimed]).toContain(false);

    const winner = claim1.claimed ? claim1 : claim2;
    const loser = claim1.claimed ? claim2 : claim1;

    expect(winner.state).toBe('pending');
    expect(loser.state).toBe('pending');

    // Winner finishes
    await repo.finishOperation(userId, operationId, winner.claimed ? owner1 : owner2, 'success', { val: 'test' });

    // Loser polling or next retry should see success
    const retry = await repo.claimOperation(userId, operationId, requestHash, randomUUID());
    expect(retry.claimed).toBe(false);
    expect(retry.state).toBe('success');
    expect((retry.result as any).val).toBe('test');
  });

  it('Different keys with same args produce two effects (QA-016)', async () => {
    const userId = randomUUID();
    const requestHash = 'hash_same';

    const op1 = randomUUID();
    const op2 = randomUUID();

    const claim1 = await repo.claimOperation(userId, op1, requestHash, randomUUID());
    const claim2 = await repo.claimOperation(userId, op2, requestHash, randomUUID());

    expect(claim1.claimed).toBe(true);
    expect(claim2.claimed).toBe(true);
  });

  it('Failures/unknown outcomes block replay (QA-016)', async () => {
    const userId = randomUUID();
    const opUnknown = randomUUID();
    const owner = randomUUID();

    const claim = await repo.claimOperation(userId, opUnknown, 'hash', owner);
    expect(claim.claimed).toBe(true);

    await repo.finishOperation(userId, opUnknown, owner, 'unknown', { error: 'timeout' });

    // Next retry must NOT get success, and must NOT claim
    const retry = await repo.claimOperation(userId, opUnknown, 'hash', randomUUID());
    expect(retry.claimed).toBe(false);
    expect(retry.state).toBe('unknown');
    expect((retry.result as any).error).toBe('timeout');
  });
});
