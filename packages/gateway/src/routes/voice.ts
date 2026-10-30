/**
 * Voice Routes
 *
 * REST API for voice operations (STT/TTS).
 *
 * Endpoints:
 *   GET  /config     â€” voice service availability + provider info
 *   POST /transcribe â€” upload audio â†’ get text (multipart/form-data)
 *   POST /synthesize â€” send text â†’ get audio binary
 */

import { getUserId, getWorkspaceId } from './helpers.js';
import { Hono } from 'hono';
import { getVoiceService } from '../services/voice-service.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { validateBody, synthesizeVoiceSchema } from '../middleware/validation.js';
import { createLoginThrottle } from '../utils/login-throttle.js';
import { getClientIp } from '../utils/client-ip.js';
import { MS_PER_MINUTE } from '../config/defaults.js';

export const voiceRoutes = new Hono();

// RATE-001: Per-endpoint throttle for voice transcription. The global
// rate limit (500 req/min) is generous because most API calls are cheap;
// transcribe hits a paid Whisper API and processes up to 25MB of audio
// per call. A small per-IP throttle (30/min, 5-min lockout) prevents
// run-away cost and CPU usage on the audio buffer parse path without
// hindering normal use. Same applies to synthesize (TTS, similar cost
// profile).
const voiceThrottle = createLoginThrottle({
  maxAttempts: 30,
  windowMs: MS_PER_MINUTE,
  lockoutMs: 5 * MS_PER_MINUTE,
});

const voiceThrottleCleanup = setInterval(() => voiceThrottle.cleanup(), 2 * MS_PER_MINUTE);
if (typeof voiceThrottleCleanup === 'object' && 'unref' in voiceThrottleCleanup) {
  voiceThrottleCleanup.unref();
}

// =============================================================================
// GET /config
// =============================================================================

voiceRoutes.get('/config', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/status', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/voices', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, {
      available: config.available,
      provider: config.provider,
      voices: config.voices,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/diagnostics', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const diagnostics = await service.getDiagnostics();
    return apiResponse(c, diagnostics);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /transcribe
// =============================================================================

voiceRoutes.post('/transcribe', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    // Per-endpoint throttle â€” see voiceThrottle declaration above.
    // Skip in test env so sequential tests don't collide.
    if (process.env.NODE_ENV !== 'test') {
      const ip = getClientIp(c);
      const throttleResult = voiceThrottle.check(ip);
      if (!throttleResult.allowed) {
        c.header('Retry-After', String(Math.ceil(throttleResult.retryAfterMs / 1000)));
        return apiError(
          c,
          {
            code: ERROR_CODES.ACCESS_DENIED,
            message: 'Voice transcription rate limit exceeded. Please retry later.',
          },
          429
        );
      }
    }

    const service = getVoiceService();
    if (!(await service.isAvailable())) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Voice service not configured' },
        503
      );
    }

    // Parse multipart form
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Audio file is required (multipart field "file")',
        },
        400
      );
    }

    // file is a File/Blob from Hono's parseBody
    const arrayBuffer = await (file as File).arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    if (audioBuffer.length === 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Audio file is empty' },
        400
      );
    }

    if (audioBuffer.length > 25 * 1024 * 1024) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Audio file exceeds 25MB limit' },
        400
      );
    }

    const filename = (file as File).name || 'audio.webm';
    const language = (body['language'] as string) || c.req.query('language') || undefined;

    const result = await service.transcribe(audioBuffer, filename, { language });
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /synthesize
// =============================================================================

