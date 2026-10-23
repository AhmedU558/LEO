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
    // No mock data in production
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
      totalTasks: tasks,
      successRate: tasks > 0 ? 100 : 0,
      totalCostUsd: costs,
      totalTokens: costs * 100000,
      activeAgents: 0,
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
      // Recorded up-front; ActionLedger.updateResult() fills the real duration.
      durationMs: 0,
    });

    return rec;
  }
}
