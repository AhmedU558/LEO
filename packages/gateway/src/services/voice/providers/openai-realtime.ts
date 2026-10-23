/**
 * OpenAI Realtime Voice Provider
 *
 * Implements VoiceProvider interface using the OpenAI Realtime WebSocket API.
 * Keeps API credentials strictly server-side.
 */

import WebSocket from 'ws';
import type {
  VoiceProvider,
  VoiceProviderEvents,
  VoiceProviderOptions,
  VoiceSessionStatus,
  VoiceMessage,
} from '@ownpilot/core/voice';

export interface OpenAIRealtimeConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export class OpenAIRealtimeVoiceProvider implements VoiceProvider {
  readonly name = 'openai-realtime';

  private ws: WebSocket | null = null;
  private events: VoiceProviderEvents | null = null;
  private status: VoiceSessionStatus = 'disconnected';
  private currentResponseId: string | null = null;
  private currentTurnUserText = '';
  private currentTurnAssistantText = '';

  constructor(private config: OpenAIRealtimeConfig = {}) {}

  getStatus(): VoiceSessionStatus {
    return this.status;
  }

  private getApiKey(): string {
    const key = this.config.apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OpenAI API key is not configured for Realtime Voice.');
    }
    return key;
  }

  async connect(events: VoiceProviderEvents, options?: VoiceProviderOptions): Promise<void> {
    const apiKey = this.getApiKey();
    this.events = events;
    this.status = 'connecting';
    this.events.onStatusChange?.('connecting');

    const model = options?.model || this.config.model || 'gpt-realtime-2.1';
    const baseUrl = this.config.baseUrl || 'wss://api.openai.com/v1/realtime';
    const wsUrl = `${baseUrl}?model=${encodeURIComponent(model)}`;

    return new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        this.ws = ws;

        let ready = false;
        const rejectConnection = (error: Error) => {
          if (ready) return;
          clearTimeout(timeout);
          reject(error);
          ws.close();
        };
        const timeout = setTimeout(() => {
          const error = new Error('OpenAI Realtime session setup timed out. Please try again.');
          this.status = 'error';
          this.events?.onStatusChange?.('error');
          this.events?.onError?.(error);
          rejectConnection(error);
        }, 20_000);

        ws.on('open', () => {
          // Initialize session configuration
          const sessionUpdate = {
            type: 'session.update',
            session: {
              type: 'realtime',
              output_modalities: ['audio'],
              instructions: options?.instructions || 'You are LEO, an intelligent voice assistant.',
              audio: {
                input: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  turn_detection: null, // Push-to-talk mode: manual commit
                },
                output: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  voice: options?.voice || 'alloy',
                },
              },
              tools: options?.tools?.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          };
          this.sendJson(sessionUpdate);
        });

        ws.on('message', (data: WebSocket.Data) => {
          this.handleServerEvent(
            data.toString(),
            () => {
              ready = true;
              clearTimeout(timeout);
              resolve();
            },
            rejectConnection
          );
        });

        ws.on('error', (err: Error) => {
          this.status = 'error';
          this.events?.onStatusChange?.('error');
          this.events?.onError?.(err);
          rejectConnection(err);
        });

        ws.on('close', () => {
          clearTimeout(timeout);
          if (!ready)
            reject(new Error('OpenAI Realtime disconnected before session setup completed.'));
          this.status = 'disconnected';
          this.events?.onStatusChange?.('disconnected');
          this.ws = null;
        });
      } catch (err) {
        this.status = 'error';
        this.events?.onStatusChange?.('error');
        const error = err instanceof Error ? err : new Error(String(err));
        this.events?.onError?.(error);
        reject(error);
      }
    });
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private handleServerEvent(
    rawJson: string,
    onSessionReady?: () => void,
    onSessionError?: (error: Error) => void
  ): void {
    try {
      const event = JSON.parse(rawJson);
      const timestamp = new Date().toISOString();

      switch (event.type) {
        case 'session.updated':
          this.status = 'connected';
          this.events?.onStatusChange?.('connected');
          onSessionReady?.();
          break;

        case 'response.created':
          this.currentResponseId = event.response?.id || null;
          this.currentTurnAssistantText = '';
          this.status = 'speaking';
          this.events?.onStatusChange?.('speaking');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.currentTurnUserText = event.transcript || '';
          this.events?.onTranscript?.({
            sessionId: event.item_id || 'session',
            role: 'user',
            text: this.currentTurnUserText,
            isFinal: true,
            timestamp,
          });
          this.events?.onMessage?.({
            id: event.item_id || 'msg_user_' + Date.now(),
            role: 'user',
            type: 'text',
            text: this.currentTurnUserText,
            timestamp,
          });
          break;

        case 'response.output_audio_transcript.delta':
          if (event.delta) {
            this.currentTurnAssistantText += event.delta;
            this.events?.onTranscript?.({
              sessionId: this.currentResponseId || 'session',
              role: 'assistant',
              delta: event.delta,
              text: this.currentTurnAssistantText,
              isFinal: false,
              timestamp,
            });
          }
          break;

        case 'response.output_audio.delta':
          if (event.delta && typeof event.delta === 'string') {
            this.events?.onAudioDelta?.({
              sessionId: this.currentResponseId || 'session',
              responseId: event.response_id || this.currentResponseId || undefined,
              itemId: event.item_id,
              delta: event.delta,
              format: 'pcm16',
              sampleRate: 24000,
              channels: 1,
              timestamp,
            });
          }
          break;

        case 'response.output_audio_transcript.done':
          this.events?.onTranscript?.({
            sessionId: this.currentResponseId || 'session',
            role: 'assistant',
            text: event.transcript || this.currentTurnAssistantText,
            isFinal: true,
            timestamp,
          });
          break;

        case 'response.function_call_arguments.done':
          if (event.name && event.call_id) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(event.arguments || '{}');
            } catch {
              parsedArgs = { raw: event.arguments };
            }
            this.events?.onToolCall?.({
              id: event.call_id,
              name: event.name,
              arguments: parsedArgs,
            });
          }
          break;

        case 'response.done': {
          const assistantMsg: VoiceMessage = {
            id: event.response?.id || 'msg_asst_' + Date.now(),
            role: 'assistant',
            type: 'text',
            text: this.currentTurnAssistantText,
            timestamp,
          };
          if (this.currentTurnAssistantText) {
            this.events?.onMessage?.(assistantMsg);
          }
          this.status = 'connected';
          this.events?.onStatusChange?.('connected');
          break;
        }

        case 'error': {
          const errMessage = event.error?.message || 'OpenAI Realtime error';
          this.status = 'error';
          this.events?.onStatusChange?.('error');
          const error = new Error(errMessage);
          this.events?.onError?.(error);
          onSessionError?.(error);
          break;
        }
      }
    } catch (err) {
      this.events?.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  sendAudio(base64Audio: string): void {
    if (this.status !== 'connected' && this.status !== 'listening' && this.status !== 'recording') {
      return;
    }
    if (this.status !== 'listening') {
      this.status = 'listening';
      this.events?.onStatusChange?.('listening');
    }
    this.sendJson({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  }

  sendText(text: string): void {
    this.sendJson({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.sendJson({
      type: 'response.create',
    });
  }

  sendToolResult(toolCallId: string, result: unknown): void {
    const outputString = typeof result === 'string' ? result : JSON.stringify(result);
    this.sendJson({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: toolCallId,
        output: outputString,
      },
    });
    this.sendJson({
      type: 'response.create',
    });
  }

  commitAudio(): void {
    if (this.status === 'listening' || this.status === 'recording') {
      this.status = 'processing';
      this.events?.onStatusChange?.('processing');
    }
    this.sendJson({
      type: 'input_audio_buffer.commit',
    });
    this.sendJson({
      type: 'response.create',
    });
  }

  interrupt(): void {
    if (this.currentResponseId) {
      this.sendJson({
        type: 'response.cancel',
      });
    }
    this.status = 'connected';
    this.events?.onStatusChange?.('connected');
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.status = 'disconnected';
    this.events?.onStatusChange?.('disconnected');
    this.events = null;
  }
}
