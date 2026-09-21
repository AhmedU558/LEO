import { createHash } from 'node:crypto';
import { BaseRepository } from './base.js';
import type { ActionLedgerEntry, ActionLedgerProvider } from '@ownpilot/core/security';
import { generateId } from '@ownpilot/core/services';

interface LedgerRow {
  action_id: string;
  timestamp: string;
  user_id: string;
  workspace_id: string;
  agent_id: string | null;
  task_id: string | null;
  run_id: string | null;
  tool: string;
  action: string;
  resource: string;
  resource_type: string;
  credential_id: string | null;
  capability: string;
  policy_decision: string;
  risk_level: string;
  approval_id: string | null;
  approval_status: string | null;
  execution_environment: string;
  result: string | null;
  error: string | null;
  duration_ms: number;
  cost_usd: string | null;
  previous_hash: string;
  hash: string;
}

function rowToEntry(row: LedgerRow): ActionLedgerEntry {
  return {
    actionId: row.action_id,
    timestamp: new Date(row.timestamp),
    userId: row.user_id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    tool: row.tool,
    action: row.action,
    resource: row.resource,
    resourceType: row.resource_type,
    credentialId: row.credential_id ?? undefined,
    capability: row.capability as ActionLedgerEntry['capability'],
    policyDecision: row.policy_decision as ActionLedgerEntry['policyDecision'],
    riskLevel: row.risk_level as ActionLedgerEntry['riskLevel'],
    approvalId: row.approval_id ?? undefined,
    approvalStatus: row.approval_status ?? undefined,
    executionEnvironment: row.execution_environment,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    durationMs: row.duration_ms,
    costUsd: row.cost_usd ? parseFloat(row.cost_usd) : undefined,
    previousHash: row.previous_hash,
    hash: row.hash,
  };
}

export class ActionLedgerRepository extends BaseRepository implements ActionLedgerProvider {
  /**
   * Records a new ledger entry safely against concurrent writes.
   */
  async record(
    entryData: Omit<ActionLedgerEntry, 'actionId' | 'timestamp' | 'previousHash' | 'hash'>
  ): Promise<ActionLedgerEntry> {
    const actionId = generateId('act');

    // We use a transaction to lock the tail, generate the hash, and append the record
    return await this.transaction(async () => {
      // Lock the tail row for update to serialize writes
      const tailRow = await this.queryOne<{ last_hash: string }>('SELECT last_hash FROM action_ledger_tail WHERE id = 1 FOR UPDATE');
      const timestamp = new Date();
      const previousHash = tailRow ? tailRow.last_hash : 'genesis';
      const hashData = `${actionId}:${timestamp.toISOString()}:${previousHash}:${entryData.userId}:${entryData.action}`;
      const hash = createHash('sha256').update(hashData).digest('hex');

      await this.execute(
        `INSERT INTO action_ledger (
          action_id, timestamp, user_id, workspace_id, agent_id, task_id, run_id,
          tool, action, resource, resource_type, credential_id, capability,
          policy_decision, risk_level, approval_id, approval_status, execution_environment,
          result, error, duration_ms, cost_usd, previous_hash, hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
        )`,
        [
          actionId,
          timestamp.toISOString(),
          entryData.userId,
          entryData.workspaceId,
          entryData.agentId ?? null,
          entryData.taskId ?? null,
          entryData.runId ?? null,
          entryData.tool,
          entryData.action,
          entryData.resource,
          entryData.resourceType,
          entryData.credentialId ?? null,
          entryData.capability,
          entryData.policyDecision,
          entryData.riskLevel,
          entryData.approvalId ?? null,
          entryData.approvalStatus ?? null,
          entryData.executionEnvironment,
          entryData.result ?? null,
          entryData.error ?? null,
          entryData.durationMs,
          entryData.costUsd ?? null,
          previousHash,
          hash,
        ]
      );

      // Advance the tail
      await this.execute('UPDATE action_ledger_tail SET last_hash = $1 WHERE id = 1', [hash]);

      return {
        ...entryData,
        actionId,
        timestamp,
        previousHash,
        hash,
      };
    });
  }

  async updateResult(
    actionId: string,
    resultData: { result?: string; error?: string },
    durationMs: number
  ): Promise<ActionLedgerEntry | undefined> {
    await this.execute(
      `UPDATE action_ledger 
       SET result = COALESCE($1, result), error = COALESCE($2, error), duration_ms = $3 
       WHERE action_id = $4`,
      [resultData.result ?? null, resultData.error ?? null, durationMs, actionId]
    );

    const row = await this.queryOne<LedgerRow>('SELECT * FROM action_ledger WHERE action_id = $1', [
      actionId,
    ]);
    return row ? rowToEntry(row) : undefined;
  }

  async getEntries(userId?: string, limit: number = 100, offset: number = 0): Promise<ActionLedgerEntry[]> {
    if (userId) {
      const rows = await this.query<LedgerRow>(
        'SELECT * FROM action_ledger WHERE user_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3',
        [userId, limit, offset]
      );
      return rows.map(rowToEntry);
    }
    const rows = await this.query<LedgerRow>('SELECT * FROM action_ledger ORDER BY timestamp ASC LIMIT $1 OFFSET $2', [limit, offset]);
    return rows.map(rowToEntry);
  }

  async getByWorkspaceId(workspaceId: string, userId?: string, limit: number = 100, offset: number = 0): Promise<ActionLedgerEntry[]> {
    if (userId) {
      const rows = await this.query<LedgerRow>(
        'SELECT * FROM action_ledger WHERE workspace_id = $1 AND user_id = $2 ORDER BY timestamp ASC LIMIT $3 OFFSET $4',
        [workspaceId, userId, limit, offset]
      );
      return rows.map(rowToEntry);
    }
    const rows = await this.query<LedgerRow>(
      'SELECT * FROM action_ledger WHERE workspace_id = $1 ORDER BY timestamp ASC LIMIT $2 OFFSET $3',
      [workspaceId, limit, offset]
    );
    return rows.map(rowToEntry);
  }

  async getByActionId(actionId: string, userId?: string): Promise<ActionLedgerEntry | undefined> {
    if (userId) {
      const row = await this.queryOne<LedgerRow>(
        'SELECT * FROM action_ledger WHERE action_id = $1 AND user_id = $2',
        [actionId, userId]
      );
      return row ? rowToEntry(row) : undefined;
    }
    const row = await this.queryOne<LedgerRow>('SELECT * FROM action_ledger WHERE action_id = $1', [
      actionId,
    ]);
    return row ? rowToEntry(row) : undefined;
  }

  async clear(): Promise<void> {
    // QA-010: Do not silently destroy production audit history.
    // In production, clearing the audit ledger is not permitted.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ActionLedger cannot be cleared in production');
    }
    await this.execute('TRUNCATE action_ledger CASCADE');
    await this.execute('UPDATE action_ledger_tail SET last_hash = $1 WHERE id = 1', ['genesis']);
  }
}

export const actionLedgerRepo = new ActionLedgerRepository();
