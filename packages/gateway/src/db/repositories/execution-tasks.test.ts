/**
 * ExecutionTasksRepository tests.
 *
 * The durable execution backbone: tenant scoping, idempotent submission, the
 * state machine (core's real canTransitionExecutionTask, not a stub), optimistic
 * versioning, approval re-enqueue and cancellation cleanup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

const mockAdapter = createMockAdapter();
vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

const { ExecutionTasksRepository, ExecutionTaskRecoveryRepository } =
  await import('./execution-tasks.js');

type Task = Record<string, unknown>;
const task = (over: Task = {}): Task => ({
  id: 'task-1',
  userId: 'user-1',
  workspaceId: 'default',
  workflowId: 'wf-1',
  workflowRunId: null,
  state: 'CREATED',
  version: 1,
  requestKey: 'rk',
  requestHash: 'hash-1',
  jobId: null,
  result: null,
  error: null,
  outcome: null,
  ...over,
});

/** The SQL of every adapter call, in order, for asserting what ran. */
const sqlOf = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]));

describe('ExecutionTasksRepository', () => {
  let repo: InstanceType<typeof ExecutionTasksRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.query.mockResolvedValue([]);
    mockAdapter.queryOne.mockResolvedValue(null);
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    repo = new ExecutionTasksRepository('user-1', 'default');
  });

  it('refuses to construct without a full identity', () => {
    expect(() => new ExecutionTasksRepository('', 'ws')).toThrow('identity required');
    expect(() => new ExecutionTasksRepository('u', '')).toThrow('identity required');
  });

  describe('authorizeWorkflow', () => {
    it('rejects a workflow outside the caller’s workspace', async () => {
      await expect(repo.authorizeWorkflow('wf-x')).rejects.toThrow(
        'Workflow not found in workspace'
      );
      expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['wf-x', 'user-1', 'default']);
    });

    it('skips the membership check in the default workspace', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'wf-1' });
      await repo.authorizeWorkflow('wf-1');
      expect(mockAdapter.queryOne).toHaveBeenCalledTimes(1);
    });

    it('requires active membership of any other workspace', async () => {
      const scoped = new ExecutionTasksRepository('user-1', 'ws-2');
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'wf-1' }).mockResolvedValueOnce(null);
      await expect(scoped.authorizeWorkflow('wf-1')).rejects.toThrow('Workspace access denied');
      mockAdapter.queryOne
        .mockResolvedValueOnce({ id: 'wf-1' })
        .mockResolvedValueOnce({ id: 'ws-2' });
      await expect(scoped.authorizeWorkflow('wf-1')).resolves.toBeUndefined();
      expect(sqlOf(mockAdapter.queryOne).at(-1)).toContain("status='active'");
    });
  });

  it('reads and lists tasks scoped to the caller', async () => {
    await repo.get('task-1');
    expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['task-1', 'user-1', 'default']);
    await repo.list();
    expect(mockAdapter.query.mock.calls[0]![1]).toEqual(['user-1', 'default']);
    expect(sqlOf(mockAdapter.query)[0]).toContain('LIMIT 100');
  });

  describe('create', () => {
    const input = { workflowId: 'wf-1', requestKey: 'rk', requestHash: 'hash-1', inputs: { a: 1 } };

    it('inserts, enqueues a job and moves the task to READY', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ id: 'wf-1' }) // authorizeWorkflow
        .mockResolvedValueOnce(task()) // INSERT ... RETURNING
        .mockResolvedValueOnce(task({ state: 'READY', version: 2 })); // UPDATE ... RETURNING
      const created = await repo.create(input);
      expect(created.state).toBe('READY');
      expect(mockAdapter.transaction).toHaveBeenCalled();
      const insert = mockAdapter.queryOne.mock.calls[1]!;
      expect(String(insert[0])).toContain(
        'ON CONFLICT(user_id,workspace_id,request_key) DO NOTHING'
      );
      expect((insert[1] as unknown[]).slice(1)).toEqual([
        'user-1',
        'default',
        'wf-1',
        'rk',
        'hash-1',
        '{"a":1}',
      ]);
      const [jobSql, jobParams] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(jobSql).toContain('INSERT INTO jobs');
      expect(jobParams[0]).toBe('execution:task-1:2');
      expect(JSON.parse(jobParams[1] as string)).toEqual({
        executionTaskId: 'task-1',
        userId: 'user-1',
        workspaceId: 'default',
      });
      const update = mockAdapter.queryOne.mock.calls[2]![1] as unknown[];
      expect(update[3]).toBe('READY');
      expect(update[5]).toBe('execution:task-1:2');
    });

    it('returns the prior task for a replay with the same request', async () => {
      const prior = task({ state: 'READY' });
      mockAdapter.queryOne
        .mockResolvedValueOnce({ id: 'wf-1' })
        .mockResolvedValueOnce(null) // insert conflicted
        .mockResolvedValueOnce(prior);
      expect(await repo.create(input)).toBe(prior);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it.each([
      ['a different request under the same key', task({ requestHash: 'other' })],
      ['a conflict whose prior row vanished', null],
    ])('rejects %s', async (_case, prior) => {
      mockAdapter.queryOne
        .mockResolvedValueOnce({ id: 'wf-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(prior);
      await expect(repo.create(input)).rejects.toThrow(
        'Idempotency key conflicts with existing submission'
      );
    });

    it('does not insert for a workflow the caller cannot use', async () => {
      await expect(repo.create(input)).rejects.toThrow('Workflow not found');
      expect(sqlOf(mockAdapter.queryOne).some((s) => s.includes('INSERT'))).toBe(false);
    });
  });

  describe('transition', () => {
    it('rejects a missing task', async () => {
      await expect(repo.transition('gone', 1, 'RUNNING')).rejects.toThrow(
        'Execution task not found'
      );
    });

    it('rejects a stale version', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'READY', version: 5 }));
      await expect(repo.transition('task-1', 4, 'RUNNING')).rejects.toThrow(
        'Concurrent execution task transition'
      );
    });

    it('enforces the state machine', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'RUNNING' }));
      // RUNNING must pass through VERIFYING before COMPLETED.
      await expect(
        repo.transition('task-1', 1, 'COMPLETED', { outcome: 'SUCCESS' })
      ).rejects.toThrow('Invalid execution task transition RUNNING -> COMPLETED');
    });

    it('refuses completion without a verified success', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'VERIFYING' }));
      await expect(repo.transition('task-1', 1, 'COMPLETED')).rejects.toThrow(
        'Completion requires verified success'
      );
    });

    it('applies a valid transition, marking terminal states complete', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'VERIFYING', version: 3 }))
        .mockResolvedValueOnce(task({ state: 'COMPLETED', version: 4 }));
      const done = await repo.transition('task-1', 3, 'COMPLETED', {
        outcome: 'SUCCESS',
        result: { ok: true },
      });
      expect(done.state).toBe('COMPLETED');
      const [sql, params] = mockAdapter.queryOne.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('AND version=$11');
      expect(params[3]).toBe('COMPLETED');
      expect(params[6]).toBe('{"ok":true}');
      expect(params[9]).toBe(true); // terminal: completed_at is stamped
      expect(params[10]).toBe(3); // optimistic version check
    });

    it('does not stamp completion for a non-terminal state', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'READY' }))
        .mockResolvedValueOnce(task({ state: 'RUNNING' }));
      await repo.transition('task-1', 1, 'RUNNING');
      expect((mockAdapter.queryOne.mock.calls[1]![1] as unknown[])[9]).toBe(false);
    });

    it('detects a concurrent writer that won the version race', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'READY' }))
        .mockResolvedValueOnce(null);
      await expect(repo.transition('task-1', 1, 'RUNNING')).rejects.toThrow(
        'Concurrent execution task transition'
      );
    });

    it('locks the row it transitions', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'READY' }))
        .mockResolvedValueOnce(task());
      await repo.transition('task-1', 1, 'RUNNING');
      expect(sqlOf(mockAdapter.queryOne)[0]).toContain('FOR UPDATE');
    });
  });

  describe('bindRun', () => {
    it.each([
      ['a task that is not running', task({ state: 'READY' })],
      ['a task bound to another run', task({ state: 'RUNNING', workflowRunId: 'run-other' })],
    ])('rejects %s', async (_case, locked) => {
      mockAdapter.queryOne.mockResolvedValueOnce(locked);
      await expect(repo.bindRun('task-1', 'run-1')).rejects.toThrow('cannot bind this run');
    });

    it('rejects a run that belongs to a different workflow', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'RUNNING' }))
        .mockResolvedValueOnce(null);
      await expect(repo.bindRun('task-1', 'run-1')).rejects.toThrow('Workflow run mismatch');
      expect(mockAdapter.queryOne.mock.calls[1]![1]).toEqual(['run-1', 'wf-1']);
    });

    it('binds a matching run, idempotently for the same run', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'RUNNING', workflowRunId: 'run-1' }))
        .mockResolvedValueOnce({ id: 'run-1' });
      await repo.bindRun('task-1', 'run-1');
      expect(mockAdapter.execute.mock.calls[0]![1]).toEqual(['task-1', 'run-1']);
    });
  });

  describe('whileRunning', () => {
    it('runs the work only while the task is running', async () => {
      const work = vi.fn(async () => 'done');
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'CANCELLED' }));
      await expect(repo.whileRunning('task-1', work)).rejects.toThrow('no longer running');
      expect(work).not.toHaveBeenCalled();
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'RUNNING' }));
      expect(await repo.whileRunning('task-1', work)).toBe('done');
    });
  });

  describe('assertComputerWorker', () => {
    it('accepts only the live lease holder for the bound run', async () => {
      await expect(repo.assertComputerWorker('task-1', 'job-1', 'lease', 'run-1')).rejects.toThrow(
        'Stale computer execution context'
      );
      mockAdapter.queryOne.mockResolvedValueOnce({ id: 'task-1' });
      await expect(
        repo.assertComputerWorker('task-1', 'job-1', 'lease', 'run-1')
      ).resolves.toBeUndefined();
      const [sql, params] = mockAdapter.queryOne.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('j.lease_expires_at>NOW()');
      expect(params).toEqual(['task-1', 'user-1', 'default', 'run-1', 'job-1', 'lease']);
    });
  });

  describe('cancel', () => {
    it('leaves a terminal task untouched', async () => {
      const done = task({ state: 'COMPLETED' });
      mockAdapter.queryOne.mockResolvedValueOnce(done);
      expect(await repo.cancel('task-1')).toBe(done);
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('cancels a running task and cleans up its approvals, jobs and run', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'RUNNING', workflowRunId: 'run-1', jobId: 'job-1' }))
        .mockResolvedValueOnce(task({ state: 'CANCELLED' }));
      const cancelled = await repo.cancel('task-1');
      expect(cancelled.state).toBe('CANCELLED');
      const update = mockAdapter.queryOne.mock.calls[1]![1] as unknown[];
      expect([update[3], update[7], update[8]]).toEqual([
        'CANCELLED',
        'Cancelled by user',
        'CANCELLED',
      ]);
      const executed = sqlOf(mockAdapter.execute);
      expect(executed[0]).toContain("UPDATE workflow_approvals SET status='rejected'");
      expect(executed[1]).toContain("UPDATE jobs SET status='cancelled'");
      expect(mockAdapter.execute.mock.calls[1]![1]).toEqual(['job-1', 'task-1', 'run-1']);
      expect(executed[2]).toContain('UPDATE workflow_logs');
      expect(mockAdapter.execute.mock.calls[2]![1]).toEqual([
        'run-1',
        'cancelled',
        'Cancelled by user',
      ]);
    });

    it('records an UNKNOWN outcome as a failure', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'RUNNING', workflowRunId: 'run-1' }))
        .mockResolvedValueOnce(task({ state: 'FAILED' }));
      await repo.cancel('task-1', 'Lease lost', 'UNKNOWN');
      expect((mockAdapter.queryOne.mock.calls[1]![1] as unknown[])[3]).toBe('FAILED');
      expect(mockAdapter.execute.mock.calls[2]![1]).toEqual(['run-1', 'failed', 'Lease lost']);
    });

    it('skips the run update when no run was ever bound', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'READY' }))
        .mockResolvedValueOnce(task({ state: 'CANCELLED' }));
      await repo.cancel('task-1');
      expect(mockAdapter.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('approve', () => {
    it('requires a task that is waiting for approval', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(task({ state: 'RUNNING' }));
      await expect(repo.approve('task-1', 'appr-1')).rejects.toThrow('not waiting for approval');
    });

    it('rejects an approval that is unavailable or expired', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ state: 'WAITING_APPROVAL', workflowRunId: 'run-1' }))
        .mockResolvedValueOnce(null);
      await expect(repo.approve('task-1', 'appr-1')).rejects.toThrow(
        'Approval unavailable or expired'
      );
      expect(sqlOf(mockAdapter.queryOne)[1]).toContain('(expires_at IS NULL OR expires_at>NOW())');
    });

    it('re-enqueues the task carrying the approval', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(
          task({ state: 'WAITING_APPROVAL', workflowRunId: 'run-1', version: 6 })
        )
        .mockResolvedValueOnce({ id: 'appr-1' })
        .mockResolvedValueOnce(task({ state: 'READY', version: 7 }));
      const ready = await repo.approve('task-1', 'appr-1');
      expect(ready.state).toBe('READY');
      expect(mockAdapter.queryOne.mock.calls[1]![1]).toEqual([
        'appr-1',
        'run-1',
        'user-1',
        'default',
      ]);
      const [, jobParams] = mockAdapter.execute.mock.calls[0] as [string, unknown[]];
      expect(jobParams[0]).toBe('execution:task-1:7');
      expect(JSON.parse(jobParams[1] as string).approvalId).toBe('appr-1');
    });
  });

  describe('detail', () => {
    it('rejects an unknown task', async () => {
      await expect(repo.detail('gone')).rejects.toThrow('Execution task not found');
    });

    it('returns the task with its run, approvals and audit trail', async () => {
      mockAdapter.queryOne
        .mockResolvedValueOnce(task({ workflowRunId: 'run-1' }))
        .mockResolvedValueOnce({ id: 'run-1', status: 'running' });
      mockAdapter.query
        .mockResolvedValueOnce([{ id: 'appr-1' }])
        .mockResolvedValueOnce([{ actionId: 'a-1' }, { actionId: 'a-2' }]);
      const d = await repo.detail('task-1');
      expect(d.run).toEqual({ id: 'run-1', status: 'running' });
      expect(d.approvals).toEqual([{ id: 'appr-1' }]);
      expect(d.auditActionIds).toEqual(['a-1', 'a-2']);
      expect(mockAdapter.query.mock.calls[1]![1]).toEqual(['task-1', 'user-1', 'default']);
    });

    it('reports no run for a task that has not started one', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(task());
      const d = await repo.detail('task-1');
      expect(d.run).toBeNull();
      expect(mockAdapter.queryOne).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ExecutionTaskRecoveryRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks a task up by its run', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce({ id: 'task-1' });
    expect(await new ExecutionTaskRecoveryRepository().byRun('run-1')).toEqual({ id: 'task-1' });
    expect(mockAdapter.queryOne.mock.calls[0]![1]).toEqual(['run-1']);
  });

  it('finds tasks whose job is gone or whose lease has lapsed', async () => {
    mockAdapter.query.mockResolvedValueOnce([{ id: 'stuck' }]);
    expect(await new ExecutionTaskRecoveryRepository().interrupted()).toEqual([{ id: 'stuck' }]);
    const sql = String(mockAdapter.query.mock.calls[0]![0]);
    expect(sql).toContain("state IN ('READY','RUNNING','VERIFYING')");
    expect(sql).toContain('lease_expires_at>NOW()');
  });
});
