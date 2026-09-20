import type {
  AnalyticsEngine,
  MetricData,
  LearningRecommendation,
  UsageStats,
} from '@ownpilot/core/analytics';
import { ActionLedger } from '@ownpilot/core/security';

export class AnalyticsService implements AnalyticsEngine {
  private metrics: MetricData[] = [];
  private recommendations: LearningRecommendation[] = [];

  constructor() {
    // Generate some mock historical data for the MVP
    this.metrics.push(
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        category: 'task',
        metric: 'tasks_completed',
        value: 12,
        metadata: {},
      },
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        category: 'cost',
        metric: 'daily_spend_usd',
        value: 1.45,
        metadata: {},
      }
    );

    this.recommendations.push({
      id: 'rec_1',
      title: 'Optimize Browser Polling',
      description:
        'Tasks using the BrowserProvider are polling too frequently, causing unnecessary token usage. Propose increasing wait intervals.',
      sourceType: 'cost_optimization',
      targetComponent: 'BrowserProvider',
      proposedChange: { defaultWaitMs: 2000 },
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }

  async recordMetric(metric: MetricData): Promise<void> {
    this.metrics.push(metric);
    // Observe trends and potentially propose learning
    if (metric.category === 'cost' && metric.value > 5) {
      await this.proposeRecommendation({
        title: 'High spend detected',
        description: 'A task consumed a high budget. Recommend reviewing agent constraints.',
        sourceType: 'failure_trend',
        targetComponent: 'TaskConstraints',
        proposedChange: { budgetLimit: 4.0 },
      });
    }
  }

  async getMetrics(category?: MetricData['category']): Promise<MetricData[]> {
    if (category) return this.metrics.filter((m) => m.category === category);
    return this.metrics;
  }

  async getUsageStats(): Promise<UsageStats> {
    const tasks = this.metrics
      .filter((m) => m.category === 'task' && m.metric === 'tasks_completed')
      .reduce((sum, m) => sum + m.value, 0);
    const costs = this.metrics
      .filter((m) => m.category === 'cost')
      .reduce((sum, m) => sum + m.value, 0);

    return {
      totalTasks: tasks + 5, // add mock baseline
      successRate: 94.5,
      totalCostUsd: costs + 2.1,
      totalTokens: costs * 100000 + 150000,
      activeAgents: 3,
    };
  }

  async proposeRecommendation(
    rec: Omit<LearningRecommendation, 'id' | 'status' | 'createdAt'>
  ): Promise<LearningRecommendation> {
    const newRec: LearningRecommendation = {
      ...rec,
      id: 'rec_' + Date.now(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.recommendations.push(newRec);
    return newRec;
  }

  async getRecommendations(): Promise<LearningRecommendation[]> {
    return this.recommendations;
  }

  async updateRecommendationStatus(
    id: string,
    status: LearningRecommendation['status']
  ): Promise<LearningRecommendation | null> {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = status;

    ActionLedger.record({
      userId: 'system',
      workspaceId: 'system',
      tool: 'learning_pipeline',
      action: 'update_recommendation',
      resource: id,
      resourceType: 'recommendation',
      capability: 'ai.learn',
      policyDecision: 'ALLOW',
      riskLevel: 'LOW',
      executionEnvironment: 'production',
    });

    return rec;
  }
}
