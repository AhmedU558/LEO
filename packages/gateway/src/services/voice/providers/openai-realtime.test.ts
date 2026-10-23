import { describe, it, expect, vi } from 'vitest';
import { OpenAIRealtimeVoiceProvider } from './openai-realtime.js';
import type { VoiceAudioDeltaEvent, VoiceProviderEvents } from '@ownpilot/core/voice';

const sockets = vi.hoisted(() => [] as any[]);
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: class extends EventEmitter {
      static OPEN = 1;
      readyState = 1;
      send = vi.fn();
      close = vi.fn(() => this.emit('close'));
      constructor(
        public url: string,
        public options: unknown
      ) {
        super();
        sockets.push(this);
      }
    },
  };
});

describe('OpenAI Realtime GA session setup', () => {
  it('waits for session.updated and sends the GA configuration without beta headers', async () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });
    const connected = vi.fn();
    const connection = provider.connect({}).then(connected);
    const socket = sockets.at(-1);
    socket.emit('open');
    await Promise.resolve();
    expect(connected).not.toHaveBeenCalled();
    expect(provider.getStatus()).toBe('connecting');
    expect(socket.options.headers).not.toHaveProperty('OpenAI-Beta');
    expect(socket.url).toContain('model=gpt-realtime-2.1');
    const update = JSON.parse(socket.send.mock.calls[0][0]);
    expect(update.session).toMatchObject({
      type: 'realtime',
      output_modalities: ['audio'],
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: null },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'alloy' },
      },
    });
    socket.emit('message', Buffer.from('{"type":"session.updated"}'));
    await connection;
    expect(provider.getStatus()).toBe('connected');
    provider.disconnect();
  });

  it('rejects setup with the provider error instead of announcing a connected session', async () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });
    const connection = provider.connect({});
    const assertion = expect(connection).rejects.toThrow('Model unavailable');
    const socket = sockets.at(-1);
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'error',
          error: { message: 'Model unavailable' },
        })
      )
    );
    await assertion;
    expect(socket.close).toHaveBeenCalled();
  });
});

describe('OpenAIRealtimeVoiceProvider - Audio Delta Downlink', () => {
  it('parses response.output_audio.delta and forwards onAudioDelta with PCM16 24kHz metadata', () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });

    const audioDeltas: VoiceAudioDeltaEvent[] = [];
    const events: VoiceProviderEvents = {
      onAudioDelta: (e) => audioDeltas.push(e),
    };

    // Attach events directly to provider
    (provider as any).events = events;
    (provider as any).currentResponseId = 'resp_123';

    // Simulate OpenAI server frame
    const serverFrame = JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_123',
      item_id: 'item_456',
      delta: 'aGVsbG8td29ybGQ=', // base64 payload
    });

    (provider as any).handleServerEvent(serverFrame);

    expect(audioDeltas).toHaveLength(1);
    expect(audioDeltas[0]).toEqual(
      expect.objectContaining({
        sessionId: 'resp_123',
        responseId: 'resp_123',
        itemId: 'item_456',
        delta: 'aGVsbG8td29ybGQ=',
        format: 'pcm16',
        sampleRate: 24000,
        channels: 1,
      })
    );
  });

  it('safely ignores response.output_audio.delta with missing or non-string delta', () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });

    const audioDeltas: VoiceAudioDeltaEvent[] = [];
    (provider as any).events = {
      onAudioDelta: (e: VoiceAudioDeltaEvent) => audioDeltas.push(e),
    };

    // Frame with null/missing delta
    (provider as any).handleServerEvent(
      JSON.stringify({
        type: 'response.output_audio.delta',
        response_id: 'resp_123',
        delta: null,
      })
    );

    // Frame with empty string delta
    (provider as any).handleServerEvent(
      JSON.stringify({
        type: 'response.output_audio.delta',
        response_id: 'resp_123',
        delta: '',
      })
    );

    expect(audioDeltas).toHaveLength(0);
  });

  it('safely handles malformed JSON without crashing or emitting events', () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });
    const onError = vi.fn();
    (provider as any).events = { onError };

    expect(() => {
      (provider as any).handleServerEvent('not valid json {{{');
    }).not.toThrow();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('interrupt resets current response tracking and sets status to connected', () => {
    const provider = new OpenAIRealtimeVoiceProvider({ apiKey: 'test-key' });
    const onStatusChange = vi.fn();
    (provider as any).events = { onStatusChange };
    (provider as any).currentResponseId = 'resp_123';
    (provider as any).status = 'speaking';

    const sendJsonSpy = vi.spyOn(provider as any, 'sendJson').mockImplementation(() => {});

    provider.interrupt();

    expect(sendJsonSpy).toHaveBeenCalledWith({ type: 'response.cancel' });
    expect(provider.getStatus()).toBe('connected');
    expect(onStatusChange).toHaveBeenCalledWith('connected');
  });
});
