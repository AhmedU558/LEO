export type VoiceSessionStatus =
  'disconnected' | 'connecting' | 'connected' | 'recording' | 'processing' | 'speaking' | 'error';

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

export interface VoiceSession {
  id: string;
  userId: string;
  status: VoiceSessionStatus;
  messages: VoiceMessage[];
  startedAt: string;
  endedAt?: string;
}
