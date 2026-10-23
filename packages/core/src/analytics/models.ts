export interface MetricData {
  timestamp: string;
  category: 'task' | 'tool' | 'social' | 'cost' | 'agent';
  metric: string;
  value: number;
  metadata: Record<string, unknown>;
}

export interface LearningRecommendation {
  id: string;
  title: string;
  description: string;
  sourceType: 'success_pattern' | 'failure_trend' | 'user_feedback' | 'cost_optimization';
  targetComponent: string;
  proposedChange: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
}

export interface UsageStats {
  totalTasks: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
  activeAgents: number;
}
