import { getUserId, getWorkspaceId } from './helpers.js';
import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { SocialService } from '../services/social/service.js';
import type { SocialPost } from '@ownpilot/core/social';
import { SocialRepository } from '../db/repositories/social.js';
import { socialProviderRegistry } from '../services/social/provider-registry.js';
import { randomUUID } from 'node:crypto';

export const socialRoutes = new Hono();

socialRoutes.get('/accounts', async (c) => {
  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  const accounts = await service.listAccounts();
  return apiResponse(c, { accounts });
});

socialRoutes.get('/accounts/:id/status', async (c) => {
  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  const status = await service.getAccountStatus(c.req.param('id'));
  return apiResponse(c, { status });
});

socialRoutes.get('/publish', async (c) => {
  const repo = new SocialRepository(getUserId(c), getWorkspaceId(c));
  const content = await repo.listPublishRequests();
  return apiResponse(c, { content });
});

socialRoutes.post('/publish', async (c) => {
  const body = (await parseJsonBody(c)) as Omit<
    SocialPost,
    'id' | 'userId' | 'workspaceId' | 'createdAt' | 'updatedAt'
  > | null;
  if (!body || !body.text || !body.platform || !body.accountId) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing fields' }, 400);
  }

  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  try {
    const result = await service.createPublishTask(body);
    return apiResponse(c, result);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

socialRoutes.get('/publish/:id', async (c) => {
  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  const request = await service.getPublishStatus(c.req.param('id'));
  if (!request) return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Not found' }, 404);
  return apiResponse(c, { request });
});

socialRoutes.post('/publish/:id/cancel', async (c) => {
  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  try {
    const success = await service.cancelPublish(c.req.param('id'));
    return apiResponse(c, { success });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

socialRoutes.post('/publish/:id/reconcile', async (c) => {
  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  try {
    const result = await service.reconcilePublish(c.req.param('id'));
    return apiResponse(c, result);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

socialRoutes.get('/youtube/connect', async (c) => {
  const clientId = process.env.YOUTUBE_CLIENT_ID || '';
  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/youtube/callback`;
  const state = randomUUID();

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope:
        'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();

  return c.redirect(authUrl);
});

socialRoutes.get('/youtube/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing code' }, 400);

  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/youtube/callback`;
  const provider = socialProviderRegistry.get('youtube');

  try {
    const authData = await provider.connect(code, redirectUri);
    const repo = new SocialRepository(getUserId(c), getWorkspaceId(c));

    await repo.createAccount({
      id: `acc_${randomUUID()}`,
      platform: 'youtube',
      accountId: authData.accountId!,
      accountName: authData.accountName!,
      profileUrl: authData.profileUrl,
      status: 'active',
      accessToken: authData.accessToken,
      refreshToken: authData.refreshToken,
    });

    return apiResponse(c, { success: true, message: 'YouTube account connected' });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});
