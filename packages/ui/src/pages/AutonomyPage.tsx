import { useEffect, useState } from 'react';
import { Bot, Play, Pause, Square, Activity, AlertCircle } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { AutonomousTask } from '../types/leo';

export function AutonomyPage() {
  const toast = useToast();
  const [tasks, setTasks] = useState<AutonomousTask[]>([]);
  const [goal, setGoal] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/v1/autonomy/tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch {
      toast.error('Failed to load autonomy tasks');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2000); // Polling for MVP
    return () => clearInterval(interval);
  }, []);

  const handleCreateTask = async () => {
    try {
      const res = await fetch('/api/v1/autonomy/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      if (res.ok) {
        toast.success('Autonomous task started');
        setGoal('');
        fetchTasks();
      }
    } catch {
      toast.error('Failed to start task');
    }
  };

  const handleAction = async (taskId: string, action: 'pause' | 'resume' | 'kill') => {
    try {
      const res = await fetch(`/api/v1/autonomy/tasks/${taskId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success(`Task ${action}d`);
        fetchTasks();
      }
    } catch {
      toast.error(`Failed to ${action} task`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Advanced Autonomy
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Goal-driven autonomous agents with bounded budgets and strict security limits.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-6">
          <h3 className="text-lg font-medium mb-3">New Autonomous Task</h3>
          <div className="flex gap-3 items-center">
            <input
              type="text"
              className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2"
              placeholder="e.g. Research competitor pricing and create a summary report"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <button
              onClick={handleCreateTask}
              disabled={!goal}
              className="flex items-center gap-1 bg-accent text-white px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> Start
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium mb-4">Active & Recent Tasks</h3>
          {isLoading ? (
            <div>Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center text-text-muted border border-dashed rounded-lg border-border">
              No active tasks.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {tasks.map((t) => (
                <div key={t.id} className="p-4 rounded-lg border border-border bg-bg-secondary">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="font-medium text-lg mb-1">{t.goal}</div>
                      <div className="flex items-center gap-3 text-sm text-text-muted">
                        <span className="flex items-center gap-1">
                          <Activity className="w-4 h-4" /> {t.status.toUpperCase()}
                        </span>
                        <span>ID: {t.id}</span>
                        <span>Spent: \</span>
                        {t.failures > 0 && (
                          <span className="text-red-500 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" /> {t.failures} failures
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.status === 'executing' ||
                      t.status === 'planning' ||
                      t.status === 'verifying' ? (
                        <button
                          onClick={() => handleAction(t.id, 'pause')}
                          className="p-2 bg-yellow-500/10 text-yellow-500 rounded hover:bg-yellow-500/20"
                          title="Pause"
                        >
                          <Pause className="w-4 h-4" />
                        </button>
                      ) : t.status === 'paused' ? (
                        <button
                          onClick={() => handleAction(t.id, 'resume')}
                          className="p-2 bg-green-500/10 text-green-500 rounded hover:bg-green-500/20"
                          title="Resume"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      ) : null}
                      {t.status !== 'completed' &&
                        t.status !== 'failed' &&
                        t.status !== 'stopped' && (
                          <button
                            onClick={() => handleAction(t.id, 'kill')}
                            className="p-2 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20"
                            title="Stop"
                          >
                            <Square className="w-4 h-4" />
                          </button>
                        )}
                    </div>
                  </div>

                  <div className="bg-bg-primary rounded p-3 text-xs font-mono border border-border">
                    <div className="mb-2 text-text-muted">Current Plan:</div>
                    {t.plan.length === 0 ? (
                      <div className="italic">Generating plan...</div>
                    ) : (
                      <ol className="list-decimal list-inside">
                        {t.plan.map((step, idx) => (
                          <li
                            key={idx}
                            className={
                              idx === t.currentStepIndex
                                ? 'text-accent font-bold'
                                : idx < t.currentStepIndex
                                  ? 'text-green-500 line-through'
                                  : 'text-text-muted'
                            }
                          >
                            {step}
                          </li>
                        ))}
                      </ol>
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
