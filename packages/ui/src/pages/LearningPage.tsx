import { useEffect, useState } from 'react';
import { LineChart, Brain, Activity, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { UsageStats, LearningRecommendation } from '../types/leo';

export function LearningPage() {
  const toast = useToast();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [recommendations, setRecommendations] = useState<LearningRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [statsRes, recsRes] = await Promise.all([
        fetch('/api/v1/analytics/usage'),
        fetch('/api/v1/analytics/recommendations'),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }

      if (recsRes.ok) {
        const data = await recsRes.json();
        setRecommendations(data.recommendations || []);
      }
    } catch {
      toast.error('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRecAction = async (id: string, action: 'approved' | 'rejected') => {
    try {
      const res = await fetch(`/api/v1/analytics/recommendations/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      });
      if (res.ok) {
        toast.success(`Recommendation ${action}`);
        fetchData();
      }
    } catch {
      toast.error('Failed to update recommendation');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <LineChart className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Analytics & Learning
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Unified telemetry, cost tracking, and observational learning recommendations.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div>Loading...</div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Stats Overview */}
            <div>
              <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-accent" /> System Telemetry
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-bg-secondary border border-border p-4 rounded-lg">
                  <div className="text-text-muted text-sm mb-1">Total Tasks</div>
                  <div className="text-2xl font-bold">{stats?.totalTasks || 0}</div>
                </div>
                <div className="bg-bg-secondary border border-border p-4 rounded-lg">
                  <div className="text-text-muted text-sm mb-1">Success Rate</div>
                  <div className="text-2xl font-bold text-green-500">
                    {stats?.successRate || 0}%
                  </div>
                </div>
                <div className="bg-bg-secondary border border-border p-4 rounded-lg">
                  <div className="text-text-muted text-sm mb-1">Total Spend</div>
                  <div className="text-2xl font-bold text-red-500">
                    ${stats?.totalCostUsd?.toFixed(2) || '0.00'}
                  </div>
                </div>
                <div className="bg-bg-secondary border border-border p-4 rounded-lg">
                  <div className="text-text-muted text-sm mb-1">Active Agents</div>
                  <div className="text-2xl font-bold text-accent">{stats?.activeAgents || 0}</div>
                </div>
              </div>
            </div>

            {/* Learning Recommendations */}
            <div>
              <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-500" /> Observational Learning
              </h3>
              <p className="text-sm text-text-muted mb-4">
                LEO identifies patterns from successful/failed executions and cost trends. These
                recommendations require explicit authorization to apply.
              </p>

              <div className="flex flex-col gap-4">
                {recommendations.length === 0 ? (
                  <div className="p-8 text-center border border-dashed rounded border-border text-text-muted">
                    No learning recommendations yet.
                  </div>
                ) : (
                  recommendations.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-4 rounded-lg border border-border bg-bg-secondary"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {rec.sourceType === 'failure_trend' && (
                            <AlertTriangle className="w-5 h-5 text-red-500" />
                          )}
                          {rec.sourceType === 'cost_optimization' && (
                            <TrendingUp className="w-5 h-5 text-yellow-500" />
                          )}
                          {rec.sourceType === 'success_pattern' && (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          )}
                          <h4 className="font-semibold text-lg">{rec.title}</h4>
                        </div>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            rec.status === 'pending'
                              ? 'bg-blue-500/10 text-blue-500'
                              : rec.status === 'approved'
                                ? 'bg-green-500/10 text-green-500'
                                : rec.status === 'rejected'
                                  ? 'bg-red-500/10 text-red-500'
                                  : 'bg-gray-500/10'
                          }`}
                        >
                          {rec.status.toUpperCase()}
                        </span>
                      </div>

                      <p className="text-sm text-text-muted mb-4">{rec.description}</p>

                      <div className="bg-bg-tertiary p-3 rounded font-mono text-xs border border-border mb-4">
                        <div className="text-text-muted mb-1">Target: {rec.targetComponent}</div>
                        <div>Proposed configuration change:</div>
                        <pre className="mt-2 text-accent">
                          {JSON.stringify(rec.proposedChange, null, 2)}
                        </pre>
                      </div>

                      {rec.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRecAction(rec.id, 'approved')}
                            className="px-3 py-1.5 bg-green-500/10 text-green-500 rounded hover:bg-green-500/20 text-sm font-medium"
                          >
                            Authorize Change
                          </button>
                          <button
                            onClick={() => handleRecAction(rec.id, 'rejected')}
                            className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20 text-sm font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
