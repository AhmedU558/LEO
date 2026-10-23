/**
 * Mock Voice Provider
 *
 * Deterministic voice provider for unit and integration testing.
 * Simulates OpenAI Realtime or other voice providers without external network calls.
 */

import type {
  VoiceProvider,
  VoiceProviderEvents,
  VoiceProviderOptions,
  VoiceSessionStatus,
  VoiceTranscriptEvent,
  VoiceToolCallEvent,
  VoiceMessage,
} from '@ownpilot/core/voice';

export interface MockVoiceProviderBehavior {
  autoRespondText?: string;
  autoAudioDeltas?: string[];
  autoToolCall?: VoiceToolCallEvent;
  simulatedLatencyMs?: number;
  connectError?: Error;
}

export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';

  private events: VoiceProviderEvents | null = null;
  private options: VoiceProviderOptions | null = null;
  private status: VoiceSessionStatus = 'disconnected';
  private behavior: MockVoiceProviderBehavior = {};
  private toolResults: Map<string, unknown> = new Map();
  private sentAudioChunks: string[] = [];
  private sentTexts: string[] = [];

  constructor(behavior: MockVoiceProviderBehavior = {}) {
    this.behavior = behavior;
  }

  setBehavior(behavior: MockVoiceProviderBehavior) {
    this.behavior = { ...this.behavior, ...behavior };
  }

  getStatus(): VoiceSessionStatus {
    return this.status;
  }

  getSentAudioChunks(): string[] {
    return [...this.sentAudioChunks];
  }

  getSentTexts(): string[] {
    return [...this.sentTexts];
  }

  getToolResult(toolCallId: string): unknown {
    return this.toolResults.get(toolCallId);
  }

  simulateAudioDelta(delta: string, responseId = 'mock_resp'): void {
    if (this.events) {
      this.events.onAudioDelta?.({
        sessionId: 'mock_session',
        responseId,
        delta,
        format: 'pcm16',
        sampleRate: 24000,
        channels: 1,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async connect(events: VoiceProviderEvents, options?: VoiceProviderOptions): Promise<void> {
    if (this.behavior.connectError) {
      this.status = 'error';
      events.onStatusChange?.('error');
      events.onError?.(this.behavior.connectError);
      throw this.behavior.connectError;
    }

    this.events = events;
    this.options = options || null;
    this.status = 'connecting';
    this.events.onStatusChange?.('connecting');

    if (this.behavior.simulatedLatencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.behavior.simulatedLatencyMs));
    }

    this.status = 'connected';
    this.events.onStatusChange?.('connected');
  }

  sendAudio(base64Audio: string): void {
    if (this.status !== 'connected' && this.status !== 'listening' && this.status !== 'recording') {
      return;
    }
    this.sentAudioChunks.push(base64Audio);
    if (this.status !== 'listening') {
      this.status = 'listening';
      this.events?.onStatusChange?.('listening');
    }
  }

  sendText(text: string): void {
    this.sentTexts.push(text);
  }

  sendToolResult(toolCallId: string, result: unknown): void {
    this.toolResults.set(toolCallId, result);
    // After tool result, model generates final speech/transcript
    if (this.events) {
      this.status = 'speaking';
      this.events.onStatusChange?.('speaking');

      const message: VoiceMessage = {
        id: 'msg_' + Date.now(),
        role: 'assistant',
        type: 'text',
        text: `Tool ${toolCallId} execution completed.`,
        timestamp: new Date().toISOString(),
      };
      this.events.onMessage?.(message);

      this.status = 'connected';
      this.events.onStatusChange?.('connected');
    }
  }

  commitAudio(): void {
    if (!this.events) return;

    this.status = 'processing';
    this.events.onStatusChange?.('processing');

    const timestamp = new Date().toISOString();

    // 1. Emit user transcript delta & final
    const userTranscript = 'Voice command input';
    this.events.onTranscript?.({
      sessionId: 'mock_session',
      role: 'user',
      delta: userTranscript,
      text: userTranscript,
      isFinal: true,
      timestamp,
    });

    const userMessage: VoiceMessage = {
      id: 'msg_user_' + Date.now(),
      role: 'user',
      type: 'text',
      text: userTranscript,
      timestamp,
    };
    this.events.onMessage?.(userMessage);

    // 2. If configured to call a tool, emit tool call
    if (this.behavior.autoToolCall) {
      const toolCall = this.behavior.autoToolCall;
      this.events.onToolCall?.(toolCall);
      return;
    }

    // 3. Otherwise emit assistant speech / text response
    this.status = 'speaking';
    this.events.onStatusChange?.('speaking');

    const replyText = this.behavior.autoRespondText || 'Voice response generated successfully.';
    this.events.onTranscript?.({
      sessionId: 'mock_session',
      role: 'assistant',
      delta: replyText,
      text: replyText,
      isFinal: true,
      timestamp: new Date().toISOString(),
    });

    if (this.behavior.autoAudioDeltas && this.behavior.autoAudioDeltas.length > 0) {
      for (const delta of this.behavior.autoAudioDeltas) {
        this.events.onAudioDelta?.({
          sessionId: 'mock_session',
          responseId: 'mock_response',
          delta,
          format: 'pcm16',
          sampleRate: 24000,
          channels: 1,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const assistantMessage: VoiceMessage = {
      id: 'msg_assistant_' + Date.now(),
      role: 'assistant',
      type: 'text',
      text: replyText,
      timestamp: new Date().toISOString(),
    };
    this.events.onMessage?.(assistantMessage);

    this.status = 'connected';
    this.events.onStatusChange?.('connected');
  }

  interrupt(): void {
    if (this.status === 'speaking' || this.status === 'processing' || this.status === 'listening') {
      this.status = 'connected';
      this.events?.onStatusChange?.('connected');
    }
  }

  disconnect(): void {
    this.status = 'disconnected';
    this.events?.onStatusChange?.('disconnected');
    this.events = null;
  }
}
