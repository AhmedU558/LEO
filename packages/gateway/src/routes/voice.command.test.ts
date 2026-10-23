import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// Mocks
const mockVoiceService = {
  isAvailable: vi.fn().mockResolvedValue(true),
  transcribe: vi.fn(),
};

vi.mock('../services/voice-service.js', () => ({
  getVoiceService: vi.fn(() => mockVoiceService),
}));

vi.mock('../services/voice/voice-command-parser.js', () => ({
  parseVoiceCommandIntent: vi.fn(),
}));

const mockWfService = {
  executeWorkflow: vi.fn().mockResolvedValue({}),
  cancelExecution: vi.fn(),
  isRunning: vi.fn().mockReturnValue(true),
};
vi.mock('../services/workflow/workflow-service.js', () => ({
  getWorkflowService: vi.fn(() => mockWfService),
}));

const mockRepo = {
  listRunningLogs: vi.fn().mockResolvedValue([{ id: 'log-1', userId: 'user1' }]),
  getLog: vi.fn().mockResolvedValue({ id: 'log-1', workflowId: 'wf-1' }),
  list: vi.fn().mockResolvedValue([{ id: 'wf-1' }]),
  create: vi.fn().mockImplementation((w) => Promise.resolve(w)),
};
vi.mock('../db/repositories/workflows/index.js', () => ({
  createWorkflowsRepository: vi.fn(() => mockRepo),
}));

const { voiceRoutes } = await import('./voice.js');

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('userId', 'user1');
    c.set('workspaceId', 'ws1');
    c.set('sessionAuthenticated', true);
    await next();
  });
  app.route('/voice', voiceRoutes);
  app.onError(errorHandler);
  return app;
}

function makeFormData(filename: string, text?: string): FormData {
  const fd = new FormData();
  if (text) {
    fd.append('confirmedText', text);
  } else {
    fd.append('file', new File([new Uint8Array([1, 2, 3])], filename, { type: 'audio/webm' }));
  }
  return fd;
}

describe('POST /voice/command', () => {
  let app: Hono;
  let parserMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp();
    parserMock = await import('../services/voice/voice-command-parser.js');
  });

  it('transcribes audio and requires confirmation for ambiguous commands', async () => {
    mockVoiceService.transcribe.mockResolvedValueOnce({ text: 'blah blah' });
    vi.mocked(parserMock.parseVoiceCommandIntent).mockResolvedValueOnce({
      intent: 'AMBIGUOUS',
      reason: 'Not a clear command',
    });

    const fd = makeFormData('audio.webm');
    const res = await app.request('/voice/command', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('confirmation_required');
    expect(json.data.reason).toBe('ambiguous');
    expect(json.data.text).toBe('blah blah');
  });

  it('requires confirmation for high-risk actions (initiating computer tasks)', async () => {
    mockVoiceService.transcribe.mockResolvedValueOnce({ text: 'buy me a pizza' });
    vi.mocked(parserMock.parseVoiceCommandIntent).mockResolvedValueOnce({
      intent: 'INITIATE_TASK',
      objective: 'buy me a pizza',
    });

    const fd = makeFormData('audio.webm');
    const res = await app.request('/voice/command', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('confirmation_required');
    expect(json.data.reason).toBe('high_risk');
  });

  it('starts a workflow directly when confirmed', async () => {
    vi.mocked(parserMock.parseVoiceCommandIntent).mockResolvedValueOnce({
      intent: 'INITIATE_TASK',
      objective: 'buy me a pizza',
    });

    const fd = makeFormData('audio.webm', 'buy me a pizza');
    const res = await app.request('/voice/command', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('started');
    expect(json.data.objective).toBe('buy me a pizza');

    expect(mockRepo.create).toHaveBeenCalled();
    expect(mockWfService.executeWorkflow).toHaveBeenCalled();
  });

  it('cancels active workflows through voice', async () => {
    mockVoiceService.transcribe.mockResolvedValueOnce({ text: 'cancel the task' });
    vi.mocked(parserMock.parseVoiceCommandIntent).mockResolvedValueOnce({
      intent: 'CANCEL_TASK',
    });

    const fd = makeFormData('audio.webm');
    const res = await app.request('/voice/command', { method: 'POST', body: fd });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('cancelled');
    expect(mockWfService.cancelExecution).toHaveBeenCalledWith('wf-1');
  });
});