voiceRoutes.post('/synthesize', async (c) => {
  try {
    const userId = getUserId(c);
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    if (process.env.NODE_ENV !== 'test') {
      const ip = getClientIp(c);
      const throttleResult = voiceThrottle.check(ip);
      if (!throttleResult.allowed) {
        c.header('Retry-After', String(Math.ceil(throttleResult.retryAfterMs / 1000)));
        return apiError(
          c,
          {
            code: ERROR_CODES.ACCESS_DENIED,
            message: 'Voice synthesis rate limit exceeded. Please retry later.',
          },
          429
        );
      }
    }

    const service = getVoiceService();
    if (!(await service.isAvailable())) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Voice service not configured' },
        503
      );
    }

    const body = validateBody(synthesizeVoiceSchema, await c.req.json());

    const result = await service.synthesize(body.text, {
      voice: body.voice,
      speed: body.speed,
      format: body.format,
    });

    // Return raw audio binary
    return new Response(Uint8Array.from(result.audio), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.audio.length),
        'X-Audio-Format': result.format,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /command
// =============================================================================

import { parseVoiceCommandIntent } from '../services/voice/voice-command-parser.js';
import { getWorkflowService } from '../services/workflow/workflow-service.js';
import { createWorkflowsRepository } from '../db/repositories/workflows/index.js';
import { RiskEngine, PolicyEngine } from '@ownpilot/core/security';
import { generateId } from '@ownpilot/core/services';
import { ignoreError } from '@ownpilot/core/utils';

const voiceCommandPolicyEngine = new PolicyEngine();
const voiceCommandRiskEngine = new RiskEngine();

voiceRoutes.post('/command', async (c) => {
  try {
    const userId = getUserId(c);
    const workspaceId = getWorkspaceId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    const service = getVoiceService();
    if (!(await service.isAvailable())) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Voice service not configured' },
        503
      );
    }

    const body = await c.req.parseBody();
    const confirmedText = body['confirmedText'] as string;
    let text = confirmedText;

    if (!text) {
      const file = body['file'];
      if (!file || typeof file === 'string') {
        return apiError(
          c,
          {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Audio file or confirmedText is required',
          },
          400
        );
      }
      const arrayBuffer = await (file as File).arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const filename = (file as File).name || 'audio.webm';
      const result = await service.transcribe(audioBuffer, filename);
      text = result.text;
    }

    const parsed = await parseVoiceCommandIntent(text);

    if (parsed.intent === 'AMBIGUOUS') {
      return apiResponse(c, {
        status: 'confirmation_required',
        reason: 'ambiguous',
        text,
        message: parsed.reason,
      });
    }

    if (parsed.intent === 'CANCEL_TASK') {
      // Find active workflows and cancel them
      const repo = createWorkflowsRepository(userId);
      const runningLogs = await repo.listRunningLogs();
      const wfService = getWorkflowService();
      let canceledCount = 0;
      for (const log of runningLogs) {
        const fullLog = await repo.getLog(log.id);
        if (fullLog && fullLog.workflowId && wfService.isRunning(fullLog.workflowId)) {
          wfService.cancelExecution(fullLog.workflowId);
          canceledCount++;
        }
      }
      return apiResponse(c, {
        status: 'cancelled',
        message: `Cancelled ${canceledCount} running task(s)`,
      });
    }

    if (parsed.intent === 'INITIATE_TASK') {
      const risk = voiceCommandRiskEngine.classify('computer.control', 'vision_loop');

      // Require confirmation if high risk
      if ((risk === 'HIGH' || risk === 'CRITICAL') && !confirmedText) {
        return apiResponse(c, {
          status: 'confirmation_required',
          reason: 'high_risk',
          text,
          objective: parsed.objective,
        });
      }

      const policyResult = voiceCommandPolicyEngine.evaluate({
        identity: { userId, workspaceId, roles: ['user'] },
        action: 'voice.command',
        resource: 'computer',
        capability: 'computer.control',
        risk,
        environment: 'production',
        autonomous: false,
        requestedParameters: { objective: parsed.objective },
      });

      if (policyResult.decision === 'DENY') {
        return apiError(
          c,
          { code: ERROR_CODES.ACCESS_DENIED, message: 'Voice command denied by policy' },
          403
        );
      }

      // We proceed even if REQUIRE_APPROVAL because the browser node will pause execution!
      const repo = createWorkflowsRepository(userId);
      const workflow = await repo.create({
        name: `Voice Command`,
        description: `Voice Command: ${parsed.objective}`,
        nodes: [
          {
            id: generateId('node'),
            type: 'browser',
            data: {
              action: 'vision_loop',
              objective: parsed.objective,
              provider: 'openai',
              model: 'default',
            },
            position: { x: 100, y: 100 },
          },
        ],
        edges: [],
        variables: {},
        inputSchema: [],
      });

      const wfService = getWorkflowService();
      ignoreError(wfService.executeWorkflow(workflow.id, userId), 'voice-command-workflow');

      return apiResponse(c, {
        status: 'started',
        workflowId: workflow.id,
        objective: parsed.objective,
      });
    }

    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: 'Unknown intent' }, 500);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
