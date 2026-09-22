import { getUserId, getWorkspaceId } from './helpers.js';
import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { SocialService } from '../services/social/service.js';

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
  const body = (await parseJsonBody(c)) as Record<string, unknown>;
  if (!body || !body.text || !body.platform || !body.accountId) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing fields' }, 400);
  }

  const { MediaService } = await import('../services/media/service.js');
  const mediaService = new MediaService(getUserId(c), getWorkspaceId(c));
  const resolvedMedia = [];
  if (body.mediaAssetIds && Array.isArray(body.mediaAssetIds)) {
    for (const id of body.mediaAssetIds) {
      const asset = await mediaService.getMedia(id);
      if (asset) resolvedMedia.push(asset);
    }
  }
  body.media = resolvedMedia;

  const service = new SocialService(getUserId(c), getWorkspaceId(c));
  try {
    const result = await service.createPublishTask(body as any);
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
        userId: getUserId(c),
        workspaceId: getWorkspaceId(c),
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
socialRoutes.get('/instagram/connect', async (c) => {
  const clientId = process.env.META_CLIENT_ID || '';
  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/instagram/callback`;
  const state = randomUUID();

  const authUrl =
    `https://www.facebook.com/v19.0/dialog/oauth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement',
      state,
    }).toString();

  return c.redirect(authUrl);
});

socialRoutes.get('/instagram/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing code' }, 400);

  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/instagram/callback`;
  const provider = socialProviderRegistry.get('instagram');

  try {
    const authData = await provider.connect(code, redirectUri);

    const repo = new SocialRepository(getUserId(c), getWorkspaceId(c));

    await repo.createAccount({
      id: `acc_${randomUUID()}`,
      platform: 'instagram',
      accountId: authData.accountId!,
        userId: getUserId(c),
        workspaceId: getWorkspaceId(c),
      accountName: authData.accountName!,
      profileUrl: authData.profileUrl,
      status: 'active',
    });

    await repo.storeCredentials(authData.accountId!, {
      accessToken: authData.accessToken!,
      refreshToken: authData.refreshToken,
    });

    return apiResponse(c, { success: true, message: 'Instagram account connected' });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

socialRoutes.get('/facebook/connect', async (c) => {
  const clientId = process.env.META_CLIENT_ID || '';
  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/facebook/callback`;
  const state = randomUUID();

  const authUrl =
    `https://www.facebook.com/v19.0/dialog/oauth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'pages_manage_posts,pages_read_engagement,pages_show_list',
      state,
    }).toString();

  return c.redirect(authUrl);
});

socialRoutes.get('/facebook/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing code' }, 400);

  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/facebook/callback`;

  try {
    // 1. Exchange code
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_CLIENT_ID}&client_secret=${process.env.META_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    );
    if (!tokenRes.ok) throw new Error('Failed to exchange code');
    const tokenData = await tokenRes.json();

    // 2. Fetch pages
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${(tokenData as any).access_token}`
    );
    if (!pagesRes.ok) throw new Error('Failed to fetch pages');
    const pagesData = await pagesRes.json();

    const repo = new SocialRepository(getUserId(c), getWorkspaceId(c));

    const pages = (pagesData as any).data || [];
    for (const page of pages) {
      if (!page.id || !page.access_token) continue;
      await repo.createAccount({
        id: `acc_${randomUUID()}`,
        platform: 'facebook',
        accountId: page.id,
        userId: getUserId(c),
        workspaceId: getWorkspaceId(c),
        accountName: page.name,
        profileUrl: `https://facebook.com/${page.id}`,
        status: 'active',
      });
      await repo.storeCredentials(page.id, {
        accessToken: page.access_token,
      });
    }

    return apiResponse(c, { success: true, message: `Connected ${pages.length} Facebook pages` });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});
socialRoutes.get('/tiktok/connect', async (c) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/tiktok/callback`;
  const state = randomUUID();

  const authUrl =
    `https://www.tiktok.com/v2/auth/authorize/?` +
    new URLSearchParams({
      client_key: clientKey,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user.info.basic,video.publish',
      state,
    }).toString();

  return c.redirect(authUrl);
});

