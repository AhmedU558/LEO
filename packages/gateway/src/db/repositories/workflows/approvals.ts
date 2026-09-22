/**
 * Workflow Approvals Repository
 *
 * Manages approval gate records for workflow execution pause/resume.
 */

import { BaseRepository, parseJsonField } from '../base.js';
import { generateId } from '@ownpilot/core/services';
import { executionTaskContext } from '../../../services/execution-task-context.js';
import { ExecutionTasksRepository } from '../execution-tasks.js';

// ============================================================================
// Types
// ============================================================================

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface WorkflowApproval {
  id: string;
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  userId: string;
  workspaceId: string;
  action: string | null;
  capability: string | null;
  status: ApprovalStatus;
  context: Record<string, unknown>;
  message: string | null;
  decidedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

interface CreateApprovalInput {
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  workspaceId: string;
  action?: string;
  capability?: string;
  context?: Record<string, unknown>;
  message?: string;
  expiresAt?: Date;
}

// ============================================================================
// Row type
// ============================================================================

interface ApprovalRow {
  id: string;
  workflow_log_id: string;
  workflow_id: string;
  node_id: string;
  user_id: string;
  workspace_id: string;
  action: string | null;
  capability: string | null;
  status: ApprovalStatus;
  context: string;
  message: string | null;
  decided_at: string | null;
  expires_at: string | null;
  created_at: string;
}

function mapApproval(row: ApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    workflowLogId: row.workflow_log_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    action: row.action,
    capability: row.capability,
    status: row.status,
    context: parseJsonField<Record<string, unknown>>(row.context, {}),
    message: row.message,
    decidedAt: row.decided_at ? new Date(row.decided_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Repository
// ============================================================================

export class WorkflowApprovalsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: CreateApprovalInput): Promise<WorkflowApproval> {
    const task = executionTaskContext.getStore();
    if (task) {
      if (this.userId !== task.userId || input.workspaceId !== task.workspaceId)
        throw new Error('Approval identity mismatch');
      return new ExecutionTasksRepository(task.userId, task.workspaceId).whileRunning(
        task.taskId,
        () =>
          this.insertApproval({
            ...input,
            context: { ...input.context, executionTaskId: task.taskId },
          })
      );
    }
    return this.insertApproval(input);
  }

  private async insertApproval(input: CreateApprovalInput): Promise<WorkflowApproval> {
    const id = generateId('wfappr');
    const now = new Date().toISOString();

    await this.execute(
      `INSERT INTO workflow_approvals (id, workflow_log_id, workflow_id, node_id, user_id, workspace_id, action, capability, status, context, message, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        input.workflowLogId,
        input.workflowId,
        input.nodeId,
        this.userId,
        input.workspaceId,
        input.action ?? null,
        input.capability ?? null,
        'pending',
        JSON.stringify(input.context ?? {}),
        input.message ?? null,
        input.expiresAt?.toISOString() ?? null,
        now,
      ]
    );

    const approval = await this.get(id);
    if (!approval) throw new Error('Failed to create approval');
    return approval;
  }

  async get(id: string, workspaceId?: string): Promise<WorkflowApproval | null> {
    const query = workspaceId
      ? 'SELECT * FROM workflow_approvals WHERE id = $1 AND user_id = $2 AND workspace_id = $3'
      : 'SELECT * FROM workflow_approvals WHERE id = $1 AND user_id = $2';
    const params = workspaceId ? [id, this.userId, workspaceId] : [id, this.userId];

    const row = await this.queryOne<ApprovalRow>(query, params);
    return row ? mapApproval(row) : null;
  }

  /**
   * Record a decision on a pending approval.
   *
   * QA-012: the UPDATE is fenced on `status = 'pending'` and on the approval
   * still being live. Without the fence, a decision arriving after the
   * workflow was cancelled (which rejects its approvals) would overwrite that
   * terminal state and resume an execution the user had already stopped, and
   * an expired gate could be approved arbitrarily late. A decision that loses
   * the race changes nothing and `get()` returns the state that won.
   */
  async decide(
    id: string,
    status: 'approved' | 'rejected',
    workspaceId?: string
  ): Promise<WorkflowApproval | null> {
    const now = new Date().toISOString();
    const query = workspaceId
      ? `UPDATE workflow_approvals SET status = $1, decided_at = $2 WHERE id = $3 AND user_id = $4 AND workspace_id = $5 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())`
      : `UPDATE workflow_approvals SET status = $1, decided_at = $2 WHERE id = $3 AND user_id = $4 AND status = 'pending' AND (expires_at IS NULL OR expires_at > NOW())`;
    const params = workspaceId
      ? [status, now, id, this.userId, workspaceId]
      : [status, now, id, this.userId];

    await this.execute(`${query} AND NOT jsonb_exists(context, 'executionTaskId')`, params);
    return this.get(id, workspaceId);
  }

  /**
   * Reject every still-pending approval for a workflow — used when the
   * workflow execution is cancelled, so a late approval cannot resume it.
   *
   * Scoped by `workflow_id` rather than `user_id` on purpose: `workflows` has
   * a single `user_id` owner, so a workflow id already identifies one tenant.
   * That lets the cancellation path (which runs as the system actor and has no
   * user context) invalidate the owner's approvals without a cross-tenant
   * write being possible.
   */
  async rejectByWorkflow(workflowId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.execute(
      `UPDATE workflow_approvals SET status = 'rejected', decided_at = $1 WHERE workflow_id = $2 AND status = 'pending'`,
      [now, workflowId]
    );
  }

  async getPending(limit = 20, offset = 0, workspaceId?: string): Promise<WorkflowApproval[]> {
    // QA-013: an approval past its expiry is not actionable, so it must not be
    // offered as pending work.
    const query = workspaceId
      ? `SELECT * FROM workflow_approvals WHERE user_id = $1 AND workspace_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT * FROM workflow_approvals WHERE user_id = $1 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const params = workspaceId
      ? [this.userId, workspaceId, limit, offset]
      : [this.userId, limit, offset];

    const rows = await this.query<ApprovalRow>(query, params);
    return rows.map(mapApproval);
  }

  async countPending(workspaceId?: string): Promise<number> {
    const query = workspaceId
      ? `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1 AND workspace_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`
      : `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`;
    const params = workspaceId ? [this.userId, workspaceId] : [this.userId];

    const row = await this.queryOne<{ count: string }>(query, params);
    return parseInt(row?.count ?? '0', 10);
  }

  async getAll(limit = 20, offset = 0, workspaceId?: string): Promise<WorkflowApproval[]> {
    const query = workspaceId
      ? `SELECT * FROM workflow_approvals WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT * FROM workflow_approvals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const params = workspaceId
      ? [this.userId, workspaceId, limit, offset]
      : [this.userId, limit, offset];

    const rows = await this.query<ApprovalRow>(query, params);
    return rows.map(mapApproval);
  }

  async countAll(workspaceId?: string): Promise<number> {
    const query = workspaceId
      ? `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1 AND workspace_id = $2`
      : `SELECT COUNT(*) as count FROM workflow_approvals WHERE user_id = $1`;
    const params = workspaceId ? [this.userId, workspaceId] : [this.userId];

    const row = await this.queryOne<{ count: string }>(query, params);
    return parseInt(row?.count ?? '0', 10);
  }

  async getByLogId(logId: string): Promise<WorkflowApproval | null> {
    const row = await this.queryOne<ApprovalRow>(
      `SELECT * FROM workflow_approvals WHERE workflow_log_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [logId, this.userId]
    );
    return row ? mapApproval(row) : null;
  }
}

export function createWorkflowApprovalsRepository(userId = 'default'): WorkflowApprovalsRepository {
  return new WorkflowApprovalsRepository(userId);
}
