import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { actionLedgerRepo } from './action-ledger.js';
import { closeAdapter, initializeAdapter } from '../adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-010 & QA-011 Integration: Action Ledger Durability and Integrity', () => {
  const database = `leo_qa010_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    const adapter = await initializeAdapter({ postgresUrl: testUrl.toString(), type: 'postgres' });
    // Exercise idempotent bootstrap on the same database as well as a fresh one.
    const { initializeSchema } = await import('../schema/index.js');
    await initializeSchema((sql) => adapter.exec(sql));
  });

  afterAll(async () => {
    await closeAdapter();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('Concurrent writes preserve hash-chain integrity', async () => {
    const userId = randomUUID();
    const wsId = randomUUID();

    // Trigger 10 writes concurrently
    const promises = Array.from({ length: 10 }).map((_, i) =>
      actionLedgerRepo.record({
        userId,
        workspaceId: wsId,
        tool: 'test_tool',
        action: `concurrent_${i}`,
        resource: 'test_resource',
        resourceType: 'test',
        capability: 'system_execute' as never,
        policyDecision: 'ALLOW' as never,
        riskLevel: 'LOW' as never,
        executionEnvironment: 'test',
        durationMs: 0,
      })
    );

    const entries = await Promise.all(promises);
    expect(entries).toHaveLength(10);

    // Retrieve sequentially to verify chain
    const stored = await actionLedgerRepo.getEntries(userId);
    expect(stored).toHaveLength(10);

    // Verify hash chain
    for (let i = 1; i < stored.length; i++) {
      expect(stored[i].previousHash).toBe(stored[i - 1].hash);
    }
  });

  it('Returned ledger objects must not allow mutation of stored records', async () => {
    const userId = randomUUID();
    const wsId = randomUUID();

    await actionLedgerRepo.record({
      userId,
      workspaceId: wsId,
      tool: 'test_tool',
      action: 'mutation_test',
      executionTaskId: 'execution-fixture',
      sessionId: 'session-fixture',
      resource: 'test_resource',
      resourceType: 'test',
      capability: 'system_execute' as never,
      policyDecision: 'ALLOW' as never,
      riskLevel: 'LOW' as never,
      executionEnvironment: 'test',
      durationMs: 0,
    });

    const entriesBefore = await actionLedgerRepo.getEntries(userId);
    expect(entriesBefore[0]).toMatchObject({
      executionTaskId: 'execution-fixture',
      sessionId: 'session-fixture',
    });

    // Attempt mutation
    (entriesBefore[0] as any).resource = 'HACKED';

    const entriesAfter = await actionLedgerRepo.getEntries(userId);
    expect(entriesAfter[0].resource).toBe('test_resource'); // Should remain unchanged in DB
  });

  it('Failed/Unknown executions correctly update results', async () => {
    const userId = randomUUID();
    const wsId = randomUUID();

    const entry = await actionLedgerRepo.record({
      userId,
      workspaceId: wsId,
      tool: 'test_tool',
      action: 'execution_test',
      resource: 'test_resource',
      resourceType: 'test',
      capability: 'system_execute' as never,
      policyDecision: 'ALLOW' as never,
      riskLevel: 'LOW' as never,
      executionEnvironment: 'test',
      durationMs: 0,
    });

    const updated = await actionLedgerRepo.updateResult(
      entry.actionId,
      { error: 'Test error' },
      150
    );
    expect(updated?.error).toBe('Test error');
    expect(updated?.result).toBeUndefined();
    expect(updated?.durationMs).toBe(150);

    const stored = await actionLedgerRepo.getByActionId(entry.actionId, userId);
    expect(stored?.error).toBe('Test error');
    expect(stored?.result).toBeUndefined(); // Unknown result should not be "SUCCESS"
  });

  it('Cross-workspace access is prevented', async () => {
    const userId1 = randomUUID();
    const userId2 = randomUUID();
    const wsId = randomUUID();

    await actionLedgerRepo.record({
      userId: userId1,
      workspaceId: wsId,
      tool: 'test_tool',
      action: 'workspace_test',
      resource: 'test_resource',
      resourceType: 'test',
      capability: 'system_execute' as any,
      policyDecision: 'ALLOW' as any,
      riskLevel: 'LOW' as any,
      executionEnvironment: 'test',
      durationMs: 0,
    });

    // Should fetch empty for userId2
    const entries = await actionLedgerRepo.getByWorkspaceId(wsId, userId2);
    expect(entries).toHaveLength(0);

    // Should fetch 1 for userId1
    const entriesFor1 = await actionLedgerRepo.getByWorkspaceId(wsId, userId1);
    expect(entriesFor1).toHaveLength(1);
  });
});
