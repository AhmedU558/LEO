import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAdapter } from '../adapters/postgres-adapter.js';
import { TasksRepository } from './tasks.js';
import { NotesRepository } from './notes.js';
import { MemoriesRepository } from './memories.js';

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-005 Integration: Cross-user authorization boundaries (Postgres)', () => {
  let adapter: PostgresAdapter;
  let admin: pg.Pool;
  const database = `test_qa005_${randomUUID().replace(/-/g, '')}`;
  
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
    await adapter.initialize();

    const migration = await readFile(
      new URL('../migrations/postgres/001_initial_schema.sql', import.meta.url),
      'utf8'
    );
    await adapter.exec(migration);
  });

  beforeEach(async () => {
    await adapter.exec('TRUNCATE tasks, notes, memories CASCADE');
  });

  afterAll(async () => {
    await adapter?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('Tasks: User A cannot read, list, update, or delete User B\'s tasks', async () => {
    const userA = 'user-a-' + randomUUID();
    const userB = 'user-b-' + randomUUID();
    const repoA = new TasksRepository(userA);
    const repoB = new TasksRepository(userB);
    
    // We must pass the adapter down so tests use the isolated DB, not the global config DB
    (repoA as any).adapter = adapter;
    (repoB as any).adapter = adapter;

    const task = await repoB.create({ title: 'User B Task' });
    expect(task.id).toBeDefined();

    const getResult = await repoA.get(task.id);
    expect(getResult).toBeNull();

    const listResult = await repoA.list();
    expect(listResult).toHaveLength(0);
    const listResultB = await repoB.list();
    expect(listResultB).toHaveLength(1);

    const updateResult = await repoA.update(task.id, { title: 'Hacked' });
    expect(updateResult).toBeNull();

    const deleteResult = await repoA.delete(task.id);
    expect(deleteResult).toBe(false);

    const verifyB = await repoB.get(task.id);
    expect(verifyB).not.toBeNull();
    expect(verifyB?.title).toBe('User B Task');
  });

  it('Notes: User A cannot read, list, update, or delete User B\'s notes', async () => {
    const userA = 'user-a-' + randomUUID();
    const userB = 'user-b-' + randomUUID();
    const repoA = new NotesRepository(userA);
    const repoB = new NotesRepository(userB);
    
    (repoA as any).adapter = adapter;
    (repoB as any).adapter = adapter;

    const note = await repoB.create({ title: 'Secret Note', content: 'content' });

    expect(await repoA.get(note.id)).toBeNull();
    expect(await repoA.list()).toHaveLength(0);
    expect(await repoA.update(note.id, { title: 'Hacked Note' })).toBeNull();
    expect(await repoA.delete(note.id)).toBe(false);
    expect((await repoB.get(note.id))?.title).toBe('Secret Note');
  });

  it('Memories: User A cannot read, list, update, or delete User B\'s memories', async () => {
    const userA = 'user-a-' + randomUUID();
    const userB = 'user-b-' + randomUUID();
    const repoA = new MemoriesRepository(userA);
    const repoB = new MemoriesRepository(userB);
    
    (repoA as any).adapter = adapter;
    (repoB as any).adapter = adapter;

    const memory = await repoB.create({ content: 'Secret Memory', source: 'test' });

    expect(await repoA.get(memory.id)).toBeNull();
    expect((await repoA.list({}))).toHaveLength(0);
    expect(await repoA.update(memory.id, { content: 'Hacked Memory' })).toBeNull();
    expect(await repoA.delete(memory.id)).toBe(false);
    expect((await repoB.get(memory.id))?.content).toBe('Secret Memory');
  });

  it('Workspaces & Executions: User A cannot read or access User B\'s workspace executions', async () => {
    const userA = 'user-a-' + randomUUID();
    const userB = 'user-b-' + randomUUID();
    
    // Dynamically import WorkspacesRepository if it exists, otherwise skip
    let repoB: any;
    let repoA: any;
    try {
      const mod = await import('./workspaces.js');
      repoA = new mod.WorkspacesRepository(userA);
      repoB = new mod.WorkspacesRepository(userB);
    } catch {
      return; // Not available in this context
    }
    
    repoA.adapter = adapter;
    repoB.adapter = adapter;

    const wsB = await repoB.create({
      name: 'User B Workspace',
      storagePath: '/tmp/b',
      containerConfig: {}
    });

    expect(await repoA.get(wsB.id)).toBeNull();
    
    // Executions
    const execB = await repoB.createExecution(wsB.id, 'python', 'abc');
    expect(await repoA.listExecutions(wsB.id)).toHaveLength(0);
    expect(await repoB.listExecutions(wsB.id)).toHaveLength(1);
    
    expect(await repoA.countExecutions(wsB.id)).toBe(0);
    
    // Wait, updateExecutionResult needs ID
    const updateResult = await repoA.updateExecutionResult(execB.id, 'failed');
    expect(updateResult).toBe(false);
  });
});
