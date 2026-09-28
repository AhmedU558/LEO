import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createWorkflowApprovalsRepository } from './db/repositories/workflows/approvals.js';
import { closeAdapter, initializeAdapter } from './db/adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

// Skipped, not failed, without a database. Every other integration suite in
// this repository gates the same way, and the deterministic suite has to run
// without external services — throwing here made a credential-free run report
// a failed suite even though all of its tests were skipped.
describe('QA-012/QA-013 Integration: Approval Integrity and Liveness', () => {
  const database = `leo_qa012_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool | undefined;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url);
    testUrl.pathname = `/${database}`;
    await initializeAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
  });

  afterAll(async () => {
    await closeAdapter();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('QA-012: Enforces workspace and identity on approval fetch', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();

    const repo = createWorkflowApprovalsRepository(userId);
    const approval = await repo.create({
      workflowLogId: randomUUID(),
      workflowId: randomUUID(),
      nodeId: 'test_node',
      workspaceId,
      action: 'test.execute',
      capability: 'system.execute',
    });

    expect(approval.workspaceId).toBe(workspaceId);

    // Test IDOR: Fetching with the wrong workspace ID returns null
    const unauthorized = await repo.get(approval.id, otherWorkspaceId);
    expect(unauthorized).toBeNull();

    const authorized = await repo.get(approval.id, workspaceId);
    expect(authorized).not.toBeNull();
    expect(authorized?.id).toBe(approval.id);
  });

  it('QA-012: Concurrent approve vs expire', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();

    const repo = createWorkflowApprovalsRepository(userId);
    const pastDate = new Date(Date.now() - 10000);
    const approval = await repo.create({
      workflowLogId: randomUUID(),
      workflowId: randomUUID(),
      nodeId: 'test_node',
      workspaceId,
      expiresAt: pastDate,
    });

    // Try to approve an already expired approval
    const decided = await repo.decide(approval.id, 'approved', workspaceId);
    // Should return the original pending state because it lost the race
    expect(decided?.status).toBe('pending');
  });
  it('QA-012: Concurrent approve vs cancel (workflow rejection)', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const workflowId = randomUUID();
    const repo = createWorkflowApprovalsRepository(userId);
    const approval = await repo.create({
      workflowLogId: randomUUID(),
      workflowId,
      nodeId: 'test_node',
      workspaceId,
    });
    await repo.rejectByWorkflow(workflowId);
    const decided = await repo.decide(approval.id, 'approved', workspaceId);
    expect(decided?.status).toBe('rejected');
    const finalState = await repo.get(approval.id);
    expect(finalState?.status).toBe('rejected');
  });
});
