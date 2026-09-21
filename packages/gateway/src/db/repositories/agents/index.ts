/**
 * Agents Repository (PostgreSQL)
 *
 * Stores agent configurations
 */

import { BaseRepository, parseJsonField } from '../base.js';
import { buildUpdateStatement, type RawSetClause } from '../query-helpers.js';

export interface AgentRecord {
  id: string;
  name: string;
  systemPrompt?: string;
  provider: string;
  model: string;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string | null;
  provider: string;
  model: string;
  config: string;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt ?? undefined,
    provider: row.provider,
    model: row.model,
    config: parseJsonField(row.config, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class AgentsRepository extends BaseRepository {
  // v1.1 Optimization: Safe caching for static Agent Profiles
  private cache = new Map<string, { data: AgentRecord; expires: number }>();
  private cacheTtlMs = 60000; // 1 minute

  /**
   * Per-id write generation (QA-015).
   *
   * A read is not atomic with its cache write: a SELECT can be in flight while
   * an UPDATE commits and invalidates, and the late SELECT would then re-cache
   * the pre-update row for a full TTL. Callers capture the generation before
   * they query and hand it back to `setCache`, which drops the write if a
   * mutation bumped the generation in between. Bounded by the agent set, which
   * is the same key space `cache` already holds.
   */
  private generations = new Map<string, number>();

  private getCached(id: string): AgentRecord | null {
    const entry = this.cache.get(id);
    if (entry && entry.expires > Date.now()) {
      return entry.data;
    }
    return null;
  }

  private generation(id: string): number {
    return this.generations.get(id) ?? 0;
  }

  private setCache(id: string, record: AgentRecord, readGeneration?: number) {
    if (readGeneration !== undefined && readGeneration !== this.generation(id)) return;
    this.cache.set(id, { data: record, expires: Date.now() + this.cacheTtlMs });
  }

  private invalidateCache(id: string) {
    this.cache.delete(id);
    this.generations.set(id, this.generation(id) + 1);
  }

  async create(data: {
    id: string;
    name: string;
    systemPrompt?: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }): Promise<AgentRecord> {
    await this.execute(
      `INSERT INTO agents (id, name, system_prompt, provider, model, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        data.id,
        data.name,
        data.systemPrompt ?? null,
        data.provider,
        data.model,
        JSON.stringify(data.config ?? {}),
      ]
    );

    const result = await this.getById(data.id);
    if (!result) throw new Error('Failed to create agent');
    return result;
  }

  async getById(id: string): Promise<AgentRecord | null> {
    const cached = this.getCached(id);
    if (cached) return cached;

    const readGeneration = this.generation(id);
    const row = await this.queryOne<AgentRow>(`SELECT * FROM agents WHERE id = $1`, [id]);
    if (!row) return null;

    const record = rowToAgent(row);
    this.setCache(id, record, readGeneration);
    return record;
  }

  async getByName(name: string): Promise<AgentRecord | null> {
    const row = await this.queryOne<AgentRow>(`SELECT * FROM agents WHERE name = $1`, [name]);
    return row ? rowToAgent(row) : null;
  }

  async getAll(): Promise<AgentRecord[]> {
    const rows = await this.query<AgentRow>(`SELECT * FROM agents ORDER BY name ASC`);
    return rows.map(rowToAgent);
  }

  async getPage(limit: number, offset: number): Promise<AgentRecord[]> {
    const rows = await this.query<AgentRow>(
      `SELECT * FROM agents ORDER BY name ASC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows.map(rowToAgent);
  }

  async update(
    id: string,
    data: {
      name?: string;
      systemPrompt?: string;
      provider?: string;
      model?: string;
      config?: Record<string, unknown>;
    }
  ): Promise<AgentRecord | null> {
    // QA-015: the existence check must NOT go through getById(). getById()
    // caches what it reads, so checking existence here used to re-populate the
    // cache with the PRE-update row; the read after the UPDATE then hit that
    // entry and returned stale data for up to a full TTL. Read the row
    // directly, and invalidate only once the write has committed.
    const existingRow = await this.queryOne<AgentRow>(`SELECT * FROM agents WHERE id = $1`, [id]);
    if (!existingRow) return null;
    const existing = rowToAgent(existingRow);

    const fields = [
      { column: 'name', value: data.name },
      { column: 'system_prompt', value: data.systemPrompt },
      { column: 'provider', value: data.provider },
      { column: 'model', value: data.model },
      {
        column: 'config',
        value: data.config !== undefined ? JSON.stringify(data.config) : undefined,
      },
    ];

    const hasChanges = fields.some((f) => f.value !== undefined);
    if (!hasChanges) return existing;

    const rawClauses: RawSetClause[] = [{ sql: 'updated_at = NOW()' }];

    const stmt = buildUpdateStatement(
      'agents',
      fields,
      [{ column: 'id', value: id }],
      1,
      rawClauses
    );

    if (!stmt) return existing;

    await this.execute(stmt.sql, stmt.params);
    // Invalidate AFTER the write commits, so any reader that raced the UPDATE
    // has its cache write rejected by the generation check.
    this.invalidateCache(id);

    return this.getById(id);
  }

  /**
   * Atomic upsert for resync: creates if missing, merges config if exists.
   * Uses INSERT...ON CONFLICT to avoid check-then-act race conditions.
   */
  async upsertForResync(data: {
    id: string;
    name: string;
    systemPrompt?: string;
    provider: string;
    model: string;
    config?: Record<string, unknown>;
  }): Promise<void> {
    this.invalidateCache(data.id);
    const configJson = JSON.stringify(data.config ?? {});
    await this.execute(
      `INSERT INTO agents (id, name, system_prompt, provider, model, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         config = agents.config::jsonb || $6::jsonb,
         updated_at = NOW()`,
      [data.id, data.name, data.systemPrompt ?? null, data.provider, data.model, configJson]
    );
  }

  async delete(id: string): Promise<boolean> {
    this.invalidateCache(id);
    const result = await this.execute(`DELETE FROM agents WHERE id = $1`, [id]);
    return result.changes > 0;
  }

  async count(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM agents`);
    return parseInt(row?.count ?? '0', 10);
  }
}

export const agentsRepo = new AgentsRepository();

// Factory function
export function createAgentsRepository(): AgentsRepository {
  return new AgentsRepository();
}