import { getVoiceSessionManager } from '../services/voice/session-manager.js';
import { transcribeLocally } from '../services/voice/providers/local-provider.js';
import { heardWakeWord, WAKE_PROMPT } from '../services/voice/wake-word.js';
import { streamSSE } from 'hono/streaming';

// =============================================================================
// POST /wake — "Hey Leo" check on a short clip, transcribed by local Whisper only
// =============================================================================

const WAKE_RATES = new Set([16000, 24000]);
const WAKE_MAX_SECONDS = 4;
// ponytail: one check per user at a time; clips arriving meanwhile are dropped
// (the browser just listens for the next one). A queue adds latency, not accuracy.
const wakeInFlight = new Set<string>();

voiceRoutes.post('/wake', async (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as { audio?: unknown; sampleRate?: unknown };
  const sampleRate = Number(body.sampleRate);
  const audio = typeof body.audio === 'string' ? body.audio : '';
  if (!audio || !WAKE_RATES.has(sampleRate)) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'audio (base64 PCM16 mono) and sampleRate 16000 or 24000 are required',
      },
      400
    );
  }
  if (Math.floor((audio.length * 3) / 4) > sampleRate * 2 * WAKE_MAX_SECONDS) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: `Clip too long (max ${WAKE_MAX_SECONDS} s)` },
      400
    );
  }
  if (wakeInFlight.has(userId)) {
    return apiError(
      c,
      { code: ERROR_CODES.RATE_LIMITED, message: 'A wake-word check is already running' },
      429
    );
  }

  wakeInFlight.add(userId);
  try {
    const text = await transcribeLocally(
      audio,
      sampleRate,
      AbortSignal.timeout(20_000),
      WAKE_PROMPT
    );
    return apiResponse(c, { detected: heardWakeWord(text), text });
  } catch {
    return apiError(
      c,
      {
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        message: 'Local wake-word check failed. Check Python and the cached Whisper model.',
      },
      503
    );
  } finally {
    wakeInFlight.delete(userId);
  }
});

// =============================================================================
// Voice Sessions Lifecycle & Realtime APIs
// =============================================================================

voiceRoutes.get('/sessions', (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const manager = getVoiceSessionManager();
  const userSessions = manager.listSessions(userId);
  return apiResponse(c, { sessions: userSessions });
});

voiceRoutes.post('/sessions', async (c) => {
  try {
    const userId = getUserId(c);
    const workspaceId = getWorkspaceId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    let body: {
      mode?: 'push-to-talk' | 'vad';
      provider?: string;
      conversationId?: string;
      metadata?: Record<string, unknown>;
    } = {};

    try {
      body = (await c.req.json()) || {};
    } catch {
      // Body is optional
    }

    const manager = getVoiceSessionManager();
    const session = await manager.createSession(userId, workspaceId, body);
    return apiResponse(c, session);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/sessions/:id', (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const id = c.req.param('id');
  const manager = getVoiceSessionManager();
  const session = manager.getSession(id, userId);
  if (!session) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  }
  return apiResponse(c, session);
});

