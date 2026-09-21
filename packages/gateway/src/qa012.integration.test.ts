import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createWorkflowApprovalsRepository } from './db/repositories/workflows/approvals.js';
import { closeAdapter, initializeAdapter } from './db/adapters/index.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe('QA-012/QA-013 Integration: Approval Integrity and Liveness', () => {
  beforeAll(async () => {
    if (url) {
      process.env.DATABASE_URL = url;
      await initializeAdapter();
    }
  });

  afterAll(async () => {
    if (url) {
      await closeAdapter();
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
    // Should return null (not updated) because of the expires_at constraint
    expect(decided).toBeNull();
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
    expect(decided).toBeNull();
    const finalState = await repo.get(approval.id);
    expect(finalState?.status).toBe('rejected');
  });
});
