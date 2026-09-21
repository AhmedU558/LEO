import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import * as uiSessionService from './services/ui-session.js';
import * as authLib from './middleware/auth.js';

describe('QA-001 Integration: Authentication and Identity Enforcement', () => {
  it('rejects unauthenticated requests to API when authType is api-key', async () => {
    const app = createApp({ auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated requests to API when authType is jwt', async () => {
    const app = createApp({ auth: { type: 'jwt', jwtSecret: 'secret' } });
    const res = await app.request('/api/v1/agents');
    expect(res.status).toBe(401);
  });

  it('accepts valid API key requests', async () => {
    const app = createApp({ auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents', {
      headers: {
        'X-API-Key': 'secret',
      },
    });
    // the route returns something other than 401. If the DB isn't running it might 500, but not 401.
    expect(res.status).not.toBe(401);
  });

  it('no longer falls back to implicit owner even on loopback when API keys are configured', async () => {
    const app = createApp({ host: '127.0.0.1', auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents');
    // Before QA-001 fix, loopback with missing credentials was allowed through the UI session middleware.
    expect(res.status).toBe(401);
  });

  it('rejects requests with invalid API keys', async () => {
    const app = createApp({ auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents', {
      headers: {
        'X-API-Key': 'wrong-key',
      },
    });
    expect(res.status).toBe(401);
  });

  it('accepts valid UI session cookies', async () => {
    // mock UI session validation
    vi.spyOn(uiSessionService, 'validateSession').mockResolvedValue(true);
    
    const app = createApp({ auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents', {
      headers: {
        Cookie: 'session=valid-session-token',
      },
    });
    // Should pass the auth check via uiSessionMiddleware
    expect(res.status).not.toBe(401);
  });

  it('rejects invalid UI session cookies', async () => {
    vi.spyOn(uiSessionService, 'validateSession').mockResolvedValue(false);
    
    const app = createApp({ auth: { type: 'api-key', apiKeys: ['secret'] } });
    const res = await app.request('/api/v1/agents', {
      headers: {
        Cookie: 'session=invalid-session-token',
      },
    });
    // Should fail and fall back to API auth, which also fails
    expect(res.status).toBe(401);
  });
});
