import { useCallback, useEffect, useRef, useState } from 'react';
import {
  executionTasksApi,
  type ExecutionTask,
  type ExecutionTaskDetail,
} from '../api/endpoints/execution-tasks';
import { workflowsApi } from '../api/endpoints/workflows';
import { useGateway } from '../hooks/useWebSocket';

const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED']);
export function ExecutionTasksPanel() {
  const [tasks, setTasks] = useState<ExecutionTask[]>([]);
  const [workflows, setWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<ExecutionTaskDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submission = useRef<{ workflowId: string; key: string } | null>(null);
  const { subscribe } = useGateway();
  const refresh = useCallback(async () => {
    try {
      const response = await executionTasksApi.list();
      setTasks(response.tasks);
      if (selected) setDetail(await executionTasksApi.detail(selected));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load executions');
    }
  }, [selected]);
  useEffect(() => {
    void workflowsApi
      .list()
      .then((value) => setWorkflows(value.workflows))
      .catch(() => setError('Could not load workflows'));
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe('execution-task:updated', () => {
      void refresh();
    });
    // Polling reconciles missed events after a reconnect; server remains authoritative.
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh, subscribe]);
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Execution action failed');
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!submission.current || submission.current.workflowId !== workflowId)
      submission.current = { workflowId, key: crypto.randomUUID() };
    const task = await executionTasksApi.start(workflowId, submission.current.key);
    submission.current = null;
    setSelected(task.id);
  };
  return (
    <section
      className="p-4 space-y-3 border border-border rounded-lg dark:border-dark-border"
      aria-label="Workflow executions"
    >
      <h3 className="font-semibold">Workflow executions</h3>
      <p className="text-sm text-text-muted">
        Run an existing workflow and inspect its progress. Personal to-dos stay below.
      </p>
      <div className="flex flex-wrap gap-2">
        <label>
          Workflow{' '}
          <select
            aria-label="Workflow"
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            className="p-2 border rounded bg-bg-primary dark:bg-dark-bg-primary"
          >
            <option value="">Choose a workflow</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="px-3 py-2 rounded bg-primary text-white disabled:opacity-50"
          disabled={busy || !workflowId}
          onClick={() => void act(start)}
        >
          Start workflow
        </button>
      </div>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {tasks.length === 0 && <p className="text-sm">No workflow executions yet.</p>}
      <ul className="max-h-40 overflow-auto space-y-1">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              className="text-left underline"
              onClick={() => {
                setDetail(null);
                setSelected(task.id);
              }}
            >
              {workflows.find((w) => w.id === task.workflowId)?.name ?? task.workflowId} —{' '}
              {task.state} — {task.id.slice(0, 8)}
            </button>
          </li>
        ))}
      </ul>
      {detail && detail.task.id === selected && (
        <div className="space-y-2 border-t border-border pt-3" aria-label="Execution details">
          <h4 className="font-semibold">Execution details</h4>
          <p>
            Status: {detail.task.state} {detail.task.outcome && `(${detail.task.outcome})`}
          </p>
          <p className="text-sm break-all">
            Task: {detail.task.id}
            <br />
            Run: {detail.task.workflowRunId ?? 'Not started'}
          </p>
          {detail.task.error && (
            <p role="status" className="text-error">
              {detail.task.error}
            </p>
          )}
          {!terminal.has(detail.task.state) && (
            <button
              disabled={busy}
              onClick={() => void act(() => executionTasksApi.cancel(selected))}
              className="px-3 py-1 border rounded"
            >
              Cancel execution
            </button>
          )}
          {detail.approvals
            .filter((a) => a.status === 'pending')
            .map((a) => (
              <div key={a.id} className="space-x-2">
                <p>
                  {a.message ?? 'Approval required'}
                  {a.expiresAt && ` (expires ${new Date(a.expiresAt).toLocaleString()})`}
                </p>
                <button
                  disabled={
                    busy ||
                    detail.task.state !== 'WAITING_APPROVAL' ||
                    Boolean(a.expiresAt && new Date(a.expiresAt).getTime() <= Date.now())
                  }
                  onClick={() => void act(() => executionTasksApi.approve(selected, a.id))}
                  className="px-3 py-1 border rounded"
                >
                  Approve
                </button>
                <button
                  disabled={busy || detail.task.state !== 'WAITING_APPROVAL'}
                  onClick={() => void act(() => executionTasksApi.deny(selected, a.id))}
                  className="px-3 py-1 border rounded"
                >
                  Deny
                </button>
              </div>
            ))}
          <details>
            <summary>Step results</summary>
            <pre className="text-xs overflow-auto max-h-64">
              {JSON.stringify(detail.run?.nodeResults ?? {}, null, 2)}
            </pre>
          </details>
          <details>
            <summary>Audit references ({detail.auditActionIds.length})</summary>
            <ul>
              {detail.auditActionIds.map((id) => (
                <li key={id} className="text-xs break-all">
                  {id}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
