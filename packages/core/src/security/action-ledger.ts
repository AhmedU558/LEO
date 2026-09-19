import { generateId } from '../services/id-utils.js';
import type { Capability, LeoRiskLevel } from './capabilities.js';
import type { PolicyDecisionType } from './policy-engine.js';

export interface ActionLedgerEntry {
  actionId: string;
  timestamp: Date;
  userId: string;
  workspaceId: string;
  agentId?: string;
  taskId?: string;
  runId?: string;
  tool: string;
  action: string;
  resource: string;
  resourceType: string;
  credentialId?: string;
  capability: Capability;
  policyDecision: PolicyDecisionType;
  riskLevel: LeoRiskLevel;
  approvalId?: string;
  approvalStatus?: string;
  executionEnvironment: string;
  result?: string;
  error?: string;
  durationMs: number;
  costUsd?: number;
  previousHash?: string;
  hash: string;
}

export class ActionLedger {
  private static lastHash: string = 'genesis';
  // Note: in memory for phase 2. Would use PG in production.
  private static entries: ActionLedgerEntry[] = [];
  
  // v1.1 Optimization: Indexes for growing datasets
  private static indexByWorkspace: Map<string, ActionLedgerEntry[]> = new Map();
  private static indexByActionId: Map<string, ActionLedgerEntry> = new Map();

  public static async record(
    entryData: Omit<ActionLedgerEntry, 'actionId' | 'timestamp' | 'previousHash' | 'hash'>
  ): Promise<ActionLedgerEntry> {
    const actionId = generateId('act');
    const timestamp = new Date();
    const previousHash = this.lastHash;

    // Simulate tamper-evident hash
    const hashData = `${actionId}:${timestamp.toISOString()}:${previousHash}:${entryData.userId}:${entryData.action}`;
    // Fast pseudo-hash for tests without native crypto dependency
    const hash = Buffer.from(hashData).toString('base64');

    const entry: ActionLedgerEntry = {
      ...entryData,
      actionId,
      timestamp,
      previousHash,
      hash,
    };

    this.entries.push(entry);
    this.lastHash = hash;
    
    // Update indexes
    this.indexByActionId.set(actionId, entry);
    if (!this.indexByWorkspace.has(entry.workspaceId)) {
      this.indexByWorkspace.set(entry.workspaceId, []);
    }
    this.indexByWorkspace.get(entry.workspaceId)!.push(entry);

    return entry;
  }

  public static getEntries(): ActionLedgerEntry[] {
    return [...this.entries];
  }
  
  // v1.1 Optimized query
  public static getByWorkspaceId(workspaceId: string): ActionLedgerEntry[] {
    return this.indexByWorkspace.get(workspaceId) || [];
  }
  
  // v1.1 Optimized query
  public static getByActionId(actionId: string): ActionLedgerEntry | undefined {
    return this.indexByActionId.get(actionId);
  }

  public static clear(): void {
    this.entries = [];
    this.lastHash = 'genesis';
    this.indexByWorkspace.clear();
    this.indexByActionId.clear();
  }
}
