// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { encodeBurst, rms } from './useWakeWord';

const decode = (b64: string) => {
  const bin = atob(b64);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  return Array.from({ length: bin.length / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe('wake-word audio helpers', () => {
  it('measures loudness as RMS', () => {
    expect(rms(new Float32Array(4))).toBe(0);
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
  });

  it('joins frames and keeps 16 kHz input as little-endian PCM16', () => {
    const pcm = decode(
      encodeBurst([new Float32Array([0, 0.5]), new Float32Array([-0.5, 1])], 16000)
    );
    expect(pcm).toEqual([0, Math.trunc(0.5 * 0x7fff), -0x4000, 0x7fff]);
  });

  it('downsamples 48 kHz to 16 kHz and clamps out-of-range samples', () => {
    const frame = new Float32Array(48).fill(2);
    const pcm = decode(encodeBurst([frame], 48000));
    expect(pcm).toHaveLength(16);
    expect(pcm.every((v) => v === 0x7fff)).toBe(true);
  });
});
