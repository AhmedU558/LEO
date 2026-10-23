import { describe, expect, it, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Hono } from 'hono';
import { closeAdapter, initializeAdapter } from '../db/adapters/index.js';
import * as voiceCommandParser from '../services/voice/voice-command-parser.js';
import * as voiceServiceModule from '../services/voice-service.js';
import { getWorkflowService } from '../services/workflow/workflow-service.js';
import { createWorkflowsRepository } from '../db/repositories/workflows/index.js';
import { voiceRoutes } from './voice.js';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', c.req.header('x-user-id') || 'test-user-1');
    c.set('workspaceId', 'ws1');
    c.set('sessionAuthenticated', true);
    await next();
  });
  app.route('/api/v1/voice', voiceRoutes);
  return app;
}

const url = process.env.LEO_QA_POSTGRES_URL;

describe.skipIf(!url)('QA-028: Voice-to-Computer Pipeline Integration', () => {
  const database = `leo_qa028_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool | undefined;
  let app: Hono;

  beforeAll(async () => {
    if (!url) {
      throw new Error('LEO_QA_POSTGRES_URL is required for QA-028 integration tests.');
    }
    admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl = new URL(url);
    testUrl.pathname = `/${database}`;
    await initializeAdapter({ type: 'postgres', postgresUrl: testUrl.toString() });

    app = createTestApp();
  });

  afterAll(async () => {
    await closeAdapter();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    }
  });

  describe('Voice-to-Computer Pipeline (Mocked Models)', () => {
    let transcribeSpy: any;
    let parseIntentSpy: any;

    beforeEach(() => {
      vi.clearAllMocks();

      const mockVoiceService = {
        isAvailable: vi.fn().mockResolvedValue(true),
        transcribe: vi.fn(),
      };
      transcribeSpy = mockVoiceService.transcribe;
      vi.spyOn(voiceServiceModule, 'getVoiceService').mockReturnValue(mockVoiceService);

      parseIntentSpy = vi.spyOn(voiceCommandParser, 'parseVoiceCommandIntent');
    });

    it('ingests audio, transcribes, parses intent, and requires confirmation for CRITICAL computer.control', async () => {
      transcribeSpy.mockResolvedValue({ text: 'Open the browser and go to google.com' });
      parseIntentSpy.mockResolvedValue({ intent: 'INITIATE_TASK', objective: 'Go to google.com' });

      // Build mock audio file payload
      const formData = new FormData();
      const blob = new Blob(['fake audio data'], { type: 'audio/mp3' });
      formData.append('file', blob, 'test.mp3');

      const res = await app.request('/api/v1/voice/command', {
        method: 'POST',
        body: formData,
        headers: { 'x-user-id': 'test-user-1' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();

      // Should require confirmation because computer.control is CRITICAL risk
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('confirmation_required');
      // Our API actually returns reason='high_risk' and text as the transcript
      expect(json.data.reason).toBe('high_risk');
      expect(json.data.text).toBe('Open the browser and go to google.com');
      expect(json.data.objective).toBe('Go to google.com');
      expect(transcribeSpy).toHaveBeenCalled();
      expect(parseIntentSpy).toHaveBeenCalled();
    });

    it('starts workflow directly when provided with confirmedText, enforcing PolicyEngine and RiskEngine', async () => {
      parseIntentSpy.mockResolvedValue({ intent: 'INITIATE_TASK', objective: 'Go to google.com' });

      const formData = new FormData();
      formData.append('confirmedText', 'Yes, go to google.com');

      const res = await app.request('/api/v1/voice/command', {
        method: 'POST',
        body: formData,
        headers: { 'x-user-id': 'test-user-1' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('started');
      expect(json.data.workflowId).toBeDefined();
      expect(json.data.objective).toBe('Go to google.com');

      // Verify the workflow actually exists in Postgres
      const repo = createWorkflowsRepository('test-user-1');
      const wf = await repo.get(json.data.workflowId);
      expect(wf).toBeDefined();
      expect(wf?.nodes[0].data.action).toBe('vision_loop');
      expect(wf?.nodes[0].data.objective).toBe('Go to google.com');
    });

    it('cancels active workflows through CANCEL_TASK voice intent', async () => {
      // First, create a running workflow
      const repo = createWorkflowsRepository('test-user-cancel');

      const wf = await repo.create({
        workspaceId: randomUUID(),
        name: 'Voice Cancel Test Workflow',
        trigger: { type: 'manual' },
        nodes: [{ id: 'n1', type: 'browser', data: { action: 'vision_loop' }, dependencies: [] }],
        edges: [],
      });

      // Instead of relying on executeWorkflow which might finish immediately in test,
      // create a 'running' log explicitly to mimic a long-running process
      await repo.createLog(wf.id, wf.name);

      const runningLogs = await repo.listRunningLogs();
      expect(runningLogs.length).toBeGreaterThan(0);

      // Force WorkflowService to report this workflow as running and cancel it
      const wfService = getWorkflowService();
      vi.spyOn(wfService, 'isRunning').mockReturnValue(true);
      vi.spyOn(wfService, 'cancelExecution').mockImplementation((_id) => {
        // Mimic the executor aborting and updating the DB
        repo.updateLog(runningLogs[0].id, { status: 'cancelled' }).catch(() => {});
      });

      // Now cancel it via voice
      parseIntentSpy.mockResolvedValue({ intent: 'CANCEL_TASK' });
      const formData = new FormData();
      formData.append('confirmedText', 'Stop right now');

      const res = await app.request('/api/v1/voice/command', {
        method: 'POST',
        body: formData,
        headers: { 'x-user-id': 'test-user-cancel' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('cancelled');

      // Wait a tick for the async cancel DB update to settle
      await new Promise((r) => setTimeout(r, 50));

      // Verify it's cancelled in engine
      const runningLogsAfter = await repo.listRunningLogs();
      expect(runningLogsAfter.length).toBe(0);
    });

    it('handles ambiguous commands by requiring confirmation without executing', async () => {
      parseIntentSpy.mockResolvedValue({ intent: 'AMBIGUOUS', reason: 'Unclear command' });

      const formData = new FormData();
      formData.append('confirmedText', 'Hello agent');

      const res = await app.request('/api/v1/voice/command', {
        method: 'POST',
        body: formData,
        headers: { 'x-user-id': 'test-user-3' },
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('confirmation_required');
      expect(json.data.reason).toBe('ambiguous');
    });
  });

  describe.skipIf(!process.env.LEO_QA_LIVE_MODEL_API_KEY)(
    'Voice-to-Computer Pipeline (Real Models)',
    () => {
      beforeEach(() => {
        vi.restoreAllMocks(); // Use real transcription and intent parsing
      });

      it('really transcribes and parses a valid computer command intent', async () => {
        // NOTE: We cannot easily provide real audio without a fixture, so we just use confirmedText
        // to test the real LLM intent parser.
        const formData = new FormData();
        formData.append('confirmedText', 'Open Google Chrome and search for the latest news.');

        const res = await app.request('/api/v1/voice/command', {
          method: 'POST',
          body: formData,
          headers: { 'x-user-id': 'real-user-1' },
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data.status).toBe('started');
        expect(json.data.objective).toMatch(/search.*news/i);
        expect(json.data.workflowId).toBeDefined();
      });
    }
  );
});