socialRoutes.get('/tiktok/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing code' }, 400);

  const redirectUri = `${new URL(c.req.url).origin}/api/v1/social/tiktok/callback`;
  const provider = socialProviderRegistry.get('tiktok');

  try {
    const authData = await provider.connect(code, redirectUri);
    const repo = new SocialRepository(getUserId(c), getWorkspaceId(c));

    await repo.createAccount({
      id: `acc_${randomUUID()}`,
      platform: 'tiktok',
      accountId: authData.accountId!,
        userId: getUserId(c),
        workspaceId: getWorkspaceId(c),
      accountName: authData.accountName!,
      profileUrl: authData.profileUrl,
      status: 'active',
    });

    await repo.storeCredentials(authData.accountId!, {
      accessToken: authData.accessToken!,
      refreshToken: authData.refreshToken,
    });

    return apiResponse(c, { success: true, message: 'TikTok account connected' });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

import { CampaignService } from '../services/social/campaign-service.js';

import { getIdempotencyKeysRepository } from '../db/repositories/idempotency-keys.js';

socialRoutes.post('/campaigns', async (c) => {
  const userId = getUserId(c);
  const workspaceId = getWorkspaceId(c);
  const idempotencyKey = c.req.header('Idempotency-Key');

  if (idempotencyKey) {
    const repo = getIdempotencyKeysRepository();
    const existing = await repo.getRecord(userId, idempotencyKey);
    if (existing) {
      if ((existing.result as any).status === 'FAILED') {
        // If it failed previously, allow retry by deleting the key or just proceed
        // But for safe idempotency, we return the failed result. Let's just return it.
      }
      return apiResponse(c, existing.result);
    }
  }

  try {
    const body = await c.req.json();
    const service = new CampaignService(userId, workspaceId);

    // Check if campaign already exists for this contentItemId and same scheduledFor to prevent duplicates
    // We can list campaigns and find one.
    const existingCampaigns = await service.listCampaigns();
    const duplicate = existingCampaigns.find(
      (camp) =>
        camp.contentItemId === body.contentItemId &&
        camp.scheduledFor === body.scheduledFor &&
        camp.status !== 'FAILED' &&
        camp.status !== 'CANCELLED'
    );

    if (duplicate) {
      return apiResponse(c, duplicate);
    }

    const campaign = await service.createCampaign(body);

    if (idempotencyKey) {
      const repo = getIdempotencyKeysRepository();
      await repo.setRecord(userId, idempotencyKey, campaign);
    }
    return apiResponse(c, campaign);
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: (err as Error).message }, 400);
  }
});

socialRoutes.get('/campaigns', async (c) => {
  const service = new CampaignService(getUserId(c), getWorkspaceId(c));
  const campaigns = await service.listCampaigns();
  return apiResponse(c, campaigns);
});

socialRoutes.get('/campaigns/:id', async (c) => {
  const service = new CampaignService(getUserId(c), getWorkspaceId(c));
  const id = c.req.param('id');
  const campaign = await service.getCampaign(id);
  if (!campaign)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Campaign not found' }, 404);
  const targets = await service.getCampaignTargets(id);
  return apiResponse(c, { ...campaign, targets });
});

socialRoutes.post('/campaigns/:id/cancel', async (c) => {
  const service = new CampaignService(getUserId(c), getWorkspaceId(c));
  const id = c.req.param('id');
  try {
    await service.cancelCampaign(id);
    return apiResponse(c, { success: true });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});

socialRoutes.post('/campaigns/:id/reconcile', async (c) => {
  const service = new CampaignService(getUserId(c), getWorkspaceId(c));
  const id = c.req.param('id');
  try {
    await service.reconcileCampaign(id);
    const campaign = await service.getCampaign(id);
    const targets = await service.getCampaignTargets(id);
    return apiResponse(c, { ...campaign, targets });
  } catch (err: unknown) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: (err as Error).message }, 500);
  }
});


