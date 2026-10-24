/**
 * Execution task routes tests.
 *
 * The service is mocked, so these pin the route's own contract: the auth and
 * workspace guard, strict input validation, the error mapping (which must not
 * leak internal messages), and that deny only acts on a pending approval.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const svc = vi.hoisted(() => ({
  repo: { list: vi.fn(), detail: vi.fn() },
  start: vi.fn(),
  cancel: vi.fn(),
  approve: vi.fn(),
  ctor: vi.fn(),
}));
vi.mock('../services/execution-task-service.js', () => ({
  ExecutionTaskService: vi.fn(function (this: unknown, ...args: unknown[]) {
    svc.ctor(...args);
    return svc;
  }),
}));

const { executionTaskRoutes } = await import('./execution-tasks.js');

const BASE = '/api/v1/execution-tasks';

function appFor(userId?: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route(BASE, executionTaskRoutes);
  return app;
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

describe('execution task routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = appFor('user-1');
  });

  describe('guard', () => {
    it('rejects an unauthenticated request before touching the service', async () => {
      const res = await appFor().request(BASE);
      expect(res.status).toBe(401);
      expect(svc.ctor).not.toHaveBeenCalled();
    });

    it('rejects a malformed workspace id', async () => {
      const res = await app.request(BASE, { headers: { 'X-Workspace-ID': 'bad ws/../x' } });
      expect(res.status).toBe(400);
      expect(svc.ctor).not.toHaveBeenCalled();
    });

    it('scopes the service to the caller and workspace', async () => {
      svc.repo.list.mockResolvedValueOnce([]);
      await app.request(BASE, { headers: { 'X-Workspace-ID': 'team.alpha-1' } });
      expect(svc.ctor).toHaveBeenCalledWith('user-1', 'team.alpha-1');
    });
  });

  it('lists tasks', async () => {
    svc.repo.list.mockResolvedValueOnce([{ id: 't-1' }]);
    const res = await app.request(BASE);
    expect((await res.json()).data).toEqual({ tasks: [{ id: 't-1' }] });
  });

  describe('submission', () => {
    it('starts a task and answers 202', async () => {
      svc.start.mockResolvedValueOnce({ id: 't-1', state: 'READY' });
      const res = await app.request(
        BASE,
        post({ workflowId: 'wf-1', requestKey: 'rk', inputs: { a: 1 } })
      );
      expect(res.status).toBe(202);
      expect(svc.start).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        requestKey: 'rk',
        inputs: { a: 1 },
      });
    });

    it.each([
      ['a missing request key', { workflowId: 'wf-1' }],
      ['an empty workflow id', { workflowId: '', requestKey: 'rk' }],
      ['an unknown field', { workflowId: 'wf-1', requestKey: 'rk', userId: 'someone-else' }],
      ['non-object inputs', { workflowId: 'wf-1', requestKey: 'rk', inputs: [1, 2] }],
      ['a body that is not JSON', 'not json'],
    ])('rejects %s', async (_case, body) => {
      const res = await app.request(BASE, post(body));
      expect(res.status).toBe(400);
      expect(svc.start).not.toHaveBeenCalled();
    });
  });

  describe('error mapping', () => {
    it('hides not-found and access-denied behind one 404', async () => {
      for (const message of ['Execution task not found', 'Workspace access denied']) {
        svc.repo.detail.mockRejectedValueOnce(new Error(message));
        const res = await app.request(`${BASE}/t-1`);
        expect(res.status).toBe(404);
        // Not leaking which of the two it was.
        expect((await res.json()).error.message).toBe('Execution task or workflow not found');
      }
    });

    it.each([
      'Concurrent execution task transition',
      'Idempotency key conflicts with existing submission',
      'Execution task is not waiting for approval',
      'Approval unavailable or expired',
    ])('reports a state conflict as 409: %s', async (message) => {
      svc.cancel.mockRejectedValueOnce(new Error(message));
      const res = await app.request(`${BASE}/t-1/cancel`, { method: 'POST' });
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe(message);
    });

    it('does not leak an unexpected internal error', async () => {
      svc.repo.list.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
      const res = await app.request(BASE);
      expect(res.status).toBe(500);
      expect((await res.json()).error.message).toBe('Execution task operation failed');
    });
  });

  it('returns task detail', async () => {
    svc.repo.detail.mockResolvedValueOnce({ task: { id: 't-1' } });
    expect((await (await app.request(`${BASE}/t-1`)).json()).data).toEqual({ task: { id: 't-1' } });
    expect(svc.repo.detail).toHaveBeenCalledWith('t-1');
  });

  it('cancels a task', async () => {
    svc.cancel.mockResolvedValueOnce({ id: 't-1', state: 'CANCELLED' });
    const res = await app.request(`${BASE}/t-1/cancel`, { method: 'POST' });
    expect((await res.json()).data.state).toBe('CANCELLED');
    expect(svc.cancel).toHaveBeenCalledWith('t-1');
  });

  it('approves a pending approval and answers 202', async () => {
    svc.approve.mockResolvedValueOnce({ id: 't-1', state: 'READY' });
    const res = await app.request(`${BASE}/t-1/approvals/a-1/approve`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(svc.approve).toHaveBeenCalledWith('t-1', 'a-1');
  });

  describe('deny', () => {
    const detail = (approvals: unknown[]) => ({ task: { id: 't-1' }, approvals });

    it.each([
      ['an unknown approval', [{ id: 'other', status: 'pending' }]],
      ['an approval that was already decided', [{ id: 'a-1', status: 'approved' }]],
      ['a task with no approvals', []],
    ])('refuses %s without cancelling', async (_case, approvals) => {
      svc.repo.detail.mockResolvedValueOnce(detail(approvals));
      const res = await app.request(`${BASE}/t-1/approvals/a-1/deny`, { method: 'POST' });
      expect(res.status).toBe(404);
      expect(svc.cancel).not.toHaveBeenCalled();
    });

    it('cancels the task when the approval is pending', async () => {
      svc.repo.detail.mockResolvedValueOnce(detail([{ id: 'a-1', status: 'pending' }]));
      svc.cancel.mockResolvedValueOnce({ id: 't-1', state: 'CANCELLED' });
      const res = await app.request(`${BASE}/t-1/approvals/a-1/deny`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(svc.cancel).toHaveBeenCalledWith('t-1');
    });
  });
});
