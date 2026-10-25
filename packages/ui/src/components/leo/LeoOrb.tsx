import type { KeyboardEvent } from 'react';
import type { VoiceSessionStatus } from '../../types/leo';

export type OrbState = 'offline' | 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export function orbStateFor(status: VoiceSessionStatus): OrbState {
  switch (status) {
    case 'connected':
      return 'idle';
    case 'listening':
    case 'recording':
      return 'listening';
    case 'connecting':
    case 'processing':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    default:
      return 'offline';
  }
}

/** Accent per state, shared with the waveform. */
export const ORB_COLOR: Record<OrbState, string> = {
  offline: '#64748b',
  idle: '#22d3ee',
  listening: '#38bdf8',
  thinking: '#fbbf24',
  speaking: '#2dd4bf',
  error: '#f87171',
};

const LABEL: Record<OrbState, string> = {
  offline: 'Offline',
  idle: 'Standing by',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Attention',
};

interface LeoOrbProps {
  state: OrbState;
  /** Accessible name; describes what pressing does in this state. */
  label: string;
  disabled?: boolean;
  onPress: () => void;
  onRelease: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
}

/**
 * The console's central control: an animated orb that is also the
 * push-to-talk button (hold with pointer or Space).
 */
export function LeoOrb({
  state,
  label,
  disabled,
  onPress,
  onRelease,
  onKeyDown,
  onKeyUp,
}: LeoOrbProps) {
  const color = ORB_COLOR[state];
  const active = state === 'listening' || state === 'speaking';

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        aria-label={label}
        aria-pressed={state === 'listening'}
        disabled={disabled}
        onMouseDown={onPress}
        onMouseUp={onRelease}
        onMouseLeave={onRelease}
        onTouchStart={onPress}
        onTouchEnd={onRelease}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className="relative grid size-56 sm:size-64 place-items-center rounded-full select-none touch-none outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#050b14] disabled:cursor-not-allowed"
        style={{ color }}
      >
        {/* Outer arc ring */}
        <span
          aria-hidden
          className={`absolute inset-0 rounded-full motion-reduce:animate-none ${
            state === 'thinking' ? 'animate-leo-spin-fast' : 'animate-leo-spin'
          }`}
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${color} 70deg, transparent 140deg, transparent 200deg, ${color}99 260deg, transparent 320deg)`,
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
            WebkitMask:
              'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
          }}
        />
        {/* Dashed instrument ring */}
        <span
          aria-hidden
          className="absolute inset-5 rounded-full border border-dashed animate-leo-spin-reverse motion-reduce:animate-none"
          style={{ borderColor: `${color}66` }}
        />
        {/* Halo */}
        <span
          aria-hidden
          className="absolute inset-10 rounded-full blur-2xl animate-leo-breathe motion-reduce:animate-none"
          style={{ background: color, opacity: state === 'offline' ? 0.15 : 0.35 }}
        />
        {/* Core */}
        <span
          aria-hidden
          className={`relative size-28 sm:size-32 rounded-full motion-reduce:animate-none ${
            active ? 'animate-leo-pulse' : ''
          }`}
          style={{
            background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${color} 28%, ${color}55 62%, transparent 75%)`,
            boxShadow: `0 0 48px ${color}88, inset 0 0 24px ${color}`,
          }}
        />
      </button>
      <p
        className="font-mono text-xs uppercase tracking-[0.35em]"
        style={{ color }}
        aria-live="polite"
      >
        {LABEL[state]}
      </p>
    </div>
  );
}
