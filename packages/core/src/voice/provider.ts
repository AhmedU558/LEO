import type { VoiceMessage, VoiceSessionStatus } from './models.js';

export interface VoiceProviderEvents {
  onStatusChange: (status: VoiceSessionStatus) => void;
  onMessage: (message: VoiceMessage) => void;
  onError: (error: Error) => void;
}

export interface VoiceProvider {
  /**
   * Initialize and connect to the voice backend (e.g. OpenAI Realtime WebSocket)
   */
  connect(events: VoiceProviderEvents): Promise<void>;

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
