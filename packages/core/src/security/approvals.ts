import type { Capability, RiskLevel } from './capabilities.js';
import type { WorkspaceId, UserId } from './identity.js';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';

export interface ApprovalRequest {
  approvalId: string;
  userId: UserId;
  workspaceId: WorkspaceId;
  taskId?: string;
  runId?: string;
  tool: string;
  action: string;
  resource: string;
  capability: Capability;
  risk: RiskLevel;
  requestedParameters: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: Date;
  expiresAt: Date;
}

export function cancelPendingApproval(approval: ApprovalRequest): void {
  if (approval.status === 'PENDING') {
    approval.status = 'CANCELLED';
  }
}