voiceRoutes.post('/sessions/:id/connect', async (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const id = c.req.param('id');
    const manager = getVoiceSessionManager();
    const session = await manager.connectSession(id, userId);
    return apiResponse(c, session);
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

voiceRoutes.post('/sessions/:id/disconnect', async (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const id = c.req.param('id');
    const manager = getVoiceSessionManager();
    const session = await manager.disconnectSession(id, userId);
    return apiResponse(c, session);
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

voiceRoutes.post('/sessions/:id/cancel', (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const id = c.req.param('id');
    const manager = getVoiceSessionManager();
    const result = manager.cancelTurn(id, userId);
    return apiResponse(c, result);
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

voiceRoutes.post('/sessions/:id/audio', async (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const id = c.req.param('id');
    const manager = getVoiceSessionManager();

    const contentType = c.req.header('content-type') || '';
    let audioBase64 = '';
    let commit = false;

    let turnId: string | undefined;
    let sequenceNumber: number | undefined;
    if (contentType.includes('application/json')) {
      const body = await c.req.json();
      audioBase64 = body.audio || '';
      commit = Boolean(body.commit);
      turnId = body.turnId;
      if (typeof body.sequenceNumber === 'number') {
        sequenceNumber = body.sequenceNumber;
      }
    } else {
      const body = await c.req.parseBody();
      const file = body['file'];
      commit = Boolean(body['commit']);
      turnId = typeof body['turnId'] === 'string' ? body['turnId'] : undefined;
      if (body['sequenceNumber'] !== undefined) {
        sequenceNumber = Number(body['sequenceNumber']);
      }
      if (file && typeof file !== 'string') {
        const arrayBuffer = await (file as File).arrayBuffer();
        audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      }
    }

    if (!audioBase64 && !commit) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Audio payload required' },
        400
      );
    }

    if (audioBase64) {
      manager.sendAudio(id, userId, audioBase64, commit, turnId, sequenceNumber);
    } else if (commit) {
      manager.commitAudio(id, userId, turnId);
    }

    return apiResponse(c, { received: true, committed: commit });
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    if (msg.includes('Cannot commit incomplete voice turn')) {
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: msg }, 400);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

/** Typed input: answered and spoken exactly like a voice turn. */
voiceRoutes.post('/sessions/:id/text', async (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > 2000) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'text must be 1–2000 characters' },
        400
      );
    }
    getVoiceSessionManager().sendText(c.req.param('id'), userId, text);
    return apiResponse(c, { received: true });
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

voiceRoutes.post('/sessions/:id/tool_call', async (c) => {
  try {
    const userId = getUserId(c);
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const id = c.req.param('id');
    const body = (await c.req.json()) as {
      toolCallId?: string;
      toolName: string;
      toolArgs: unknown;
    } | null;
    if (!body || !body.toolName) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing tool name' }, 400);
    }

    const toolCallId = body.toolCallId || `call_${Date.now()}`;
    const manager = getVoiceSessionManager();
    const result = await manager.handleToolCall(
      id,
      userId,
      toolCallId,
      body.toolName,
      (body.toolArgs as Record<string, unknown>) || {}
    );

    return apiResponse(c, result);
  } catch (err) {
    const msg = getErrorMessage(err);
    if (msg.includes('not found') || msg.includes('unauthorized')) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: msg }, 404);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: msg }, 500);
  }
});

voiceRoutes.get('/sessions/:id/events', (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated')) {
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  }
  const id = c.req.param('id');
  const manager = getVoiceSessionManager();

  // Validate session access
  const session = manager.getSession(id, userId);
  if (!session) {
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Initial status event
    await stream.writeSSE({
      event: 'status',
      data: JSON.stringify({ status: session.status, sessionId: session.id }),
    });

    const unsubscribe = manager.subscribe(id, userId, async (event) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      } catch {
        // Stream closed
      }
    });

    stream.onAbort(() => {
      unsubscribe();
    });

    // Keep stream alive
    while (!stream.aborted) {
      await stream.sleep(15000);
      try {
        await stream.writeSSE({ event: 'ping', data: 'heartbeat' });
      } catch {
        break;
      }
    }
  });
});
