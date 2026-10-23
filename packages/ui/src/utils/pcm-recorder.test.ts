// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PcmStreamRecorder, resampleFloat32, float32ToBase64Pcm16 } from './pcm-recorder';

describe('resampleFloat32', () => {
  it('handles empty or zero-length input array', () => {
    expect(resampleFloat32(new Float32Array(0), 48000, 24000)).toEqual(new Float32Array(0));
  });

  it('returns same array if source and target sample rates match', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const output = resampleFloat32(input, 24000, 24000);
    expect(output).toBe(input);
  });

  it('downsamples 48kHz to 24kHz (2:1 decimation with interpolation)', () => {
    // 4 samples at 48kHz -> 2 samples at 24kHz
    const input = new Float32Array([0.0, 0.5, 1.0, 0.5]);
    const output = resampleFloat32(input, 48000, 24000);

    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(0.0, 4);
    expect(output[1]).toBeCloseTo(1.0, 4);
  });

  it('upsamples 16kHz to 24kHz (2:3 interpolation)', () => {
    // 2 samples at 16kHz -> 3 samples at 24kHz
    const input = new Float32Array([0.0, 1.0]);
    const output = resampleFloat32(input, 16000, 24000);

    expect(output.length).toBe(3);
    expect(output[0]).toBeCloseTo(0.0, 4);
    // index 1: srcIndex = 1 * (16000/24000) = 0.6667 -> 0.0 + 0.6667 * (1.0 - 0.0)
    expect(output[1]).toBeCloseTo(2 / 3, 4);
    expect(output[2]).toBeCloseTo(1.0, 4);
  });
});

describe('float32ToBase64Pcm16', () => {
  it('returns empty string on empty input', () => {
    expect(float32ToBase64Pcm16(new Float32Array(0))).toBe('');
  });

  it('converts normalized float samples to 16-bit little-endian PCM Base64', () => {
    // +1.0 -> 32767 (0xFF, 0x7F)
    // -1.0 -> -32768 (0x00, 0x80)
    //  0.0 -> 0      (0x00, 0x00)
    const samples = new Float32Array([1.0, -1.0, 0.0]);
    const base64 = float32ToBase64Pcm16(samples);
    const decoded = atob(base64);

    expect(decoded.length).toBe(6);

    // sample 0: 32767 -> low: 0xFF, high: 0x7F
    expect(decoded.charCodeAt(0)).toBe(0xff);
    expect(decoded.charCodeAt(1)).toBe(0x7f);

    // sample 1: -32768 -> low: 0x00, high: 0x80
    expect(decoded.charCodeAt(2)).toBe(0x00);
    expect(decoded.charCodeAt(3)).toBe(0x80);

    // sample 2: 0 -> low: 0x00, high: 0x00
    expect(decoded.charCodeAt(4)).toBe(0x00);
    expect(decoded.charCodeAt(5)).toBe(0x00);
  });

  it('clamps values beyond [-1.0, 1.0] to prevent integer overflow', () => {
    const samples = new Float32Array([2.5, -3.0]);
    const base64 = float32ToBase64Pcm16(samples);
    const decoded = atob(base64);

    expect(decoded.charCodeAt(0)).toBe(0xff);
    expect(decoded.charCodeAt(1)).toBe(0x7f);

    expect(decoded.charCodeAt(2)).toBe(0x00);
    expect(decoded.charCodeAt(3)).toBe(0x80);
  });
});

