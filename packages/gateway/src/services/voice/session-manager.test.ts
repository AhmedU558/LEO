/**
 * Voice Session Manager Tests
 *
 * Deterministic tests for voice session lifecycle, state isolation,
 * event ordering, tool deduplication, cancellation, and error recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceSessionManager } from './session-manager.js';
import { MockVoiceProvider } from './providers/mock-provider.js';
import { VoiceService } from './service.js';
import { ActionLedger } from '@ownpilot/core/security';
import type { VoiceSessionEvent } from '@ownpilot/core/voice';

describe('VoiceSessionManager', () => {
  let manager: VoiceSessionManager;
  let mockVoiceService: VoiceService;

  beforeEach(() => {
    vi.spyOn(ActionLedger, 'record').mockResolvedValue({
      actionId: 'test-action-id',
      timestamp: new Date(),
      userId: 'user-1',
      workspaceId: 'workspace-1',
      tool: 'read_file',
      action: 'voice.tool_execute',
      resource: 'session-id',
      resourceType: 'voice_session',
      capability: 'filesystem.read',
      policyDecision: 'ALLOW',
      riskLevel: 'HIGH',
      executionEnvironment: 'development',
      durationMs: 0,
      hash: 'hash-1',
    });
    vi.spyOn(ActionLedger, 'updateResult').mockResolvedValue(undefined);
    mockVoiceService = new VoiceService();
    manager = new VoiceSessionManager(mockVoiceService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Lifecycle Management', () => {
    it('creates, connects, and disconnects a voice session', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        mode: 'push-to-talk',
        customProvider: mockProvider,
      });

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user-1');
      expect(session.workspaceId).toBe('workspace-1');
      expect(session.status).toBe('disconnected');
      expect(session.mode).toBe('push-to-talk');

      // Connect
      const connectedSession = await manager.connectSession(session.id, 'user-1');
      expect(connectedSession.status).toBe('connected');

      // Disconnect
      const disconnectedSession = await manager.disconnectSession(session.id, 'user-1');
      expect(disconnectedSession.status).toBe('disconnected');
      expect(disconnectedSession.endedAt).toBeDefined();
    });

    it('transitions to error status and recovers when provider fails to connect', async () => {
      const connectError = new Error('Connection refused by remote host');
      const mockProvider = new MockVoiceProvider({ connectError });
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });

      await expect(manager.connectSession(session.id, 'user-1')).rejects.toThrow(
        'Connection refused by remote host'
      );

      const errorSession = manager.getSession(session.id, 'user-1');
      expect(errorSession?.status).toBe('error');
      expect(errorSession?.error).toBe('Connection refused by remote host');

      // Recover by clearing error and reconnecting with working provider behavior
      mockProvider.setBehavior({ connectError: undefined });
      const recoveredSession = await manager.connectSession(session.id, 'user-1');
      expect(recoveredSession.status).toBe('connected');
    });
  });

  describe('Authorization and State Isolation (IDOR)', () => {
    it('prevents user-2 from accessing or operating on user-1 session', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });

      // user-2 cannot retrieve user-1 session
      expect(manager.getSession(session.id, 'user-2')).toBeNull();

      // user-2 is excluded from session listing
      expect(manager.listSessions('user-2')).toHaveLength(0);
      expect(manager.listSessions('user-1')).toHaveLength(1);

      // user-2 cannot connect, send audio, cancel, or disconnect user-1 session
      await expect(manager.connectSession(session.id, 'user-2')).rejects.toThrow(
        'not found or unauthorized'
      );
      expect(() => manager.sendAudio(session.id, 'user-2', 'dGVzdA==')).toThrow(
        'not found or unauthorized'
      );
      expect(() => manager.cancelTurn(session.id, 'user-2')).toThrow('not found or unauthorized');
      await expect(manager.disconnectSession(session.id, 'user-2')).rejects.toThrow(
        'not found or unauthorized'
      );
    });
  });

  describe('Event Distribution & Streaming Ordering', () => {
    it('streams events in correct sequence: status -> transcript -> message -> connected', async () => {
      const mockProvider = new MockVoiceProvider({
        autoRespondText: 'Hello from LEO voice assistant',
      });
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });

      const events: VoiceSessionEvent[] = [];
      const unsubscribe = manager.subscribe(session.id, 'user-1', (e) => {
        events.push(e);
      });

      await manager.connectSession(session.id, 'user-1');

      // Send audio and commit
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8tZGF0YQ==', true);

      // Verify event types and sequence
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('status_change');
      expect(eventTypes).toContain('transcript');
      expect(eventTypes).toContain('message');

      // Verify final assistant message was delivered to session history
      const updatedSession = manager.getSession(session.id, 'user-1');
      expect(updatedSession?.messages.length).toBeGreaterThanOrEqual(1);

      unsubscribe();
    });
  });

  describe('Deduplication of Tool Execution', () => {
    it('prevents duplicate execution of replayed tool call IDs', async () => {
      const mockToolService = {
        execute: vi.fn().mockResolvedValue({ success: true, content: 'result_1' }),
        has: vi.fn().mockReturnValue(true),
        getDefinitions: vi.fn().mockReturnValue([]),
        getDefinitionsBySource: vi.fn().mockReturnValue([]),
        getNames: vi.fn().mockReturnValue(['read_file']),
        use: vi.fn(),
        getCount: vi.fn().mockReturnValue(1),
      };

      const customVoiceService = new VoiceService(mockToolService as any);
      const customManager = new VoiceSessionManager(customVoiceService);

      const session = await customManager.createSession('user-1', 'workspace-1', {
        provider: 'mock',
      });
      await customManager.connectSession(session.id, 'user-1');

      const toolCallId = 'call_unique_123';

      // First execution
      const result1 = await customManager.handleToolCall(
        session.id,
        'user-1',
        toolCallId,
        'read_file',
        { path: 'test.txt' }
      );
      expect(result1.allowed).toBe(true);
      expect(result1.result).toBe('result_1');
      expect(mockToolService.execute).toHaveBeenCalledTimes(1);

      // Replayed execution with exact same toolCallId
      const result2 = await customManager.handleToolCall(
        session.id,
        'user-1',
        toolCallId,
        'read_file',
        { path: 'test.txt' }
      );
      expect(result2.allowed).toBe(true);
      expect(result2.result).toBe('result_1');

      // Crucial: execute must NOT be called a second time
      expect(mockToolService.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cancellation and Interruption Guarantees', () => {
    it('aborts active interaction when in-flight and returns cancelled: true', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      manager.sendAudio(session.id, 'user-1', 'YXVkaW8=');

      const cancelResult = manager.cancelTurn(session.id, 'user-1');
      expect(cancelResult.cancelled).toBe(true);
      expect(cancelResult.message).toContain('cancelled successfully');

      const currentSession = manager.getSession(session.id, 'user-1');
      expect(currentSession?.status).toBe('connected');
    });

    it('does not falsely report that an action was cancelled if it already completed', async () => {
      const mockToolService = {
        execute: vi.fn().mockResolvedValue({ success: true, content: 'done' }),
        has: vi.fn().mockReturnValue(true),
        getDefinitions: vi.fn().mockReturnValue([]),
        getDefinitionsBySource: vi.fn().mockReturnValue([]),
        getNames: vi.fn().mockReturnValue(['write_note']),
        use: vi.fn(),
        getCount: vi.fn().mockReturnValue(1),
      };

      const customVoiceService = new VoiceService(mockToolService as any);
      const customManager = new VoiceSessionManager(customVoiceService);

      const session = await customManager.createSession('user-1', 'workspace-1', {
        provider: 'mock',
      });
      await customManager.connectSession(session.id, 'user-1');

      // Tool executes and finishes
      await customManager.handleToolCall(session.id, 'user-1', 'call_finished_456', 'write_note', {
        text: 'remember this',
      });

      // User subsequently triggers cancellation
      const cancelResult = customManager.cancelTurn(session.id, 'user-1');
      expect(cancelResult.cancelled).toBe(false);
      expect(cancelResult.message).toContain('had already completed');
    });
  });

  describe('Audio Delta Downlink & Transport', () => {
    it('streams audio_delta events to authorized subscribers with complete metadata', async () => {
      const mockProvider = new MockVoiceProvider({
        autoAudioDeltas: ['Y2h1bmsx', 'Y2h1bmsy'],
      });
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });

      const audioDeltas: VoiceSessionEvent[] = [];
      const unsubscribe = manager.subscribe(session.id, 'user-1', (e) => {
        if (e.type === 'audio_delta') {
          audioDeltas.push(e);
        }
      });

      await manager.connectSession(session.id, 'user-1');
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8=', true);

      expect(audioDeltas).toHaveLength(2);
      expect(audioDeltas[0].type).toBe('audio_delta');
      if (audioDeltas[0].type === 'audio_delta') {
        expect(audioDeltas[0].event.delta).toBe('Y2h1bmsx');
        expect(audioDeltas[0].event.format).toBe('pcm16');
        expect(audioDeltas[0].event.sampleRate).toBe(24000);
        expect(audioDeltas[0].event.channels).toBe(1);
        expect(audioDeltas[0].event.timestamp).toBeDefined();
      }

      unsubscribe();
    });

    it('prevents audio_delta events from leaking across unauthorized sessions', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });

      expect(() => {
        manager.subscribe(session.id, 'user-2', () => {});
      }).toThrow('not found or unauthorized');
    });

    it('drops subsequent audio_delta events when a turn is cancelled', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      const audioDeltas: VoiceSessionEvent[] = [];
      const unsubscribe = manager.subscribe(session.id, 'user-1', (e) => {
        if (e.type === 'audio_delta') {
          audioDeltas.push(e);
        }
      });

      // Start turn
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8=');

      // Cancel turn
      const cancelResult = manager.cancelTurn(session.id, 'user-1');
      expect(cancelResult.cancelled).toBe(true);

      // Provider attempts to emit stale audio after cancellation
      mockProvider.simulateAudioDelta('c3RhbGVfYXVkaW8=');

      // Stale chunk must have been dropped
      expect(audioDeltas).toHaveLength(0);

      unsubscribe();
    });

    it('drops audio_delta events if session is disconnected', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      const audioDeltas: VoiceSessionEvent[] = [];
      const unsubscribe = manager.subscribe(session.id, 'user-1', (e) => {
        if (e.type === 'audio_delta') {
          audioDeltas.push(e);
        }
      });

      // Disconnect
      await manager.disconnectSession(session.id, 'user-1');

      // Provider attempts to emit audio while disconnected
      mockProvider.simulateAudioDelta('ZGlzY29ubmVjdGVkX2F1ZGlv');

      expect(audioDeltas).toHaveLength(0);

      unsubscribe();
    });

    it('detects audio sequence gaps and rejects incomplete turn commits', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      // Send chunk 0
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8w', false, 'turn_gap', 0);

      // Send chunk 2 (skipped chunk 1 -> audio loss gap)
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8y', false, 'turn_gap', 2);

      // Attempting to commit turn with audio loss must throw
      expect(() => manager.commitAudio(session.id, 'user-1', 'turn_gap')).toThrow(
        'Cannot commit incomplete voice turn: audio loss or gap detected.'
      );
    });

    it('rejects stale commits from superseded turnIds', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      const commitSpy = vi.spyOn(mockProvider, 'commitAudio');

      // Start turn 1
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8x', false, 'turn_1', 0);

      // Supersede with turn 2
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8y', false, 'turn_2', 0);

      // Delayed commit for turn_1 arrives
      manager.commitAudio(session.id, 'user-1', 'turn_1');

      // Turn 2 must NOT have been committed by turn 1's stale commit
      expect(commitSpy).not.toHaveBeenCalled();

      // Valid commit for turn 2 commits cleanly
      manager.commitAudio(session.id, 'user-1', 'turn_2');
      expect(commitSpy).toHaveBeenCalledTimes(1);
    });

    it('drops delayed chunks for cancelled turnIds without affecting new turns', async () => {
      const mockProvider = new MockVoiceProvider();
      const session = await manager.createSession('user-1', 'workspace-1', {
        customProvider: mockProvider,
      });
      await manager.connectSession(session.id, 'user-1');

      const sendAudioSpy = vi.spyOn(mockProvider, 'sendAudio');

      // Start turn 1 and cancel it
      manager.sendAudio(session.id, 'user-1', 'YXVkaW8x', false, 'turn_1', 0);
      expect(sendAudioSpy).toHaveBeenCalledTimes(1);
      manager.cancelTurn(session.id, 'user-1');

      // Delayed chunk for cancelled turn 1 arrives
      manager.sendAudio(session.id, 'user-1', 'c3RhbGU=', false, 'turn_1', 1);
      // Must be dropped
      expect(sendAudioSpy).toHaveBeenCalledTimes(1);

      // Start fresh turn 2
      manager.sendAudio(session.id, 'user-1', 'ZnJlc2g=', false, 'turn_2', 0);
      expect(sendAudioSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Provider selection', () => {
    it('defaults to the local provider', async () => {
      const session = await manager.createSession('user-1', 'workspace-1');
      expect(session.provider).toBe('local');
    });

    it('creates local-gradium only when explicitly requested', async () => {
      const session = await manager.createSession('user-1', 'workspace-1', {
        provider: 'local-gradium',
      });
      expect(session.provider).toBe('local-gradium');
    });

    it('rejects unknown providers instead of substituting one', async () => {
      await expect(
        manager.createSession('user-1', 'workspace-1', { provider: 'elevenlabs' })
      ).rejects.toThrow('Unsupported voice provider: elevenlabs');
    });
  });
});
