import { useEffect, useRef } from 'react';
import { ORB_COLOR, type OrbState } from './LeoOrb';

interface VoiceWaveformProps {
  state: OrbState;
  /** Live microphone while the user holds to talk. */
  micStream: MediaStream | null;
  /** LEO's speech output; called per frame because it appears after the first gesture. */
  getOutputAnalyser: () => AnalyserNode | null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Oscilloscope of real audio: the mic while listening, LEO while speaking. */
export function VoiceWaveform({ state, micStream, getOutputAnalyser }: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // The mic gets its own tiny graph; it is never connected to the speakers.
    let micContext: AudioContext | null = null;
    let micAnalyser: AnalyserNode | null = null;
    if (micStream && typeof AudioContext !== 'undefined') {
      try {
        micContext = new AudioContext();
        micAnalyser = micContext.createAnalyser();
        micAnalyser.fftSize = 512;
        micContext.createMediaStreamSource(micStream).connect(micAnalyser);
      } catch {
        micAnalyser = null;
      }
    }

    const color = ORB_COLOR[state];
    const samples = new Uint8Array(512);
    let frame = 0;

    const draw = (t: number) => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const analyser = micAnalyser ?? (state === 'speaking' ? getOutputAnalyser() : null);
      const mid = height / 2;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();

      if (analyser) {
        analyser.getByteTimeDomainData(samples);
        const n = analyser.fftSize;
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * width;
          const y = mid + ((samples[i]! - 128) / 128) * mid * 0.9;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        // Idle carrier: a faint, slow sine so the console reads as alive.
        const amp = state === 'offline' ? 0 : state === 'thinking' ? 6 : 3;
        for (let x = 0; x <= width; x += 4) {
          const y = mid + Math.sin(x / 18 + t / 400) * amp * Math.sin((x / width) * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    if (prefersReducedMotion()) {
      draw(0);
    } else {
      const loop = (t: number) => {
        draw(t);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(frame);
      void micContext?.close().catch(() => undefined);
    };
  }, [state, micStream, getOutputAnalyser]);

  return <canvas ref={canvasRef} aria-hidden className="h-16 w-full max-w-md" />;
}
