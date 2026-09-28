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
import { VoiceService } from '../services/voice/service.js';
import type { VoiceSession } from '@ownpilot/core/voice';

const voiceService2 = new VoiceService();
const sessions: VoiceSession[] = [];

voiceRoutes.get('/sessions', (c) => {
  const userSessions = sessions.filter((s) => s.userId === getUserId(c));
  return apiResponse(c, { sessions: userSessions });
});

voiceRoutes.post('/sessions', async (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated'))
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  const newSession: VoiceSession = {
    id: 'voice_' + Date.now(),
    userId: getUserId(c),
    status: 'connecting',
    messages: [],
    startedAt: new Date().toISOString(),
  };
  sessions.push(newSession);
  return apiResponse(c, newSession);
});

voiceRoutes.post('/sessions/:id/tool_call', async (c) => {
  const userId = getUserId(c);
  if (userId === 'default' && !c.get('sessionAuthenticated'))
    return apiError(c, { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' }, 401);
  const id = c.req.param('id');
  const session = sessions.find((s) => s.id === id);
  if (session && session.userId !== userId)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);
  if (!session)
    return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Session not found' }, 404);

  const body = (await c.req.json()) as { toolName: string; toolArgs: unknown } | null;
  if (!body || !body.toolName) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing tool name' }, 400);
  }

  const result = await voiceService2.handleVoiceToolCall(
    getUserId(c),
    getWorkspaceId(c),
    session.id,
    body.toolName,
    body.toolArgs
  );

  return apiResponse(c, result);
});
