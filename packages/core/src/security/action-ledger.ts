import { createHash } from 'node:crypto';
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

export interface ActionLedgerProvider {
  record(
    entryData: Omit<ActionLedgerEntry, 'actionId' | 'timestamp' | 'previousHash' | 'hash'>
  ): Promise<ActionLedgerEntry>;
  updateResult(
    actionId: string,
    resultData: { result?: string; error?: string },
    durationMs: number
  ): Promise<ActionLedgerEntry | undefined>;
  getEntries(userId?: string): Promise<ActionLedgerEntry[]>;
  getByWorkspaceId(workspaceId: string, userId?: string): Promise<ActionLedgerEntry[]>;
  getByActionId(actionId: string, userId?: string): Promise<ActionLedgerEntry | undefined>;
  clear(): Promise<void>;
}

export class ActionLedger {
  private static provider: ActionLedgerProvider | null = null;
  
  // In-memory fallback for tests or edge execution
  private static lastHash: string = 'genesis';
  private static entries: ActionLedgerEntry[] = [];
  private static indexByWorkspace: Map<string, ActionLedgerEntry[]> = new Map();
  private static indexByActionId: Map<string, ActionLedgerEntry> = new Map();
  
  // Queue to serialize local in-memory writes
  private static writeQueue: Promise<void> = Promise.resolve();

  public static setProvider(provider: ActionLedgerProvider) {
    this.provider = provider;
  }

  public static async record(
    entryData: Omit<ActionLedgerEntry, 'actionId' | 'timestamp' | 'previousHash' | 'hash'>
  ): Promise<ActionLedgerEntry> {
    if (this.provider) {
      return this.provider.record(entryData);
    }
    
    return new Promise((resolve, reject) => {
      this.writeQueue = this.writeQueue.then(async () => {
        try {
          const actionId = generateId('act');
          const timestamp = new Date();
          const previousHash = this.lastHash;
          
          const hashData = `${actionId}:${timestamp.toISOString()}:${previousHash}:${entryData.userId}:${entryData.action}`;
          const hash = createHash('sha256').update(hashData).digest('hex');

          const entry: ActionLedgerEntry = {
            ...entryData,
            actionId,
            timestamp,
            previousHash,
            hash,
          };

          // Deep copy to prevent mutation
          this.entries.push(Object.freeze({ ...entry }));
          this.lastHash = hash;

          this.indexByActionId.set(actionId, entry);
          if (!this.indexByWorkspace.has(entry.workspaceId)) {
            this.indexByWorkspace.set(entry.workspaceId, []);
          }
          this.indexByWorkspace.get(entry.workspaceId)!.push(entry);

          resolve(entry);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  public static async updateResult(
    actionId: string,
    resultData: { result?: string; error?: string },
    durationMs: number
  ): Promise<ActionLedgerEntry | undefined> {
    if (this.provider) {
      return this.provider.updateResult(actionId, resultData, durationMs);
    }

    const entry = this.indexByActionId.get(actionId);
    if (!entry) return undefined;
    
    // Create new object to prevent mutating frozen stored objects
    const updated = Object.freeze({ ...entry, ...resultData, durationMs });
    
    // Update indexes
    this.indexByActionId.set(actionId, updated);
    
    const wsArray = this.indexByWorkspace.get(updated.workspaceId);
    if (wsArray) {
      const idx = wsArray.findIndex(e => e.actionId === actionId);
      if (idx !== -1) wsArray[idx] = updated;
    }
    
    const entriesIdx = this.entries.findIndex(e => e.actionId === actionId);
    if (entriesIdx !== -1) this.entries[entriesIdx] = updated;

    return updated;
  }

  public static async getEntries(userId?: string): Promise<ActionLedgerEntry[]> {
    if (this.provider) return this.provider.getEntries(userId);
    const filtered = userId ? this.entries.filter(e => e.userId === userId) : this.entries;
    // Return deep copies so callers cannot mutate the ledger
    return filtered.map(e => ({ ...e }));
  }

  public static async getByWorkspaceId(workspaceId: string, userId?: string): Promise<ActionLedgerEntry[]> {
    if (this.provider) return this.provider.getByWorkspaceId(workspaceId, userId);
    let arr = this.indexByWorkspace.get(workspaceId) || [];
    if (userId) arr = arr.filter(e => e.userId === userId);
    return arr.map(e => ({ ...e }));
  }

  public static async getByActionId(actionId: string, userId?: string): Promise<ActionLedgerEntry | undefined> {
    if (this.provider) return this.provider.getByActionId(actionId, userId);
    const entry = this.indexByActionId.get(actionId);
    if (entry && (!userId || entry.userId === userId)) {
      return { ...entry };
    }
    return undefined;
  }

  public static async clear(): Promise<void> {
    if (this.provider) {
      await this.provider.clear();
      return;
    }
    this.entries = [];
    this.lastHash = 'genesis';
    this.indexByWorkspace.clear();
    this.indexByActionId.clear();
    this.writeQueue = Promise.resolve();
  }
}
