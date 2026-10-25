/**
 * "Hey Leo" — hands-free wake word, checked by LEO's local Whisper.
 *
 * The microphone stays open while enabled, but audio leaves the browser only
 * as short speech bursts (≤2.5 s) found by an energy detector, and only to the
 * local gateway (`POST /api/v1/voice/wake`), which transcribes them on this PC.
 */
import { useEffect, useRef, useState } from 'react';

export type WakeState = 'off' | 'starting' | 'listening' | 'checking' | 'error';

const RATE = 16000;
const FRAME = 2048;
const MAX_BURST_MS = 2500;
const MIN_BURST_MS = 250;
const END_SILENCE_MS = 450;
const PRE_ROLL_FRAMES = 3;

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.sqrt(sum / (frame.length || 1));
}

/** Join float frames, resample linearly to 16 kHz, encode as base64 PCM16 LE. */
export function encodeBurst(frames: Float32Array[], inputRate: number): string {
  const length = frames.reduce((n, f) => n + f.length, 0);
  const joined = new Float32Array(length);
  let offset = 0;
  for (const f of frames) {
    joined.set(f, offset);
    offset += f.length;
  }
  const ratio = inputRate / RATE;
  const outLength = Math.floor(length / ratio);
  const bytes = new Uint8Array(outLength * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, length - 1);
    const sample = joined[lo]! + (joined[hi]! - joined[lo]!) * (pos - lo);
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Ends a hands-free turn: calls `onStop` after 1.2 s of silence once speech has
 * started, after 6 s if speech never starts, or at 15 s regardless.
 */
export function useSilenceStop(stream: MediaStream | null, active: boolean, onStop: () => void) {
  const onStopRef = useRef(onStop);
  useEffect(() => {
    onStopRef.current = onStop;
  });

  useEffect(() => {
    if (!active || !stream) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const started = Date.now();
    let heardSpeech = false;
    let lastVoice = Date.now();
    let stopped = false;

    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const now = Date.now();
      if (rms(samples) > 0.02) {
        heardSpeech = true;
        lastVoice = now;
      }
      const done =
        (heardSpeech && now - lastVoice > 1200) ||
        (!heardSpeech && now - started > 6000) ||
        now - started > 15000;
      if (done && !stopped) {
        stopped = true;
        onStopRef.current();
      }
    }, 100);

    return () => {
      clearInterval(timer);
      void ctx.close().catch(() => undefined);
    };
  }, [stream, active]);
}

interface WakeWordOptions {
  enabled: boolean;
  /** True while LEO is recording or speaking, so its own voice can't wake it. */
  paused: boolean;
  onWake: () => void;
}

export function useWakeWord({ enabled, paused, onWake }: WakeWordOptions) {
  const [state, setState] = useState<WakeState>('off');
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    pausedRef.current = paused;
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    if (!enabled) {
      setState('off');
      return;
    }
    let disposed = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    setState('starting');
    setError(null);

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (disposed) return;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        // ScriptProcessor, not AudioWorklet: the page CSP blocks blob: worklet modules.
        const processor = ctx.createScriptProcessor(FRAME, 1, 1);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(processor);
        processor.connect(mute);
        mute.connect(ctx.destination);

        const frameMs = (FRAME / ctx.sampleRate) * 1000;
        const inputRate = ctx.sampleRate;
        let noiseFloor = 0.01;
        let preRoll: Float32Array[] = [];
        let burst: Float32Array[] | null = null;
        let silentMs = 0;
        let checking = false;

        const check = async (frames: Float32Array[]) => {
          checking = true;
          setState('checking');
          try {
            const res = await fetch('/api/v1/voice/wake', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: encodeBurst(frames, inputRate), sampleRate: RATE }),
            });
            if (disposed) return;
            if (res.status === 503) {
              setError('Local Whisper is unavailable — wake word paused.');
              setState('error');
              return;
            }
            const json = await res.json().catch(() => null);
            if (json?.data?.detected && !pausedRef.current) onWakeRef.current();
          } catch {
            // Network blip: keep listening for the next burst.
          } finally {
            checking = false;
            if (!disposed) setState((s) => (s === 'error' ? s : 'listening'));
          }
        };

        processor.onaudioprocess = (e) => {
          if (disposed) return;
          const frame = new Float32Array(e.inputBuffer.getChannelData(0));
          if (pausedRef.current || checking) {
            burst = null;
            preRoll = [];
            return;
          }
          const level = rms(frame);
          const speaking = level > Math.max(0.015, noiseFloor * 3);
          if (!speaking && !burst) noiseFloor = noiseFloor * 0.95 + level * 0.05;

          if (!burst) {
            preRoll = [...preRoll, frame].slice(-PRE_ROLL_FRAMES);
            if (speaking) {
              burst = [...preRoll];
              silentMs = 0;
            }
            return;
          }
          burst.push(frame);
          silentMs = speaking ? 0 : silentMs + frameMs;
          const length = burst.length * frameMs;
          if (silentMs >= END_SILENCE_MS || length >= MAX_BURST_MS) {
            const done = burst;
            burst = null;
            preRoll = [];
            if (length - silentMs >= MIN_BURST_MS) void check(done);
          }
        };
        setState('listening');
      } catch (err) {
        if (disposed) return;
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Microphone access was denied — "Hey Leo" needs the microphone.'
            : 'Could not start the microphone for "Hey Leo".'
        );
        setState('error');
      }
    };
    void start();

    return () => {
      disposed = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
    };
  }, [enabled]);

  return { state, error };
}