describe('PcmStreamRecorder', () => {
  let mockAudioContext: any;
  let mockSourceNode: any;
  let mockScriptProcessor: any;
  let mockMediaStream: any;
  let mockTrack: any;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockTrack = {
      stop: vi.fn(),
    };
    mockMediaStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    mockScriptProcessor = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null as ((e: any) => void) | null,
    };

    mockAudioContext = {
      state: 'running',
      sampleRate: 48000,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createMediaStreamSource: vi.fn().mockReturnValue(mockSourceNode),
      createScriptProcessor: vi.fn().mockReturnValue(mockScriptProcessor),
    };

    function MockAudioContextConstructor() {
      return mockAudioContext;
    }
    (window as any).AudioContext = MockAudioContextConstructor;

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the final partial chunk before committing after capture closes', async () => {
    const recorder = new PcmStreamRecorder({ sessionId: 'tail', fetchFn: mockFetch as any });
    await recorder.start(mockMediaStream, 'short-turn');
    mockScriptProcessor.onaudioprocess({
      inputBuffer: { getChannelData: () => new Float32Array(4800).fill(0.25) },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await recorder.stop()).toEqual({ committed: true });
    const payloads = mockFetch.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(atob(payloads[0].audio)).toHaveLength(4800);
    expect(payloads[1]).toMatchObject({ commit: true, turnId: 'short-turn' });
  });

  it('reports empty capture without sending a misleading commit', async () => {
    const recorder = new PcmStreamRecorder({ sessionId: 'empty', fetchFn: mockFetch as any });
    await recorder.start(mockMediaStream, 'empty-turn');
    const result = await recorder.stop();
    expect(result.committed).toBe(false);
    expect(result.error).toContain('No microphone audio');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('initializes capture, processes audio frames, and sends continuous chunks', async () => {
    const onChunkSent = vi.fn();
    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 100, // 100ms chunk
      fetchFn: mockFetch as any,
      onChunkSent,
    });

    await recorder.start(mockMediaStream, 'turn_abc');
    expect(recorder.isRecording()).toBe(true);

    // 48000Hz * 0.1s = 4800 samples per chunk
    const samples = new Float32Array(4800);
    samples[0] = 0.5;

    // Simulate audio frame from Web Audio node
    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => samples,
      },
    });

    // Wait a tick for async processQueue
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('/api/v1/voice/sessions/sess_123/audio');
    const body = JSON.parse(callArgs[1].body);
    expect(body.commit).toBe(false);
    expect(body.turnId).toBe('turn_abc');
    expect(typeof body.audio).toBe('string');
    expect(body.audio.length).toBeGreaterThan(0);
    expect(onChunkSent).toHaveBeenCalledWith(0, 0);

    recorder.cancel();
  });

  it('stops recording, releases tracks, and commits turn only after draining chunks', async () => {
    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 100,
      fetchFn: mockFetch as any,
    });

    await recorder.start(mockMediaStream, 'turn_abc');

    // Feed a frame
    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(4800),
      },
    });

    // Call stop() on push-to-talk release
    await recorder.stop();

    expect(recorder.isRecording()).toBe(false);
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(mockScriptProcessor.disconnect).toHaveBeenCalled();
    expect(mockSourceNode.disconnect).toHaveBeenCalled();

    // Verify chunk was sent first, then commit
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const chunkBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(chunkBody.commit).toBe(false);

    const commitBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(commitBody.commit).toBe(true);
    expect(commitBody.turnId).toBe('turn_abc');
  });

  it('immediately purges queued chunks and aborts in-flight request on cancel()', async () => {
    let abortSignalObserved: AbortSignal | undefined;

    mockFetch = vi.fn().mockImplementation((_url, opts) => {
      abortSignalObserved = opts?.signal;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({}) }), 50);
      });
    });

    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 50,
      fetchFn: mockFetch as any,
    });

    await recorder.start(mockMediaStream, 'turn_abc');

    // Trigger audio processing
    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(2400),
      },
    });

    // Cancel while sending
    recorder.cancel();

    expect(recorder.isRecording()).toBe(false);
    expect(recorder.getPendingChunkCount()).toBe(0);
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(abortSignalObserved?.aborted).toBe(true);

    // Call stop after cancel should not commit
    await recorder.stop();
    const calls = mockFetch.mock.calls;
    const hasCommit = calls.some((c) => {
      try {
        return JSON.parse(c[1].body).commit === true;
      } catch {
        return false;
      }
    });
    expect(hasCommit).toBe(false);
  });

  it('bounds queue, stops capture, reports audio loss, and refuses to commit on overflow', async () => {
    // Hang fetch to simulate stalled network
    mockFetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const onBackpressure = vi.fn();
    const onAudioLoss = vi.fn();
    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 50,
      maxPendingChunks: 2,
      fetchFn: mockFetch as any,
      onBackpressure,
      onAudioLoss,
    });

    await recorder.start(mockMediaStream, 'turn_slow');

    // Feed 3 separate chunks to trigger queue overflow
    for (let i = 0; i < 3; i++) {
      mockScriptProcessor.onaudioprocess({
        inputBuffer: {
          getChannelData: () => new Float32Array(2400),
        },
      });
    }

    expect(recorder.hasLostAudio()).toBe(true);
    expect(recorder.isIncomplete()).toBe(true);
    expect(onAudioLoss).toHaveBeenCalled();
    expect(onBackpressure).toHaveBeenCalledWith(1);
    expect(recorder.isRecording()).toBe(false); // capture halted automatically

    // Calling stop on an incomplete turn refuses to commit
    const result = await recorder.stop();
    expect(result.committed).toBe(false);
    expect(result.error).toContain('Turn incomplete');

    // No commit request was made to server
    const calls = mockFetch.mock.calls;
    const hasCommit = calls.some((c) => {
      try {
        return JSON.parse(c[1].body).commit === true;
      } catch {
        return false;
      }
    });
    expect(hasCommit).toBe(false);

    recorder.cancel();
  });

  it('tracks monotonic sequence numbers across sent chunks', async () => {
    const onChunkSent = vi.fn();
    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 50,
      fetchFn: mockFetch as any,
      onChunkSent,
    });

    await recorder.start(mockMediaStream, 'turn_seq');

    // Feed 2 chunks
    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(2400),
      },
    });
    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(2400),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const body0 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body1 = JSON.parse(mockFetch.mock.calls[1][1].body);

    expect(body0.sequenceNumber).toBe(0);
    expect(body1.sequenceNumber).toBe(1);
    expect(onChunkSent).toHaveBeenCalledWith(0, 0);
    expect(onChunkSent).toHaveBeenCalledWith(1, 1);

    recorder.cancel();
  });

  it('marks turn incomplete and halts capture on chunk delivery failure', async () => {
    mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network drop'));

    const onAudioLoss = vi.fn();
    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      targetSampleRate: 24000,
      chunkDurationMs: 50,
      fetchFn: mockFetch as any,
      onAudioLoss,
    });

    await recorder.start(mockMediaStream, 'turn_fail');

    mockScriptProcessor.onaudioprocess({
      inputBuffer: {
        getChannelData: () => new Float32Array(2400),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(recorder.hasLostAudio()).toBe(true);
    expect(recorder.isIncomplete()).toBe(true);
    expect(onAudioLoss).toHaveBeenCalled();
    expect(recorder.isRecording()).toBe(false);

    // Stop must refuse to commit
    const result = await recorder.stop();
    expect(result.committed).toBe(false);

    recorder.cancel();
  });

  it('reports error cleanly if Web Audio API is unsupported', async () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;

    const recorder = new PcmStreamRecorder({
      sessionId: 'sess_123',
      fetchFn: mockFetch as any,
    });

    await expect(recorder.start(mockMediaStream, 'turn_err')).rejects.toThrow(
      'Web Audio API is not supported in this browser.'
    );
  });
});
