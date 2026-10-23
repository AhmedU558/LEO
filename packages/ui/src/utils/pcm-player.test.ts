// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Pcm16Player, base64ToFloat32Array } from './pcm-player';

describe('base64ToFloat32Array', () => {
  it('returns empty Float32Array on empty or invalid inputs', () => {
    expect(base64ToFloat32Array('')).toEqual(new Float32Array(0));
    expect(base64ToFloat32Array(null as unknown as string)).toEqual(new Float32Array(0));
    expect(base64ToFloat32Array(undefined as unknown as string)).toEqual(new Float32Array(0));
    expect(base64ToFloat32Array('!!!not-base64!!!')).toEqual(new Float32Array(0));
  });

  it('correctly converts 16-bit little-endian PCM to Float32 samples', () => {
    // 0 -> 0x00, 0x00
    // 32767 -> 0xFF, 0x7F (max positive)
    // -32768 -> 0x00, 0x80 (min negative)
    // 16384 -> 0x00, 0x40
    // -16384 -> 0x00, 0xC0
    const bytes = new Uint8Array([
      0x00,
      0x00, // 0
      0xff,
      0x7f, // 32767
      0x00,
      0x80, // -32768
      0x00,
      0x40, // 16384
      0x00,
      0xc0, // -16384
    ]);

    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const float32 = base64ToFloat32Array(base64);
    expect(float32.length).toBe(5);
    expect(float32[0]).toBeCloseTo(0.0, 4);
    expect(float32[1]).toBeCloseTo(1.0, 4);
    expect(float32[2]).toBeCloseTo(-1.0, 4);
    expect(float32[3]).toBeCloseTo(16384 / 32767, 4);
    expect(float32[4]).toBeCloseTo(-16384 / 32768, 4);
  });

  it('handles partial sample byte gracefully', () => {
    // 3 bytes -> only 1 complete 16-bit sample (2 bytes)
    const bytes = new Uint8Array([0x00, 0x00, 0xff]);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    const float32 = base64ToFloat32Array(base64);
    expect(float32.length).toBe(1);
    expect(float32[0]).toBeCloseTo(0.0, 4);
  });
});

describe('Pcm16Player', () => {
  let mockAudioContext: any;
  let mockSourceNodes: any[];

  function createMockAudioContext() {
    mockSourceNodes = [];
    return {
      state: 'suspended',
      currentTime: 10.0,
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
    };
  }

  beforeEach(() => {
    mockAudioContext = createMockAudioContext();
    function MockAudioContextConstructor() {
      return mockAudioContext;
    }
    (window as any).AudioContext = MockAudioContextConstructor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes and resumes AudioContext on initOrResume', async () => {
    const player = new Pcm16Player();
    expect(mockAudioContext.state).toBe('suspended');

    const ok = await player.initOrResume();
    expect(ok).toBe(true);
    expect(mockAudioContext.state).toBe('running');
    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);

    player.dispose();
  });

  it('schedules PCM audio chunks in sequence', () => {
    const onStateChange = vi.fn();
    const player = new Pcm16Player({
      sampleRate: 24000,
      onStateChange,
    });

    // 240 samples @ 24kHz = 0.01s (10ms)
    // 240 samples * 2 bytes = 480 bytes
    const sampleBytes = new Uint8Array(480);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]);
    const chunkBase64 = btoa(binary);

    // Enqueue first chunk
    const queued1 = player.enqueue(chunkBase64, 'resp_1');
    expect(queued1).toBe(true);
    expect(mockSourceNodes.length).toBe(1);
    expect(mockSourceNodes[0].start).toHaveBeenCalledWith(10.0);
    expect(onStateChange).toHaveBeenCalledWith('playing');

    // Enqueue second chunk: must be scheduled sequentially at 10.0 + 0.01 = 10.01
    const queued2 = player.enqueue(chunkBase64, 'resp_1');
    expect(queued2).toBe(true);
    expect(mockSourceNodes.length).toBe(2);
    expect(mockSourceNodes[1].start).toHaveBeenCalledWith(10.01);

    expect(player.isPlaying()).toBe(true);
    expect(player.getQueuedNodeCount()).toBe(2);

    player.dispose();
  });

  it('discards audio chunks for superseded response IDs', () => {
    const player = new Pcm16Player();
    const sampleBytes = new Uint8Array(48);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]);
    const chunkBase64 = btoa(binary);

    expect(player.enqueue(chunkBase64, 'resp_original')).toBe(true);
    expect(mockSourceNodes.length).toBe(1);

    // Stale chunk from another response ID should be dropped
    expect(player.enqueue(chunkBase64, 'resp_old_or_different')).toBe(false);
    expect(mockSourceNodes.length).toBe(1);

    // Explicit resetResponse flushes previous and accepts new response ID
    player.resetResponse('resp_new');
    expect(mockSourceNodes[0].stop).toHaveBeenCalled();
    expect(player.enqueue(chunkBase64, 'resp_new')).toBe(true);
    expect(mockSourceNodes.length).toBe(2);

    player.dispose();
  });

  it('flushes active and scheduled nodes on flush()', () => {
    const onStateChange = vi.fn();
    const player = new Pcm16Player({ onStateChange });
    const sampleBytes = new Uint8Array(48);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]);
    const chunkBase64 = btoa(binary);

    player.enqueue(chunkBase64, 'resp_1');
    player.enqueue(chunkBase64, 'resp_1');
    expect(player.getQueuedNodeCount()).toBe(2);

    player.flush();
    expect(mockSourceNodes[0].stop).toHaveBeenCalled();
    expect(mockSourceNodes[0].disconnect).toHaveBeenCalled();
    expect(mockSourceNodes[1].stop).toHaveBeenCalled();
    expect(mockSourceNodes[1].disconnect).toHaveBeenCalled();

    expect(player.getQueuedNodeCount()).toBe(0);
    expect(player.isPlaying()).toBe(false);
    expect(onStateChange).toHaveBeenCalledWith('idle');

    player.dispose();
  });

  it('enforces maximum queued node bounds to prevent memory bloat', () => {
    const player = new Pcm16Player({ maxQueuedNodes: 2 });
    const sampleBytes = new Uint8Array(48);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]);
    const chunkBase64 = btoa(binary);

    expect(player.enqueue(chunkBase64)).toBe(true);
    expect(player.enqueue(chunkBase64)).toBe(true);
    // Exceeds maxQueuedNodes
    expect(player.enqueue(chunkBase64)).toBe(false);
    expect(player.getQueuedNodeCount()).toBe(2);

    player.dispose();
  });

  it('transitions to idle when nodes finish playback', () => {
    const onStateChange = vi.fn();
    const player = new Pcm16Player({ onStateChange });
    const sampleBytes = new Uint8Array(48);
    let binary = '';
    for (let i = 0; i < sampleBytes.length; i++) binary += String.fromCharCode(sampleBytes[i]);
    const chunkBase64 = btoa(binary);

    player.enqueue(chunkBase64);
    expect(player.isPlaying()).toBe(true);

    // Simulate node playback ending
    mockSourceNodes[0].onended();
    expect(player.isPlaying()).toBe(false);
    expect(onStateChange).toHaveBeenCalledWith('idle');

    player.dispose();
  });

  it('cleans up resources and closes AudioContext on dispose()', () => {
    const player = new Pcm16Player();
    player.enqueue(btoa('1234'));
    player.dispose();

    expect(mockAudioContext.close).toHaveBeenCalledTimes(1);
    // After disposal, further operations should be no-ops
    expect(player.enqueue(btoa('1234'))).toBe(false);
  });
});
