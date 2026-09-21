import { getUserId, getWorkspaceId } from './helpers.js';
﻿import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from './helpers.js';
import { VoiceService } from '../services/voice/service.js';
import type { VoiceSession } from '@ownpilot/core/voice';

export const voiceRoutes = new Hono();
const voiceService = new VoiceService();

// In-memory stubs for MVP
const sessions: VoiceSession[] = [];

voiceRoutes.get('/sessions', (c) => {
  return apiResponse(c, { sessions });
});

voiceRoutes.post('/sessions', async (c) => {
  const newSession: VoiceSession = {
    id: 'voice_' + Date.now(), userId: getUserId(c),
    status: 'connecting',
    messages: [],
    startedAt: new Date().toISOString(),
  };
  sessions.push(newSession);
  return apiResponse(c, newSession);
});

voiceRoutes.post('/sessions/:id/tool_call', async (c) => {
  const id = c.req.param('id');
  const session = sessions.find((s) => s.id === id);
  if (!session)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);

  const body = (await parseJsonBody(c)) as { toolName: string; toolArgs: unknown } | null;
  if (!body || !body.toolName) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing tool name' }, 400);
  }

  const result = await voiceService.handleVoiceToolCall(getUserId(c), getWorkspaceId(c), session.id, body.toolName, body.toolArgs);

  return apiResponse(c, result);
});
