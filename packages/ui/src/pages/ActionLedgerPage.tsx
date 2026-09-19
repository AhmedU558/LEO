import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, Activity, AlertTriangle, Info } from 'lucide-react';

interface LedgerEntry {
  actionId: string;
  timestamp: string;
  userId: string;
  workspaceId: string;
  tool: string;
  action: string;
  resource: string;
  resourceType: string;
  capability: string;
  policyDecision: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  executionEnvironment: string;
  durationMs: number;
  result?: string;
  error?: string;
  hash: string;
}

export const ActionLedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLedger = async () => {
      try {
        const res = await fetch('/api/v1/ledger');
        if (!res.ok) throw new Error('Failed to fetch ledger');
        const data = await res.json();
        setEntries(data.entries || []);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchLedger();
  }, []);

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Action Ledger
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Immutable audit trail of all agent and workflow executions.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : error ? (
          <div className="p-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-text-secondary dark:text-dark-text-secondary">
            <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium mb-2">No Ledger Entries</h3>
            <p>
              The action ledger is currently empty. Workflow and agent actions will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg shadow overflow-hidden border border-border dark:border-dark-border">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border dark:border-dark-border text-xs uppercase tracking-wider text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  <th className="p-4 font-medium">Timestamp</th>
                  <th className="p-4 font-medium">Action</th>
                  <th className="p-4 font-medium">Capability</th>
                  <th className="p-4 font-medium">Risk</th>
                  <th className="p-4 font-medium">Decision</th>
                  <th className="p-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark-border text-sm">
                {entries.map((entry) => (
                  <tr
                    key={entry.actionId}
                    className="hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                  >
                    <td className="p-4 whitespace-nowrap text-text-secondary dark:text-dark-text-secondary">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-accent">{entry.action}</div>
                      <div className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                        {entry.tool} &middot; {entry.resourceType}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        {entry.capability}
                      </span>
                    </td>
                    <td className="p-4">
                      <span
                        className={
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
                          (entry.riskLevel === 'CRITICAL' || entry.riskLevel === 'HIGH'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                            : entry.riskLevel === 'MEDIUM'
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                              : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400')
                        }
                      >
                        {entry.riskLevel}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {entry.policyDecision === 'ALLOW' ? (
                          <ShieldCheck className="w-4 h-4 text-green-500" />
                        ) : entry.policyDecision === 'DENY' ? (
                          <ShieldAlert className="w-4 h-4 text-red-500" />
                        ) : (
                          <Info className="w-4 h-4 text-yellow-500" />
                        )}
                        <span className="font-medium">{entry.policyDecision}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      {entry.error ? (
                        <span
                          className="text-red-500 dark:text-red-400 truncate max-w-[150px] inline-block"
                          title={entry.error}
                        >
                          {entry.error}
                        </span>
                      ) : (
                        <span className="text-green-500 dark:text-green-400">
                          {entry.result || 'Success'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
