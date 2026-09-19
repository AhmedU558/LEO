import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { AnalyticsService } from '../services/analytics/service.js';
import type { MetricData, LearningRecommendation } from '@ownpilot/core/analytics';

export const analyticsRoutes = new Hono();
const analyticsService = new AnalyticsService();

analyticsRoutes.get('/metrics', async (c) => {
  const category = c.req.query('category') as MetricData['category'] | undefined;
  const metrics = await analyticsService.getMetrics(category);
  return apiResponse(c, { metrics });
});

analyticsRoutes.get('/usage', async (c) => {
  const stats = await analyticsService.getUsageStats();
  return apiResponse(c, stats);
});

analyticsRoutes.get('/recommendations', async (c) => {
  const recs = await analyticsService.getRecommendations();
  return apiResponse(c, { recommendations: recs });
});

analyticsRoutes.post('/recommendations/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = (await parseJsonBody(c)) as { status: LearningRecommendation['status'] } | null;
  if (!body || !body.status)
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing status' }, 400);

  const updated = await analyticsService.updateRecommendationStatus(id, body.status);
  if (!updated)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Recommendation not found' }, 404);

  return apiResponse(c, updated);
});
