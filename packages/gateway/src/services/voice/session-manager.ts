/**
 * Voice Session Manager
 *
 * Coordinates lifecycle, event distribution, deduplication, and tool execution
 * for realtime voice sessions. Keeps state scoped to authorized users and workspaces.
 */

import {
  type VoiceSession,
  type VoiceSessionStatus,
  type VoiceMessage,
  type VoiceTranscriptEvent,
  type VoiceAudioDeltaEvent,
  type VoiceToolCallEvent,
  type VoiceSessionEvent,
  type VoiceProvider,
  type VoiceProviderEvents,
} from '@ownpilot/core/voice';
import { MockVoiceProvider } from './providers/mock-provider.js';
import { OpenAIRealtimeVoiceProvider } from './providers/openai-realtime.js';
import { LocalVoiceProvider } from './providers/local-provider.js';
import { VoiceService } from './service.js';

export interface CreateSessionOptions {
  mode?: 'push-to-talk' | 'vad';
  provider?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
  customProvider?: VoiceProvider;
}

export interface SessionTurnControl {
  abortController: AbortController;
  inFlightToolCallId?: string;
  toolCompleted?: boolean;
  cancelled?: boolean;
  turnId?: string;
  lastSequenceNumber?: number;
  hasAudioLoss?: boolean;
}

export class VoiceSessionManager {
  private sessions = new Map<string, VoiceSession>();
  private providers = new Map<string, VoiceProvider>();
  private executedToolCalls = new Map<string, Set<string>>(); // sessionId -> Set of toolCallIds
  private toolResults = new Map<string, Map<string, unknown>>(); // sessionId -> toolCallId -> result
  private activeTurns = new Map<string, SessionTurnControl>();
  private pastTurnIds = new Map<string, Set<string>>();
  private subscribers = new Map<string, Set<(event: VoiceSessionEvent) => void>>();

  constructor(private readonly voiceService: VoiceService = new VoiceService()) {}

  /**
   * Factory to create an appropriate VoiceProvider
   */
  private createProvider(providerName = 'local', customProvider?: VoiceProvider): VoiceProvider {
    if (customProvider) return customProvider;
    if (providerName === 'mock') {
      return new MockVoiceProvider();
    }
    if (providerName === 'local') return new LocalVoiceProvider();
    if (providerName === 'openai-realtime') return new OpenAIRealtimeVoiceProvider();
    throw new Error(`Unsupported voice provider: ${providerName}`);
  }

  /**
   * Create a new voice session isolated to userId and workspaceId
   */
  async createSession(
    userId: string,
    workspaceId: string,
    options: CreateSessionOptions = {}
  ): Promise<VoiceSession> {
    const id = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const providerName = options.provider || 'local';
    const provider = this.createProvider(providerName, options.customProvider);

    const session: VoiceSession = {
      id,
      userId,
      workspaceId,
      conversationId: options.conversationId,
      status: 'disconnected',
      mode: options.mode || 'push-to-talk',
      provider: provider.name,
      messages: [],
      startedAt: new Date().toISOString(),
      metadata: options.metadata,
    };

    this.sessions.set(id, session);
    this.providers.set(id, provider);
    this.executedToolCalls.set(id, new Set());
    this.toolResults.set(id, new Map());
    this.subscribers.set(id, new Set());

    return session;
  }

