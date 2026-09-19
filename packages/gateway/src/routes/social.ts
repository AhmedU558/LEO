import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { SocialService } from '../services/social/service.js';
import type { SocialContent, SocialAccount } from '@ownpilot/core/social';
import { LOCAL_OWNER_ID, LOCAL_WORKSPACE_ID } from '../config/defaults.js';

export const socialRoutes = new Hono();
const socialService = new SocialService();

// In-memory stubs for MVP (Production would use Postgres)
const accounts: SocialAccount[] = [];
const drafts: SocialContent[] = [];

socialRoutes.get('/accounts', (c) => {
  return apiResponse(c, { accounts });
});

socialRoutes.post('/accounts', async (c) => {
  const body = (await parseJsonBody(c)) as Partial<SocialAccount> | null;
  if (!body || !body.platform || !body.accountName) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'Platform and name required' },
      400
    );
  }

  const newAccount: SocialAccount = {
    id: 'acc_' + Date.now(),
    userId: LOCAL_OWNER_ID,
    platform: body.platform as import('@ownpilot/core/social').SocialPlatform,
    accountId: 'provider_' + Date.now(),
    accountName: body.accountName,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  accounts.push(newAccount);
  return apiResponse(c, newAccount);
});

socialRoutes.get('/content', (c) => {
  return apiResponse(c, { content: drafts });
});

socialRoutes.post('/content', async (c) => {
  const body = (await parseJsonBody(c)) as Partial<SocialContent> | null;
  if (!body || !body.text || !body.platform || !body.accountId) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing fields' }, 400);
  }

  const newContent: SocialContent = {
    id: 'cnt_' + Date.now(),
    userId: LOCAL_OWNER_ID,
    accountId: body.accountId,
    platform: body.platform as import('@ownpilot/core/social').SocialPlatform,
    status: 'draft',
    text: body.text,
    media: body.media || [],
    metadata: body.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  drafts.push(newContent);
  return apiResponse(c, newContent);
});

socialRoutes.post('/content/:id/publish', async (c) => {
  const id = c.req.param('id');
  const content = drafts.find((d) => d.id === id);
  if (!content)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Content not found' }, 404);

  const account = accounts.find((a) => a.id === content.accountId);
  if (!account)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Account not found' }, 404);

  content.status = 'publishing';

  const result = await socialService.publishWithPolicy(
    LOCAL_OWNER_ID,
    LOCAL_WORKSPACE_ID,
    content,
    account
  );

  if (result.success) {
    content.status = 'published';
    content.publishedUrl = result.publishedUrl;
    content.providerPostId = result.providerPostId;
    content.updatedAt = new Date().toISOString();
  } else {
    content.status = 'failed';
    content.errorMessage = result.error;
    content.updatedAt = new Date().toISOString();
  }

  return apiResponse(c, { success: result.success, content, result });
});
