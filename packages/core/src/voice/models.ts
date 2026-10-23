export type VoiceSessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'recording'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'audio' | 'tool_call' | 'tool_result';
  text?: string;
  audioBase64?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  toolResult?: unknown;
  timestamp: string;
}

export interface VoiceTranscriptEvent {
  sessionId: string;
  conversationId?: string;
  turnId?: string;
  role: 'user' | 'assistant';
  delta?: string;
  text: string;
  isFinal: boolean;
  timestamp: string;
}

export interface VoiceToolCallEvent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface VoiceAudioDeltaEvent {
  sessionId: string;
  responseId?: string;
  itemId?: string;
  delta: string; // Base64-encoded audio chunk
  format: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  sampleRate?: number; // e.g. 24000
  channels?: number; // e.g. 1
  timestamp: string;
}

export interface VoiceSession {
  id: string;
  userId: string;
  workspaceId?: string;
  conversationId?: string;
  status: VoiceSessionStatus;
  mode?: 'push-to-talk' | 'vad';
  provider?: string;
  messages: VoiceMessage[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type VoiceSessionEvent =
  | {
      type: 'status_change';
      sessionId: string;
      status: VoiceSessionStatus;
      error?: string;
      timestamp: string;
    }
  | { type: 'transcript'; sessionId: string; event: VoiceTranscriptEvent; timestamp: string }
  | { type: 'audio_delta'; sessionId: string; event: VoiceAudioDeltaEvent; timestamp: string }
  | { type: 'message'; sessionId: string; message: VoiceMessage; timestamp: string }
  | { type: 'tool_call'; sessionId: string; toolCall: VoiceToolCallEvent; timestamp: string }
  | {
      type: 'tool_result';
      sessionId: string;
      toolCallId: string;
      result: unknown;
      timestamp: string;
    }
  | { type: 'error'; sessionId: string; error: string; timestamp: string };
