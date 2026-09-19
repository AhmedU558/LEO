import React, { useEffect, useState } from 'react';
import { Monitor, Play, Square, Globe, Keyboard, MousePointer2 } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { ComputerTask, ComputerAction } from '@ownpilot/core/computer';

export function ComputerControlPage() {
  const toast = useToast();
  const [tasks, setTasks] = useState<ComputerTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [targetUrl, setTargetUrl] = useState('');

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/v1/computer/tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      toast.error('Failed to load computer tasks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreateTask = async () => {
    try {
      const res = await fetch('/api/v1/computer/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl }),
      });
      if (res.ok) {
        toast.success('Task created');
        setTargetUrl('');
        fetchTasks();
      }
    } catch {
      toast.error('Failed to create task');
    }
  };

  const executeAction = async (
    taskId: string,
    actionType: string,
    params: Record<string, unknown> = {}
  ) => {
    const action: ComputerAction = {
      type: actionType as import('@ownpilot/core/computer').ComputerActionType,
      params,
    };
    try {
      const res = await fetch(`/api/v1/computer/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success(`Action ${actionType} executed`);
        } else {
          toast.error(`Action failed: ${data.result?.error || 'Unknown'}`);
        }
        fetchTasks();
      }
    } catch {
      toast.error('Action request failed');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <Monitor className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Computer Control
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Browser and local computer task execution sessions.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-6">
          <h3 className="text-lg font-medium mb-3">New Session</h3>
          <div className="flex gap-3 items-center">
            <input
              type="text"
              className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2"
              placeholder="Target URL (for browser tasks) or leave blank for local"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
            />
            <button
              onClick={handleCreateTask}
              className="flex items-center gap-1 bg-accent text-white px-4 py-2 rounded hover:opacity-90"
            >
              <Play className="w-4 h-4" /> Start Session
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium mb-4">Active & Recent Sessions</h3>
          {isLoading ? (
            <div>Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center text-text-muted border border-dashed rounded-lg border-border">
              No active sessions.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {tasks.map((t) => (
                <div key={t.id} className="p-4 rounded-lg border border-border bg-bg-secondary">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <div className="font-medium">Session {t.id.split('_')[1]}</div>
                      <div className="text-sm text-text-muted">
                        {t.targetUrl || 'Local Environment'} &middot; Status: {t.status}
                      </div>
                    </div>
                    <button className="flex items-center gap-1 bg-red-500/10 text-red-500 px-3 py-1 rounded text-sm hover:bg-red-500/20">
                      <Square className="w-4 h-4" /> Stop
                    </button>
                  </div>

                  <div className="flex gap-2 flex-wrap mb-4">
                    <button
                      onClick={() =>
                        executeAction(t.id, 'navigate', { url: 'https://example.com' })
                      }
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-bg-tertiary border border-border rounded hover:bg-bg-primary"
                    >
                      <Globe className="w-3 h-3" /> Navigate
                    </button>
                    <button
                      onClick={() => executeAction(t.id, 'click', { selector: '#btn' })}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-bg-tertiary border border-border rounded hover:bg-bg-primary"
                    >
                      <MousePointer2 className="w-3 h-3" /> Click
                    </button>
                    <button
                      onClick={() => executeAction(t.id, 'type', { text: 'hello' })}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-bg-tertiary border border-border rounded hover:bg-bg-primary"
                    >
                      <Keyboard className="w-3 h-3" /> Type
                    </button>
                    <button
                      onClick={() => executeAction(t.id, 'screenshot')}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-bg-tertiary border border-border rounded hover:bg-bg-primary"
                    >
                      <Monitor className="w-3 h-3" /> Screenshot
                    </button>
                  </div>

                  <div className="bg-bg-primary rounded p-3 text-xs font-mono max-h-40 overflow-auto border border-border">
                    {t.actions.length === 0 ? (
                      <span className="text-text-muted">No actions executed yet.</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {t.actions.map((act, i) => (
                          <div key={i}>
                            <span className="text-accent">&gt;</span> {act.type}{' '}
                            {JSON.stringify(act.params)}
                            {t.results[i] && (
                              <div
                                className={
                                  t.results[i].success ? 'text-green-500 ml-3' : 'text-red-500 ml-3'
                                }
                              >
                                {t.results[i].success
                                  ? '✓ Success'
                                  : '✗ Failed: ' + t.results[i].error}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
