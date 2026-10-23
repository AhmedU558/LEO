import type { Capability, LeoRiskLevel } from './capabilities.js';
import type { LeoWorkspaceId, LeoUserId } from './identity.js';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';

export interface ApprovalRequest {
  approvalId: string;
  userId: LeoUserId;
  workspaceId: LeoWorkspaceId;
  taskId?: string;
  runId?: string;
  tool: string;
  action: string;
  resource: string;
  capability: Capability;
  risk: LeoRiskLevel;
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
