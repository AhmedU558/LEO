import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresAdapter } from '../db/adapters/postgres-adapter.js';
import { initializeSchema } from '../db/schema/index.js';
import { EXECUTION_TASKS_SQL } from '../db/schema/execution-tasks.js';
import { ActionLedger } from '@ownpilot/core/security';
import { setToolService, type IToolService } from '@ownpilot/core/services';
import { ActionLedgerRepository } from '../db/repositories/action-ledger.js';
import { JobsRepository } from '../db/repositories/jobs.js';
import {
  createWorkflowsRepository,
  type WorkflowNode,
} from '../db/repositories/workflows/index.js';
import { createWorkflowApprovalsRepository } from '../db/repositories/workflows/approvals.js';
import { TasksRepository } from '../db/repositories/tasks.js';
import {
  ExecutionTaskService,
  reconcileExecutionTasks,
  registerExecutionTaskWorker,
} from './execution-task-service.js';
import { executionTaskContext } from './execution-task-context.js';
import { executionTaskRoutes } from '../routes/execution-tasks.js';
import { JobQueueService } from './job-queue-service.js';

const db = vi.hoisted(() => ({ adapter: null as unknown as PostgresAdapter }));
vi.mock('../db/adapters/index.js', () => ({ getAdapter: async () => db.adapter }));
const sockets = vi.hoisted(() => ({ getAll: vi.fn(() => []), send: vi.fn() }));
vi.mock('../ws/session.js', () => ({ sessionManager: sockets }));
const url = process.env.LEO_QA_POSTGRES_URL;
describe.skipIf(!url)('durable execution tasks with PostgreSQL and real workflow runtime', () => {
  const database = `leo_exec_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let execute: ReturnType<typeof vi.fn>;
  const user = 'alice';
  const service = () => new ExecutionTaskService(user, 'default');
  const jobs = () => new JobsRepository();
  const node = (id: string, type = 'toolNode'): WorkflowNode =>
    ({
      id,
      type,
      position: { x: 0, y: 0 },
      data:
        type === 'toolNode'
          ? { toolName: 'local_read', toolArgs: {} }
          : { approvalMessage: 'Continue?' },
    }) as WorkflowNode;
  const workflow = async (approval = false) =>
    createWorkflowsRepository(user).create({
      name: 'Local fixture',
      nodes: approval ? [node('approve', 'approvalNode'), node('read')] : [node('read')],
      edges: approval ? [{ id: 'edge', source: 'approve', target: 'read' }] : [],
    });
  const start = async (approval = false) => {
    const wf = await workflow(approval);
    return service().start({ workflowId: wf.id, requestKey: randomUUID() });
  };
  const runNext = async () => {
    const job = await jobs().claimJob('execution_tasks');
    expect(job).not.toBeNull();
    const result = await service().execute(job!, new AbortController().signal);
    await jobs().complete(job!.id, result, job!.leaseToken!);
    return result;
  };
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url!);
    testUrl.pathname = `/${database}`;
    db.adapter = new PostgresAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });
    await db.adapter.initialize();
    await initializeSchema((sql) => db.adapter.exec(sql));
    await db.adapter.exec(
      await readFile(
        new URL('../db/migrations/postgres/003_action_ledger.sql', import.meta.url),
        'utf8'
      )
    );
    await db.adapter.exec(
      await readFile(
        new URL('../db/migrations/postgres/004_approval_integrity.sql', import.meta.url),
        'utf8'
      )
    );
    await db.adapter.exec(EXECUTION_TASKS_SQL);
    ActionLedger.setProvider(new ActionLedgerRepository());
  });
  beforeEach(async () => {
    await db.adapter.exec(
      'TRUNCATE execution_tasks,workflow_approvals,workflow_logs,workflow_versions,workflows,jobs,job_history,idempotency_keys,action_ledger,tasks CASCADE'
    );
    await db.adapter.execute("UPDATE action_ledger_tail SET last_hash='genesis' WHERE id=1");
    execute = vi.fn(async () => ({ success: true, content: { answer: 42 } }));
    setToolService({
      execute,
      getDefinition: () => undefined,
      getDefinitions: () => [],
      getDefinitionsBySource: () => [],
      has: () => true,
      getNames: () => ['local_read'],
      use: () => {},
      getCount: () => 1,
    } as IToolService);
    sockets.getAll.mockReturnValue([]);
    sockets.send.mockClear();
  });
  afterAll(async () => {
    await JobQueueService.getInstance().shutdown();
    await db.adapter?.close();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });
  it('completes through the existing job worker and correlates steps and ledger', async () => {
    const task = await start();
    execute.mockImplementation(async () => {
      expect(executionTaskContext.getStore()?.taskId).toBe(task.id);
      return { success: true, content: { answer: 42 } };
    });
    const stop = registerExecutionTaskWorker();
    try {
      await expect.poll(async () => (await service().repo.get(task.id))?.state).toBe('COMPLETED');
    } finally {
      stop();
    }
    const detail = await service().repo.detail(task.id);
    expect(detail.task.outcome).toBe('SUCCESS');
    expect(detail.run?.status).toBe('completed');
    expect(detail.auditActionIds.length).toBeGreaterThanOrEqual(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent submissions and rejects changed inputs', async () => {
    const wf = await workflow();
    const input = { workflowId: wf.id, requestKey: 'same' };
    const tasks = await Promise.all(Array.from({ length: 8 }, () => service().start(input)));
    expect(new Set(tasks.map((t) => t.id)).size).toBe(1);
    expect((await db.adapter.query('SELECT id FROM jobs')).length).toBe(1);
    await expect(service().start({ ...input, inputs: { different: true } })).rejects.toThrow(
      /conflict/
    );
  });
  it('denies unauthenticated, cross-user and cross-workspace HTTP access', async () => {
    const task = await start();
    const app = new Hono();
    app.use('*', async (c, next) => {
      const uid = c.req.header('test-user');
      if (uid) c.set('userId', uid);
      return next();
    });
    app.route('/execution-tasks', executionTaskRoutes);
    expect((await app.request(`/execution-tasks/${task.id}`)).status).toBe(401);
    expect(
      (await app.request(`/execution-tasks/${task.id}`, { headers: { 'test-user': 'bob' } })).status
    ).toBe(404);
    expect(
      (
        await app.request(`/execution-tasks/${task.id}`, {
          headers: { 'test-user': user, 'X-Workspace-ID': 'other' },
        })
      ).status
    ).toBe(404);
    expect(
      (await app.request(`/execution-tasks/${task.id}`, { headers: { 'test-user': user } })).status
    ).toBe(200);
    await expect(
      new ExecutionTaskService('bob', 'default').start({
        workflowId: task.workflowId,
        requestKey: 'x',
      })
    ).rejects.toThrow(/not found/);
  });
  it('waits for approval then resumes through a new durable job', async () => {
    const task = await start(true);
    await runNext();
    let detail = await service().repo.detail(task.id);
    expect(detail.task.state).toBe('WAITING_APPROVAL');
    expect(execute).not.toHaveBeenCalled();
    const approvalId = String(detail.approvals[0]!.id);
    await expect(
      new ExecutionTaskService('bob', 'default').approve(task.id, approvalId)
    ).rejects.toThrow(/not found/);
    await expect(
      new ExecutionTaskService(user, 'other').approve(task.id, approvalId)
    ).rejects.toThrow(/not found/);
    await service().approve(task.id, approvalId);
    await runNext();
    detail = await service().repo.detail(task.id);
    expect(detail.task.state).toBe('COMPLETED');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancels pending approvals and prevents legacy or late approval replay', async () => {
    const task = await start(true);
    await runNext();
    const detail = await service().repo.detail(task.id);
    const approvalId = String(detail.approvals[0]!.id);
    expect(
      (await createWorkflowApprovalsRepository(user).decide(approvalId, 'approved', 'default'))
        ?.status
    ).toBe('pending');
    await service().cancel(task.id);
    await expect(service().approve(task.id, approvalId)).rejects.toThrow(/not waiting/);
    expect(
      (await createWorkflowApprovalsRepository(user).decide(approvalId, 'approved', 'default'))
        ?.status
    ).toBe('rejected');
    expect((await service().repo.get(task.id))?.state).toBe('CANCELLED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('preserves cancellation when a running step completes late', async () => {
    const task = await start();
    let release!: () => void;
    let entered!: () => void;
    const began = new Promise<void>((resolve) => {
      entered = resolve;
    });
    execute.mockImplementation(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { success: true, content: 'late' };
    });
    const job = await jobs().claimJob('execution_tasks');
    const pending = service()
      .execute(job!, new AbortController().signal)
      .catch((e) => e);
    await began;
    await service().cancel(task.id);
    release();
    await pending;
    const detail = await service().repo.detail(task.id);
    expect(detail.task.state).toBe('CANCELLED');
    expect(detail.run?.status).toBe('cancelled');
  });
  it('recovers interrupted leased work as UNKNOWN without replay and preserves queued work', async () => {
    const task = await start();
    await reconcileExecutionTasks();
    expect((await service().repo.get(task.id))?.state).toBe('READY');
    await jobs().claimJob('execution_tasks');
    await service().repo.transition(task.id, task.version, 'RUNNING');
    await db.adapter.execute(
      "UPDATE jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [task.jobId]
    );
    await reconcileExecutionTasks();
    const recovered = await service().repo.get(task.id);
    expect(recovered?.state).toBe('FAILED');
    expect(recovered?.outcome).toBe('UNKNOWN');
    expect(execute).not.toHaveBeenCalled();
  });
  it('preserves approval waits across reconciliation and rejects expired approval', async () => {
    const task = await start(true);
    await runNext();
    await reconcileExecutionTasks();
    const detail = await service().repo.detail(task.id);
    expect(detail.task.state).toBe('WAITING_APPROVAL');
    await db.adapter.execute("UPDATE workflow_approvals SET expires_at=NOW()-INTERVAL '1 second'");
    await expect(service().approve(task.id, String(detail.approvals[0]!.id))).rejects.toThrow(
      /expired/
    );
  });
  it('rejects a stale state version and never completes a task without verified success', async () => {
    const task = await start();
    await service().repo.transition(task.id, task.version, 'RUNNING');
    await expect(service().repo.transition(task.id, task.version, 'RUNNING')).rejects.toThrow(
      /Concurrent/
    );
    const running = (await service().repo.get(task.id))!;
    await expect(
      service().repo.transition(task.id, running.version, 'COMPLETED', { outcome: 'SUCCESS' })
    ).rejects.toThrow(/Invalid/);
  });
  it('rejects unknown tool outcomes rather than fabricating success', async () => {
    execute.mockResolvedValue({ isError: true, content: 'Unknown provider outcome' });
    const task = await start();
    await expect(runNext()).rejects.toThrow();
    const result = await service().repo.get(task.id);
    expect(result?.state).toBe('FAILED');
    expect(result?.outcome).toBe('UNKNOWN');
  });
  it('rejects tampered worker identity and changed workflow definitions', async () => {
    const task = await start();
    const job = (await jobs().claimJob('execution_tasks'))!;
    await expect(
      new ExecutionTaskService('bob', 'default').execute(job, new AbortController().signal)
    ).rejects.toThrow(/identity/);
    await createWorkflowsRepository(user).update(task.workflowId, { nodes: [node('changed')] });
    await expect(service().execute(job, new AbortController().signal)).rejects.toThrow(/changed/);
    expect(execute).not.toHaveBeenCalled();
  });
  it('isolates realtime notifications by authenticated owner and workspace', async () => {
    const task = await start();
    sockets.getAll.mockReturnValue([
      { id: 'own', userId: user, metadata: {} },
      { id: 'other', userId: 'bob', metadata: {} },
      { id: 'workspace', userId: user, metadata: { currentWorkspace: 'other' } },
      { id: 'anonymous', metadata: {} },
    ] as never);
    service().notify(task);
    expect(sockets.send).toHaveBeenCalledTimes(1);
    expect(sockets.send).toHaveBeenCalledWith(
      'own',
      'execution-task:updated',
      expect.objectContaining({ id: task.id })
    );
  });
  it('keeps personal to-do records and statuses separate', async () => {
    const todos = new TasksRepository(user);
    const todo = await todos.create({ title: 'Buy milk' });
    expect(todo.status).toBe('pending');
    await start();
    expect((await todos.get(todo.id))?.status).toBe('pending');
    expect(await service().repo.get(todo.id)).toBeNull();
  });
});
