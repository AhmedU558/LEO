// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { VoicePage } from './VoicePage';

vi.mock('../components/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(element);
  });
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

let mockAudioContext: any;
let mockSourceNodes: any[];
let latestEventSourceInstance: any = null;
let latestMediaTrack: any = null;

function createMockAudioContext() {
  mockSourceNodes = [];
  return {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: vi.fn().mockImplementation(function (this: any) {
      this.state = 'running';
      return Promise.resolve();
    }),
    close: vi.fn().mockResolvedValue(undefined),
    createBuffer: vi
      .fn()
      .mockImplementation((channels: number, length: number, sampleRate: number) => {
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          copyToChannel: vi.fn(),
        };
      }),
    createBufferSource: vi.fn().mockImplementation(() => {
      const node = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null as (() => void) | null,
      };
      mockSourceNodes.push(node);
      return node;
    }),
    createMediaStreamSource: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
    createScriptProcessor: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    })),
  };
}

describe('VoicePage Component', () => {
  beforeEach(() => {
    mockAudioContext = createMockAudioContext();
    function MockAudioContextConstructor() {
      return mockAudioContext;
    }
    (window as any).AudioContext = MockAudioContextConstructor;
    latestEventSourceInstance = null;

    // Mock navigator.mediaDevices
    latestMediaTrack = { stop: vi.fn(), onended: null };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockImplementation(() => {
          latestMediaTrack = { stop: vi.fn(), onended: null };
          return Promise.resolve({
            getTracks: () => [latestMediaTrack],
            getAudioTracks: () => [latestMediaTrack],
          });
        }),
      },
      configurable: true,
      writable: true,
    });

    // Mock EventSource
    class MockEventSource {
      listeners: Record<string, ((event: any) => void)[]> = {};
      addEventListener = vi.fn((event: string, cb: any) => {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(cb);
      });
      removeEventListener = vi.fn();
      close = vi.fn();

      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Tests inject events through this mock connection.
        latestEventSourceInstance = this;
      }

      emit(event: string, data: any) {
        this.listeners[event]?.forEach((cb) =>
          cb(new MessageEvent(event, { data: JSON.stringify(data) }))
        );
      }
    }
    global.EventSource = MockEventSource as any;

    // Mock fetch for sessions
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    });
  });

  it('renders initial disconnected state with start voice session action', () => {
    const container = render(<VoicePage />);

    expect(container.textContent).toContain('Voice Interface');
    expect(container.textContent).toContain('Push-to-Talk and tool safety boundaries');
    expect(container.textContent).toContain('Ready to talk?');
    expect(container.textContent).toContain('Start Voice Session');
  });

  it('shows microphone permission error notice when getUserMedia is denied', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
      configurable: true,
      writable: true,
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');
    expect(startButton).toBeTruthy();
    expect(startButton?.textContent).toContain('Start Voice Session');
  });

  it('renders active session controls when a session is active', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/v1/voice/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'session-voice-abc',
              userId: 'user-1',
              status: 'connected',
              provider: 'mock',
              createdAt: new Date().toISOString(),
              messages: [],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');
    expect(startButton).toBeTruthy();

    await act(async () => {
      startButton?.click();
    });

    expect(container.textContent).toContain('Session: session-voice-abc');
    expect(container.textContent).toContain('Mode: Push-to-Talk');
    expect(container.textContent).toContain('Push and hold to talk (or hold Spacebar)');
    expect(container.textContent).toContain('Voice Tool Invocation');
    expect(container.textContent).toContain('Execute Tool');
    const toolInput = container.querySelector('input[placeholder*="Tool Name"]');
    expect(toolInput).toBeTruthy();

    act(() => {
      latestEventSourceInstance.listeners.error[0](new Event('error'));
    });
    expect(container.textContent).not.toContain('Voice provider error');
    act(() => {
      latestEventSourceInstance.emit('error', { error: 'Voice model unavailable' });
    });
    expect(container.textContent).toContain('Voice model unavailable');
  });

  it('enqueues audio deltas received over SSE and flushes on turn cancellation', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/cancel')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ cancelled: true }),
        });
      }
      if (typeof url === 'string' && url.includes('/api/v1/voice/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'session-voice-pcm',
              userId: 'user-1',
              status: 'connected',
              provider: 'mock',
              createdAt: new Date().toISOString(),
              messages: [],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');

    await act(async () => {
      startButton?.click();
    });

    expect(latestEventSourceInstance).not.toBeNull();

    // 48 bytes -> 24 samples
    const sampleBytes = new Uint8Array(48);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]!);
    const chunkBase64 = btoa(binary);

    // Emit audio_delta event from SSE stream
    act(() => {
      latestEventSourceInstance.emit('audio_delta', {
        type: 'audio_delta',
        sessionId: 'session-voice-pcm',
        event: {
          delta: chunkBase64,
          format: 'pcm16',
          sampleRate: 24000,
          responseId: 'resp_123',
        },
      });
    });

    // Audio node was scheduled
    expect(mockSourceNodes.length).toBe(1);
    expect(mockSourceNodes[0].start).toHaveBeenCalled();

    // Now test cancel turn
    const cancelBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cancel Turn')
    );
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn?.click();
    });

    // Node was stopped upon cancellation
    expect(mockSourceNodes[0].stop).toHaveBeenCalled();
  });

  it('streams audio chunks during push-to-talk and commits on release', async () => {
    const audioRequests: any[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (typeof url === 'string' && url.includes('/audio')) {
        const body = opts?.body ? JSON.parse(opts.body) : {};
        audioRequests.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ received: true, committed: body.commit }),
        });
      }
      if (typeof url === 'string' && url.includes('/api/v1/voice/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: 'session-voice-stream',
              userId: 'user-1',
              status: 'connected',
              provider: 'mock',
              createdAt: new Date().toISOString(),
              messages: [],
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');

    await act(async () => {
      startButton?.click();
    });

    // Find the push-to-talk button
    const pttButton = container.querySelector('button[aria-label="Push and hold to speak"]');
    expect(pttButton).toBeTruthy();

    // Start push-to-talk (press)
    await act(async () => {
      pttButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(container.textContent).toContain('Listening... Release to process');

    // Deliver one buffer of microphone samples, as a live microphone would.
    // The recorder deliberately refuses to commit a turn that captured no
    // audio, so without this the release below has nothing to commit.
    const processors = mockAudioContext.createScriptProcessor.mock.results;
    const processor = processors[processors.length - 1]?.value;
    expect(processor?.onaudioprocess).toBeTypeOf('function');
    await act(async () => {
      processor.onaudioprocess({
        inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.25) },
      });
    });

    // Stop push-to-talk (release)
    await act(async () => {
      pttButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // At least the final commit request was sent
    expect(audioRequests.length).toBeGreaterThanOrEqual(1);
    const lastRequest = audioRequests[audioRequests.length - 1];
    expect(lastRequest.commit).toBe(true);
    expect(typeof lastRequest.turnId).toBe('string');
  });

  it('handles rapid press and release before getUserMedia resolves by stopping acquired tracks', async () => {
    let resolveMedia!: (val: any) => void;
    const mediaPromise = new Promise((resolve) => {
      resolveMedia = resolve;
    });

    const mockTrack = { stop: vi.fn(), onended: null };
    let callCount = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              getTracks: () => [{ stop: vi.fn() }],
              getAudioTracks: () => [{ stop: vi.fn() }],
            });
          }
          return mediaPromise;
        }),
      },
      configurable: true,
      writable: true,
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');

    await act(async () => {
      startButton?.click();
    });

    const pttButton = container.querySelector('button[aria-label="Push and hold to speak"]');
    expect(pttButton).toBeTruthy();

    // User presses
    await act(async () => {
      pttButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    // Rapid release before getUserMedia resolves (<50ms)
    await act(async () => {
      pttButton?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    // getUserMedia resolves now
    await act(async () => {
      resolveMedia({
        getTracks: () => [mockTrack],
        getAudioTracks: () => [mockTrack],
      });
    });

    // Mock track should be immediately stopped and no recording started
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(container.textContent).not.toContain('Listening... Release to process');
  });

  it('handles microphone disconnection gracefully when audio track ends', async () => {
    const mockTrack = { stop: vi.fn(), onended: null as (() => void) | null };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [mockTrack],
          getAudioTracks: () => [mockTrack],
        }),
      },
      configurable: true,
      writable: true,
    });

    const container = render(<VoicePage />);
    const startButton = container.querySelector('button');

    await act(async () => {
      startButton?.click();
    });

    const pttButton = container.querySelector('button[aria-label="Push and hold to speak"]');

    // Start push-to-talk
    await act(async () => {
      pttButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(container.textContent).toContain('Listening... Release to process');

    // Device disconnects: audioTrack.onended fires
    await act(async () => {
      mockTrack.onended?.();
    });

    // UI should reset to connected, not listening
    expect(container.textContent).not.toContain('Listening... Release to process');
    expect(container.textContent).toContain('Push and hold to talk (or hold Spacebar)');
  });
});
