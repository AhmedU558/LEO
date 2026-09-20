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
  | 'memory.write'
  | 'ai.learn'
  | 'ai.execute'
  | 'shell'
  | 'social.write';

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

export const CAPABILITY_RISKS: Record<Capability, LeoRiskLevel> = {
  'agent.execute': 'MEDIUM',
  'task.execute': 'LOW',
  'workflow.execute': 'MEDIUM',
  'email.read': 'HIGH',
  'email.send': 'HIGH',
  'browser.read': 'LOW',
  'browser.navigate': 'LOW',
  'computer.read': 'HIGH',
  'computer.control': 'CRITICAL',
  'filesystem.read': 'LOW',
  'filesystem.write': 'HIGH',
  'shell.execute': 'CRITICAL',
  'social.account.read': 'LOW',
  'social.content.create': 'MEDIUM',
  'social.post.schedule': 'MEDIUM',
  'social.post.publish': 'HIGH',
  'credential.read': 'CRITICAL',
  'credential.use': 'HIGH',
  'memory.read': 'LOW',
  'memory.write': 'LOW',
  'ai.learn': 'LOW',
  'ai.execute': 'MEDIUM',
  shell: 'CRITICAL',
  'social.write': 'MEDIUM',
};

/**
 * Validates a lease is currently active and valid.
 */
export function isLeaseValid(lease: CapabilityLease): boolean {
  return lease.status === 'ACTIVE' && lease.expiresAt > new Date();
}
