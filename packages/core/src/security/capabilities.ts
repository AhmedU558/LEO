import type { LeoWorkspaceId } from './identity.js';

export type Capability =
  | 'agent.execute'
  | 'task.execute'
  | 'workflow.execute'
  | 'email.read'
  | 'email.send'
  | 'browser.read'
  | 'browser.navigate'
  | 'computer.read'
  | 'computer.control'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'social.account.read'
  | 'social.content.create'
  | 'social.post.schedule'
  | 'social.post.publish'
  | 'credential.read'
  | 'credential.use'
  | 'memory.read'
  | 'memory.write';

export type LeoRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface CapabilityLease {
  leaseId: string;
  subjectId: string;
  workspaceId: LeoWorkspaceId;
  capability: Capability;
  resourceScope: string;
  issuedAt: Date;
  expiresAt: Date;
  issuedBy: string;
  riskLimit: LeoRiskLevel;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

/**
 * Validates a lease is currently active and valid.
 */
export function isLeaseValid(lease: CapabilityLease): boolean {
  return lease.status === 'ACTIVE' && lease.expiresAt > new Date();
}
