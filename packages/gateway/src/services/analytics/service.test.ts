import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from './service.js';

describe('AnalyticsService - QA-022 Regression', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
  });

  it('does not fabricate baseline analytics or success data in production', async () => {
    // 1. Initial usage stats should reflect NO data (no mocked baseline)
    const stats = await service.getUsageStats();
    expect(stats.totalTasks).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.totalCostUsd).toBe(0);
  });

  it('correctly aggregates persisted metrics', async () => {
    await service.recordMetric({
      timestamp: new Date().toISOString(),
      category: 'task',
      metric: 'tasks_completed',
      value: 10,
      metadata: {},
    });

    await service.recordMetric({
      timestamp: new Date().toISOString(),
      category: 'cost',
      metric: 'daily_spend_usd',
      value: 5,
      metadata: {},
    });

    const stats = await service.getUsageStats();
    expect(stats.totalTasks).toBe(10);
    expect(stats.successRate).toBe(100);
    expect(stats.totalCostUsd).toBe(5);
  });
});
