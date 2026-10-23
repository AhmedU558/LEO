/**
 * PCM16 Web Audio Player
 *
 * Dedicated playback queue for streaming 16-bit linear PCM audio deltas
 * (e.g. from OpenAI Realtime API) via the Web Audio API.
 *
 * Handles:
 * - Base64 to signed 16-bit PCM to float32 sample conversion.
 * - Sample rate management (default 24kHz mono).
 * - Jitter buffer & sequential scheduling without overlapping or audio gaps.
 * - Browser autoplay policy suspension/resumption on user interaction.
 * - Bounded queue size & memory limits (drops excess chunks if client falls behind).
 * - Immediate timeline flush on turn cancellation / response interruption.
 * - Resource cleanup on session end or component unmount.
 */

export interface Pcm16PlayerOptions {
  sampleRate?: number;
  maxQueueDurationSec?: number;
  maxQueuedNodes?: number;
  onStateChange?: (state: 'idle' | 'playing' | 'error') => void;
}

/**
 * Convert a Base64 string containing signed 16-bit little-endian PCM samples
 * to a Float32Array normalized between -1.0 and 1.0.
 */
export function base64ToFloat32Array(base64: string): Float32Array<ArrayBuffer> {
  if (!base64 || typeof base64 !== 'string') {
    return new Float32Array(0);
  }

  try {
    const binaryString = atob(base64);
    const len = binaryString.length;
    // PCM16 requires 2 bytes per sample
    const sampleCount = Math.floor(len / 2);
    if (sampleCount === 0) {
      return new Float32Array(0);
    }

    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const low = binaryString.charCodeAt(i * 2);
      const high = binaryString.charCodeAt(i * 2 + 1);
      // Little-endian signed 16-bit sample
      let int16 = (high << 8) | low;
      if (int16 >= 0x8000) {
        int16 -= 0x10000;
      }
      float32[i] = int16 < 0 ? int16 / 32768.0 : int16 / 32767.0;
    }
    return float32;
  } catch {
    // Return empty array on malformed base64 without throwing
    return new Float32Array(0);
  }
}

export class Pcm16Player {
  private audioContext: AudioContext | null = null;
  private readonly sampleRate: number;
  private readonly maxQueueDurationSec: number;
  private readonly maxQueuedNodes: number;
  private readonly onStateChange?: (state: 'idle' | 'playing' | 'error') => void;

  private nextScheduledTime = 0;
  private activeNodes: AudioBufferSourceNode[] = [];
  private currentResponseId: string | null = null;
  private isDisposed = false;

  constructor(options: Pcm16PlayerOptions = {}) {
    this.sampleRate = options.sampleRate ?? 24000;
    this.maxQueueDurationSec = options.maxQueueDurationSec ?? 30;
    this.maxQueuedNodes = options.maxQueuedNodes ?? 100;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Initialize or resume AudioContext upon user gesture.
   */
  async initOrResume(): Promise<boolean> {
    if (this.isDisposed) return false;

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextClass) {
        return false;
      }

      if (!this.audioContext) {
        this.audioContext = new AudioContextClass({ sampleRate: this.sampleRate });
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      return this.audioContext.state === 'running';
    } catch {
      this.onStateChange?.('error');
      return false;
    }
  }

  /**
   * Reset timeline and drop any queued buffers for superseded responses.
   */
  resetResponse(newResponseId?: string): void {
    if (newResponseId && this.currentResponseId && newResponseId !== this.currentResponseId) {
      this.flush();
    }
    this.currentResponseId = newResponseId ?? null;
  }

  /**
   * Enqueue a PCM16 Base64 audio delta.
   * Returns true if successfully scheduled, false if dropped or error.
   */
  enqueue(deltaBase64: string, responseId?: string): boolean {
    if (this.isDisposed || !deltaBase64) return false;

    // Discard chunks from superseded responses if identifiers are present
    if (responseId && this.currentResponseId && responseId !== this.currentResponseId) {
      return false;
    }
    if (responseId && !this.currentResponseId) {
      this.currentResponseId = responseId;
    }

    const samples = base64ToFloat32Array(deltaBase64);
    if (samples.length === 0) {
      return false;
    }

    // Lazy init or verify AudioContext
    if (!this.audioContext) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return false;
      try {
        this.audioContext = new AudioContextClass({ sampleRate: this.sampleRate });
      } catch {
        this.onStateChange?.('error');
        return false;
      }
    }

    try {
      const ctx = this.audioContext;
      const currentTime = ctx.currentTime;

      // Bound queue size to prevent memory leaks if client falls behind
      if (
        this.activeNodes.length >= this.maxQueuedNodes ||
        this.nextScheduledTime - currentTime > this.maxQueueDurationSec
      ) {
        return false;
      }

      const audioBuffer = ctx.createBuffer(1, samples.length, this.sampleRate);
      audioBuffer.copyToChannel(samples, 0);

      const startTime = Math.max(currentTime, this.nextScheduledTime);
      const sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(ctx.destination);

      sourceNode.onended = () => {
        const index = this.activeNodes.indexOf(sourceNode);
        if (index !== -1) {
          this.activeNodes.splice(index, 1);
        }
        if (this.activeNodes.length === 0) {
          this.onStateChange?.('idle');
        }
      };

      sourceNode.start(startTime);
      this.nextScheduledTime = startTime + audioBuffer.duration;
      this.activeNodes.push(sourceNode);

      this.onStateChange?.('playing');
      return true;
    } catch {
      this.onStateChange?.('error');
      return false;
    }
  }

  /**
   * Immediately cancel and flush all scheduled and playing audio.
   */
  flush(): void {
    for (const node of this.activeNodes) {
      try {
        node.onended = null;
        node.stop();
        node.disconnect();
      } catch {
        // Ignore already stopped node errors
      }
    }
    this.activeNodes = [];
    if (this.audioContext) {
      this.nextScheduledTime = this.audioContext.currentTime;
    } else {
      this.nextScheduledTime = 0;
    }
    this.currentResponseId = null;
    this.onStateChange?.('idle');
  }

  /**
   * Whether audio is actively playing or scheduled.
   */
  isPlaying(): boolean {
    return this.activeNodes.length > 0;
  }

  /**
   * Total scheduled audio duration currently queued ahead of currentTime in seconds.
   */
  getScheduledAheadDuration(): number {
    if (!this.audioContext) return 0;
    return Math.max(0, this.nextScheduledTime - this.audioContext.currentTime);
  }

  /**
   * Count of currently scheduled nodes.
   */
  getQueuedNodeCount(): number {
    return this.activeNodes.length;
  }

  /**
   * Clean up all audio resources.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.flush();
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }
  }
}
