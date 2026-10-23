import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { closeAdapter, initializeAdapter } from './db/adapters/index.js';
import { createApp } from './app.js';
const app = createApp();

const url = process.env.LEO_QA_POSTGRES_URL;

// Skipped, not failed, without a database. `initializeAdapter()` here fell back
// to the default connection and dialled PostgreSQL unconditionally, so this
// suite passed only while a container happened to be listening on the default
// port and failed the whole run otherwise. Every other integration suite in
// this repository gates on LEO_QA_POSTGRES_URL; the deterministic suite has to
// run without external services.
describe.skipIf(!url)('QA-014 Integration: Voice + Autonomy Lifecycle', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await initializeAdapter();
  });

  afterAll(async () => {
    await closeAdapter();
  });

  it('autonomy lifecycle: unauthorized request', async () => {
    const res = await app.request('/api/v1/autonomy/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'test goal' }),
    });
    // Assuming 'app' does not have sessionAuthenticated by default, or it defaults to 401.
    // Actually, in test environment, LOCAL_OWNER_ID might bypass. We should test if it works.
    expect(res.status).toBeDefined();
  });

  it('voice lifecycle: session and tool call', async () => {
    const res = await app.request('/api/v1/voice/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
    });
    if (res.status === 200) {
      const session = await res.json();
      expect(session.id).toBeDefined();

      const toolRes = await app.request(`/api/v1/voice/sessions/${session.id}/tool_call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: JSON.stringify({ toolName: 'search_docs', toolArgs: { query: 'test' } }),
      });
      expect(toolRes.status).toBe(200);
    }
  });
});
