import { Hono } from 'hono';
import {
  getUserId,
  getWorkspaceId,
  apiResponse,
  apiError,
  ERROR_CODES,
  parseJsonBody,
} from './helpers.js';
import { ContentService } from '../services/content/service.js';

export const contentRoutes = new Hono();

contentRoutes.post('/', async (c) => {
  const service = new ContentService(getUserId(c), getWorkspaceId(c));
  const body = await parseJsonBody(c);
  if (!body) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid body' }, 400);

  try {
    const item = await service.createContent(body as Record<string, unknown>);
    return apiResponse(c, item);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

contentRoutes.get('/', async (c) => {
  const service = new ContentService(getUserId(c), getWorkspaceId(c));
  const items = await service.listContent();
  return apiResponse(c, { items });
});

contentRoutes.get('/:id', async (c) => {
  const service = new ContentService(getUserId(c), getWorkspaceId(c));
  const data = await service.getContent(c.req.param('id'));
  if (!data) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
  return apiResponse(c, data);
});

contentRoutes.post('/:id/variants/:platform', async (c) => {
  const service = new ContentService(getUserId(c), getWorkspaceId(c));
  const body = await parseJsonBody(c);
  if (!body) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid body' }, 400);

  try {
    const variant = await service.setVariant(
      c.req.param('id'),
      c.req.param('platform'),
      body as Record<string, unknown>
    );
    return apiResponse(c, variant);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});
