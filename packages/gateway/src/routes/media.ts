import { Hono } from 'hono';
import { getUserId, getWorkspaceId, apiResponse, apiError, ERROR_CODES } from './helpers.js';
import { MediaService } from '../services/media/service.js';
import { Readable } from 'node:stream';

export const mediaRoutes = new Hono();

mediaRoutes.post('/upload', async (c) => {
  const service = new MediaService(getUserId(c), getWorkspaceId(c));

  // Extract file from multipart
  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  if (!file)
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'No file provided' }, 400);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const stream = Readable.from(Buffer.from(arrayBuffer));
    const asset = await service.uploadMedia(file.name, file.type, stream);
    return apiResponse(c, asset);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

mediaRoutes.get('/', async (c) => {
  const service = new MediaService(getUserId(c), getWorkspaceId(c));
  const assets = await service.listMedia();
  return apiResponse(c, { assets });
});

mediaRoutes.get('/:id', async (c) => {
  const service = new MediaService(getUserId(c), getWorkspaceId(c));
  const asset = await service.getMedia(c.req.param('id'));
  if (!asset) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
  return apiResponse(c, asset);
});

mediaRoutes.delete('/:id', async (c) => {
  const service = new MediaService(getUserId(c), getWorkspaceId(c));
  try {
    await service.deleteMedia(c.req.param('id'));
    return apiResponse(c, { success: true });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

