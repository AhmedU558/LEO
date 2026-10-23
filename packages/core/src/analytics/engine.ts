import type { MetricData, LearningRecommendation, UsageStats } from './models.js';

export interface AnalyticsEngine {
  recordMetric(metric: MetricData): Promise<void>;
  getMetrics(category?: MetricData['category']): Promise<MetricData[]>;
  getUsageStats(): Promise<UsageStats>;
  proposeRecommendation(
    rec: Omit<LearningRecommendation, 'id' | 'status' | 'createdAt'>
  ): Promise<LearningRecommendation>;
  getRecommendations(): Promise<LearningRecommendation[]>;
  updateRecommendationStatus(
    id: string,
    status: LearningRecommendation['status']
  ): Promise<LearningRecommendation | null>;
}
