// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup, flushAsyncUpdates } from '../test-harness';
import { ExecutionTasksPanel } from './ExecutionTasksPanel';
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
}));
const subscribe = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('../api/endpoints/execution-tasks', () => ({ executionTasksApi: api }));
vi.mock('../api/endpoints/workflows', () => ({
  workflowsApi: { list: async () => ({ workflows: [{ id: 'wf', name: 'Local research' }] }) },
}));
vi.mock('../hooks/useWebSocket', () => ({ useGateway: () => ({ subscribe }) }));
const task = {
  id: 'task-1',
  workflowId: 'wf',
  workflowRunId: 'run-1',
  state: 'WAITING_APPROVAL',
  outcome: null,
  error: null,
};
const detail = {
  task,
  run: { nodeResults: { a: { status: 'running' } } },
  approvals: [
    { id: 'approval-1', status: 'pending', message: 'Approve local action', expiresAt: null },
  ],
  auditActionIds: ['audit-1'],
};
async function click(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label)
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await flushAsyncUpdates();
}
describe('execution task panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ tasks: [task] });
    api.detail.mockResolvedValue(detail);
    api.approve.mockResolvedValue({});
    api.cancel.mockResolvedValue({});
  });
  afterEach(cleanup);
  it('shows execution details, step output and audit references separately from personal tasks', async () => {
    const root = render(<ExecutionTasksPanel />);
    await flushAsyncUpdates();
    await click(root, 'Local research —');
    expect(root.textContent).toContain('Personal to-dos stay below');
    expect(root.textContent).toContain('run-1');
    expect(root.textContent).toContain('audit-1');
    expect(root.textContent).toContain('Approve local action');
  });
  it('uses scoped execution approval and cancel endpoints', async () => {
    const root = render(<ExecutionTasksPanel />);
    await flushAsyncUpdates();
    await click(root, 'Local research —');
    await click(root, 'Approve');
    expect(api.approve).toHaveBeenCalledWith('task-1', 'approval-1');
    await click(root, 'Cancel execution');
    expect(api.cancel).toHaveBeenCalledWith('task-1');
  });
  it('hides cancellation for completed tasks', async () => {
    api.detail.mockResolvedValue({
      ...detail,
      task: { ...task, state: 'COMPLETED', outcome: 'SUCCESS' },
      approvals: [],
    });
    const root = render(<ExecutionTasksPanel />);
    await flushAsyncUpdates();
    await click(root, 'Local research —');
    expect(root.textContent).toContain('SUCCESS');
    expect(root.textContent).not.toContain('Cancel execution');
  });
  it('shows failures without reporting success', async () => {
    api.list.mockRejectedValue(new Error('Access denied'));
    const root = render(<ExecutionTasksPanel />);
    await flushAsyncUpdates();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Access denied');
  });
  it('reuses submission identity after a network error', async () => {
    api.start.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce(task);
    const root = render(<ExecutionTasksPanel />);
    await flushAsyncUpdates();
    await act(async () => {
      const select = root.querySelector('select')!;
      select.value = 'wf';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(root, 'Start workflow');
    await click(root, 'Start workflow');
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(api.start.mock.calls[0]).toEqual(api.start.mock.calls[1]);
  });
});
