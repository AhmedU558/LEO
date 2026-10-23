import type {
  VoiceMessage,
  VoiceSessionStatus,
  VoiceTranscriptEvent,
  VoiceToolCallEvent,
  VoiceAudioDeltaEvent,
} from './models.js';

export interface VoiceProviderEvents {
  onStatusChange?: (status: VoiceSessionStatus) => void;
  onMessage?: (message: VoiceMessage) => void;
  onTranscript?: (event: VoiceTranscriptEvent) => void;
  onAudioDelta?: (event: VoiceAudioDeltaEvent) => void;
  onToolCall?: (toolCall: VoiceToolCallEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export interface VoiceProviderOptions {
  model?: string;
  voice?: string;
  instructions?: string;
  temperature?: number;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface VoiceProvider {
  readonly name: string;

  /**
   * Initialize and connect to the voice backend (e.g. OpenAI Realtime WebSocket)
   */
  connect(events: VoiceProviderEvents, options?: VoiceProviderOptions): Promise<void>;

  /**
   * Send audio chunks from user's microphone
   */
  sendAudio(base64Audio: string): void;

  /**
   * Send text to the voice model (for text-to-speech fallback or instructions)
   */
  sendText(text: string): void;

  /**
   * Send tool execution results back to the voice model
   */
  sendToolResult(toolCallId: string, result: unknown): void;

  /**
   * End the current recording turn and request model to generate response
   */
  commitAudio(): void;

  /**
   * Interrupt model's current speech
   */
  interrupt(): void;

  /**
   * Close the connection
   */
  disconnect(): void;
}