  /**
   * Get an existing session verifying user access
   */
  getSession(sessionId: string, userId: string): VoiceSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    return session;
  }

  /**
   * List all sessions belonging to the user
   */
  listSessions(userId: string): VoiceSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.userId === userId);
  }

  /**
   * Subscribe to real-time session events (SSE or WebSocket listener)
   */
  subscribe(
    sessionId: string,
    userId: string,
    listener: (event: VoiceSessionEvent) => void
  ): () => void {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }
    const set = this.subscribers.get(sessionId) || new Set();
    set.add(listener);
    this.subscribers.set(sessionId, set);

    return () => {
      set.delete(listener);
    };
  }

  private broadcast(sessionId: string, event: VoiceSessionEvent): void {
    const set = this.subscribers.get(sessionId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch {
          // Ignore subscriber errors
        }
      }
    }
  }

  /**
   * Connect session to the voice provider
   */
  async connectSession(sessionId: string, userId: string): Promise<VoiceSession> {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }

    const provider = this.providers.get(sessionId);
    if (!provider) {
      throw new Error(`Voice provider not initialized for session ${sessionId}`);
    }

    const events: VoiceProviderEvents = {
      onStatusChange: (status: VoiceSessionStatus) => {
        session.status = status;
        this.broadcast(sessionId, {
          type: 'status_change',
          sessionId,
          status,
          timestamp: new Date().toISOString(),
        });
      },
      onTranscript: (transcript: VoiceTranscriptEvent) => {
        this.broadcast(sessionId, {
          type: 'transcript',
          sessionId,
          event: transcript,
          timestamp: new Date().toISOString(),
        });
      },
      onAudioDelta: (audioDelta: VoiceAudioDeltaEvent) => {
        // Drop audio if session is disconnected
        if (session.status === 'disconnected') {
          return;
        }
        // Drop audio if no active turn or if turn was cancelled/aborted
        const turn = this.activeTurns.get(sessionId);
        if (!turn || turn.cancelled || turn.abortController.signal.aborted) {
          return;
        }
        this.broadcast(sessionId, {
          type: 'audio_delta',
          sessionId,
          event: audioDelta,
          timestamp: new Date().toISOString(),
        });
      },
      onMessage: (message: VoiceMessage) => {
        session.messages.push(message);
        this.broadcast(sessionId, {
          type: 'message',
          sessionId,
          message,
          timestamp: new Date().toISOString(),
        });
      },
      onToolCall: async (toolCall: VoiceToolCallEvent) => {
        await this.handleToolCall(
          sessionId,
          userId,
          toolCall.id,
          toolCall.name,
          toolCall.arguments
        );
      },
      onError: (err: Error) => {
        session.status = 'error';
        session.error = err.message;
        this.broadcast(sessionId, {
          type: 'error',
          sessionId,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      },
    };

    try {
      await provider.connect(events);
      session.status = 'connected';
      return session;
    } catch (err) {
      session.status = 'error';
      session.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * Feed audio into the session
   */
  sendAudio(
    sessionId: string,
    userId: string,
    audioBase64: string,
    commit = false,
    turnId?: string,
    sequenceNumber?: number
  ): void {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }
    const provider = this.providers.get(sessionId);
    if (!provider) {
      throw new Error(`Provider not found for session ${sessionId}`);
    }

    let currentTurn = this.activeTurns.get(sessionId);
    const pastTurns = this.pastTurnIds.get(sessionId) || new Set<string>();

    if (turnId && pastTurns.has(turnId)) {
      // Stale chunk from an already completed, cancelled, or superseded turn: drop it!
      return;
    }

    if (
      !currentTurn ||
      currentTurn.cancelled ||
      (turnId && currentTurn.turnId && turnId !== currentTurn.turnId)
    ) {
      // If the current turn was cancelled and this chunk belongs to that cancelled turn, drop it
      if (currentTurn?.cancelled && turnId && currentTurn.turnId === turnId) {
        return;
      }

      // If a new turn is starting and there was an existing active turn with a different turnId,
      // archive the previous turnId as superseded so any delayed chunks/commits are dropped
      if (currentTurn?.turnId && turnId && currentTurn.turnId !== turnId) {
        pastTurns.add(currentTurn.turnId);
        this.pastTurnIds.set(sessionId, pastTurns);
      }

      currentTurn = {
        abortController: new AbortController(),
        turnId,
        lastSequenceNumber: sequenceNumber,
        hasAudioLoss: false,
      };
      this.activeTurns.set(sessionId, currentTurn);
    } else {
      if (turnId && !currentTurn.turnId) {
        currentTurn.turnId = turnId;
      }
      // Check sequence number for gaps / out-of-order delivery
      if (sequenceNumber !== undefined) {
        if (
          currentTurn.lastSequenceNumber !== undefined &&
          sequenceNumber !== currentTurn.lastSequenceNumber + 1
        ) {
          currentTurn.hasAudioLoss = true;
        }
        currentTurn.lastSequenceNumber = sequenceNumber;
      }
    }

    // Do not append audio if audio loss was detected for this turn
    if (currentTurn.hasAudioLoss) {
      return;
    }

    provider.sendAudio(audioBase64);
    if (commit) {
      if (!currentTurn.hasAudioLoss) {
        provider.commitAudio();
        if (currentTurn.turnId) {
          pastTurns.add(currentTurn.turnId);
          this.pastTurnIds.set(sessionId, pastTurns);
        }
      }
    }
  }

  /**
   * Commit recorded audio to finalize turn
   */
  commitAudio(sessionId: string, userId: string, turnId?: string): void {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }
    const provider = this.providers.get(sessionId);
    if (!provider) {
      throw new Error(`Provider not found for session ${sessionId}`);
    }

    const currentTurn = this.activeTurns.get(sessionId);
    const pastTurns = this.pastTurnIds.get(sessionId);
    if (!currentTurn) {
      return;
    }
    if (turnId && pastTurns?.has(turnId)) {
      // Stale commit for already superseded or finished turn: drop it!
      return;
    }
    if (currentTurn.cancelled && turnId && currentTurn.turnId === turnId) {
      return;
    }
    if (turnId && currentTurn.turnId && turnId !== currentTurn.turnId) {
      // Stale commit for superseded turn: drop it!
      return;
    }
    if (currentTurn.hasAudioLoss) {
      throw new Error('Cannot commit incomplete voice turn: audio loss or gap detected.');
    }

    provider.commitAudio();
    if (currentTurn.turnId) {
      if (!this.pastTurnIds.has(sessionId)) {
        this.pastTurnIds.set(sessionId, new Set());
      }
      this.pastTurnIds.get(sessionId)!.add(currentTurn.turnId);
    }
  }

  /**
   * Send text instruction/fallback into voice session
   */
  sendText(sessionId: string, userId: string, text: string): void {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }
    const provider = this.providers.get(sessionId);
    if (!provider) {
      throw new Error(`Provider not found for session ${sessionId}`);
    }

    provider.sendText(text);
  }

  /**
   * Cancel or interrupt active interaction
   */
  cancelTurn(sessionId: string, userId: string): { cancelled: boolean; message: string } {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }
    const provider = this.providers.get(sessionId);
    const turn = this.activeTurns.get(sessionId);

    // If an action was in flight and already completed, do not claim it was stopped
    if (turn?.toolCompleted) {
      return {
        cancelled: false,
        message: 'Action had already completed before cancellation request.',
      };
    }

    // Abort active controller
    if (turn) {
      turn.cancelled = true;
      turn.abortController.abort();
      if (turn.turnId) {
        const past = this.pastTurnIds.get(sessionId) || new Set<string>();
        past.add(turn.turnId);
        this.pastTurnIds.set(sessionId, past);
      }
    }

    // Interrupt model speech/generation
    if (provider) {
      provider.interrupt();
    }

    session.status = 'connected';

    this.broadcast(sessionId, {
      type: 'status_change',
      sessionId,
      status: 'connected',
      timestamp: new Date().toISOString(),
    });

    return {
      cancelled: true,
      message: 'Active interaction cancelled successfully.',
    };
  }

  /**
   * Handle tool execution routed from voice
   */
  async handleToolCall(
    sessionId: string,
    userId: string,
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<{ allowed: boolean; approvalRequired?: boolean; error?: string; result?: unknown }> {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }

    const executedSet = this.executedToolCalls.get(sessionId) || new Set();
    const resultsMap = this.toolResults.get(sessionId) || new Map();

    // Prevent duplicate tool execution caused by replayed/repeated events
    if (executedSet.has(toolCallId)) {
      const cachedResult = resultsMap.get(toolCallId);
      return {
        allowed: true,
        result: cachedResult,
      };
    }

    // Mark as in-flight
    executedSet.add(toolCallId);
    this.executedToolCalls.set(sessionId, executedSet);

    const turn = this.activeTurns.get(sessionId) || { abortController: new AbortController() };
    turn.inFlightToolCallId = toolCallId;
    turn.toolCompleted = false;
    this.activeTurns.set(sessionId, turn);

    this.broadcast(sessionId, {
      type: 'tool_call',
      sessionId,
      toolCall: { id: toolCallId, name: toolName, arguments: toolArgs },
      timestamp: new Date().toISOString(),
    });

    try {
      const execResult = await this.voiceService.handleVoiceToolCall(
        userId,
        session.workspaceId || 'default',
        sessionId,
        toolName,
        toolArgs,
        {
          signal: turn.abortController.signal,
          conversationId: session.conversationId,
        }
      );

      turn.toolCompleted = true;
      resultsMap.set(toolCallId, execResult.result);
      this.toolResults.set(sessionId, resultsMap);

      const provider = this.providers.get(sessionId);
      if (provider && execResult.allowed) {
        provider.sendToolResult(toolCallId, execResult.result);
      }

      this.broadcast(sessionId, {
        type: 'tool_result',
        sessionId,
        toolCallId,
        result: execResult.result ?? execResult.error,
        timestamp: new Date().toISOString(),
      });

      return execResult;
    } catch (err) {
      turn.toolCompleted = true;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        allowed: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Disconnect and close session
   */
  async disconnectSession(sessionId: string, userId: string): Promise<VoiceSession> {
    const session = this.getSession(sessionId, userId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or unauthorized`);
    }

    const provider = this.providers.get(sessionId);
    if (provider) {
      provider.disconnect();
    }

    session.status = 'disconnected';
    session.endedAt = new Date().toISOString();
    this.activeTurns.delete(sessionId);

    this.broadcast(sessionId, {
      type: 'status_change',
      sessionId,
      status: 'disconnected',
      timestamp: session.endedAt,
    });

    return session;
  }
}

// Global singleton instance for gateway
let sharedManager: VoiceSessionManager | null = null;

export function getVoiceSessionManager(): VoiceSessionManager {
  if (!sharedManager) {
    sharedManager = new VoiceSessionManager();
  }
  return sharedManager;
}

export function setVoiceSessionManager(manager: VoiceSessionManager | null): void {
  sharedManager = manager;
}
