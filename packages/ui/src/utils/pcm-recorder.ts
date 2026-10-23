/**
 * PCM16 Live Microphone Streamer
 *
 * Captures microphone audio continuously during push-to-talk,
 * resamples to the configured target rate (default 24kHz mono),
 * converts to signed 16-bit little-endian PCM Base64 chunks,
 * and streams them to the voice session endpoint with bounded backpressure.
 */

export interface PcmStreamRecorderOptions {
  sessionId: string;
  targetSampleRate?: number;
  chunkDurationMs?: number;
  maxPendingChunks?: number;
  onBackpressure?: (droppedCount: number) => void;
  onAudioLoss?: (error: Error) => void;
  onError?: (error: Error) => void;
  onChunkSent?: (chunkIndex: number, sequenceNumber: number) => void;
  fetchFn?: typeof fetch;
}

/**
 * Resample Float32 audio samples using linear interpolation.
 */
export function resampleFloat32(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (!input || input.length === 0) {
    return new Float32Array(0);
  }
  if (fromRate === toRate || fromRate <= 0 || toRate <= 0) {
    return input;
  }

  const ratio = fromRate / toRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    output[i] = input[i0] + frac * (input[i1] - input[i0]);
  }

  return output;
}

/**
 * Convert normalized Float32 samples (-1.0 to 1.0) into signed 16-bit little-endian PCM Base64.
 */
export function float32ToBase64Pcm16(float32: Float32Array): string {
  if (!float32 || float32.length === 0) {
    return '';
  }

  const len = float32.length;
  const bytes = new Uint8Array(len * 2);

  for (let i = 0; i < len; i++) {
    const s = Math.max(-1.0, Math.min(1.0, float32[i]));
    let int16 = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    if (int16 > 32767) int16 = 32767;
    if (int16 < -32768) int16 = -32768;
    if (int16 < 0) int16 += 0x10000;

    bytes[i * 2] = int16 & 0xff;
    bytes[i * 2 + 1] = (int16 >> 8) & 0xff;
  }

  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < slice.length; j++) {
      binary += String.fromCharCode(slice[j]);
    }
  }

  return btoa(binary);
}

interface QueuedChunk {
  base64: string;
  turnId: string;
  index: number;
  sequenceNumber: number;
}

export class PcmStreamRecorder {
  private sessionId: string;
  private targetSampleRate: number;
  private chunkDurationMs: number;
  private maxPendingChunks: number;
  private onBackpressure?: (droppedCount: number) => void;
  private onAudioLoss?: (error: Error) => void;
  private onError?: (error: Error) => void;
  private onChunkSent?: (chunkIndex: number, sequenceNumber: number) => void;
  private fetchFn: typeof fetch;

  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: AudioNode | null = null;

  private sampleBuffer: number[] = [];
  private currentTurnId: string | null = null;
  private chunkIndex = 0;
  private sequenceNumber = 0;
  private hasAudioLoss = false;
  private isTurnIncomplete = false;
  private queue: QueuedChunk[] = [];
  private isSending = false;
  private isRecordingState = false;
  private isCancelled = false;
  private abortController: AbortController | null = null;
  private drainPromiseResolve: (() => void) | null = null;

  constructor(options: PcmStreamRecorderOptions) {
    this.sessionId = options.sessionId;
    this.targetSampleRate = options.targetSampleRate ?? 24000;
    this.chunkDurationMs = options.chunkDurationMs ?? 200;
    this.maxPendingChunks = options.maxPendingChunks ?? 15;
    this.onBackpressure = options.onBackpressure;
    this.onAudioLoss = options.onAudioLoss;
    this.onError = options.onError;
    this.onChunkSent = options.onChunkSent;
    this.fetchFn = options.fetchFn ?? fetch.bind(window);
  }

  isRecording(): boolean {
    return this.isRecordingState;
  }

  isIncomplete(): boolean {
    return this.isTurnIncomplete;
  }

  hasLostAudio(): boolean {
    return this.hasAudioLoss;
  }

  getPendingChunkCount(): number {
    return this.queue.length;
  }

  /**
   * Start live microphone streaming for a push-to-talk turn.
   */
  async start(stream: MediaStream, turnId: string): Promise<void> {
    this.cancel(); // Flush any prior turn state cleanly

    this.mediaStream = stream;
    this.currentTurnId = turnId;
    this.chunkIndex = 0;
    this.sampleBuffer = [];
    this.isRecordingState = true;
    this.isCancelled = false;
    this.abortController = new AbortController();

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    try {
      this.audioContext = new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const inputRate = this.audioContext.sampleRate;
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Attempt AudioWorklet first if supported; fall back to ScriptProcessorNode
      let workletReady = false;
      if (this.audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          const workletBlob = new Blob(
            [
              `class PcmCaptureProcessor extends AudioWorkletProcessor {
                process(inputs) {
                  const input = inputs[0];
                  if (input && input[0]) {
                    this.port.postMessage(input[0]);
                  }
                  return true;
                }
              }
              registerProcessor('pcm-capture-processor', PcmCaptureProcessor);`,
            ],
            { type: 'application/javascript' }
          );
          const workletUrl = URL.createObjectURL(workletBlob);
          await this.audioContext.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);

          const workletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture-processor');
          workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
            this.handleAudioFrame(e.data, inputRate);
          };
          this.sourceNode.connect(workletNode);
          // AudioWorkletNode must be connected to destination in some browsers to keep rendering alive
          const muteGain = this.audioContext.createGain();
          muteGain.gain.value = 0;
          workletNode.connect(muteGain);
          muteGain.connect(this.audioContext.destination);

          this.processorNode = workletNode;
          workletReady = true;
        } catch {
          workletReady = false;
        }
      }

      if (!workletReady) {
        // Fallback to ScriptProcessorNode
        const bufferSize = 4096;
        const scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
        scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
          if (!this.isRecordingState || this.isCancelled) return;
          const inputData = e.inputBuffer.getChannelData(0);
          this.handleAudioFrame(inputData, inputRate);
        };
        this.sourceNode.connect(scriptProcessor);
        scriptProcessor.connect(this.audioContext.destination);
        this.processorNode = scriptProcessor;
      }
    } catch (err) {
      this.cancel();
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError?.(error);
      throw error;
    }
  }

  /**
   * Process raw input samples from worklet or script processor.
   */
  private handleAudioFrame(inputSamples: Float32Array, inputRate: number): void {
    if (!this.isRecordingState || this.isCancelled) return;

    for (let i = 0; i < inputSamples.length; i++) {
      this.sampleBuffer.push(inputSamples[i]);
    }

    // Target sample count for a single chunk before resampling
    const targetInputSamplesPerChunk = Math.round((inputRate * this.chunkDurationMs) / 1000);

    if (this.sampleBuffer.length >= targetInputSamplesPerChunk) {
      const rawChunk = new Float32Array(this.sampleBuffer);
      this.sampleBuffer = [];

      const resampled = resampleFloat32(rawChunk, inputRate, this.targetSampleRate);
      const base64Chunk = float32ToBase64Pcm16(resampled);

      if (base64Chunk && this.currentTurnId) {
        this.enqueueChunk(base64Chunk, this.currentTurnId);
      }
    }
  }

  private stopCaptureOnly(): void {
    this.isRecordingState = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.disconnectAudioNodes();
  }

  /**
   * Enqueue a chunk for transmission and manage backpressure.
   */
  private enqueueChunk(base64: string, turnId: string): void {
    if (this.isCancelled || this.hasAudioLoss) return;

    // Enforce bounded queue size: if queue is full, mark turn incomplete and halt capture
    if (this.queue.length >= this.maxPendingChunks) {
      this.hasAudioLoss = true;
      this.isTurnIncomplete = true;
      const err = new Error(
        'Audio transmission queue overflow: audio frames lost due to network lag. Turn marked incomplete.'
      );
      this.onBackpressure?.(1);
      this.onAudioLoss?.(err);
      this.onError?.(err);
      this.stopCaptureOnly();
      return;
    }

    this.queue.push({
      base64,
      turnId,
      index: this.chunkIndex++,
      sequenceNumber: this.sequenceNumber++,
    });

    void this.processQueue();
  }

  /**
   * Sequentially transmit queued chunks to ensure in-order delivery.
   */
  private async processQueue(): Promise<void> {
    if (this.isSending || this.isCancelled) return;
    this.isSending = true;

    try {
      while (this.queue.length > 0 && !this.isCancelled && !this.hasAudioLoss) {
        const item = this.queue[0];
        try {
          const res = await this.fetchFn(`/api/v1/voice/sessions/${this.sessionId}/audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audio: item.base64,
              commit: false,
              turnId: item.turnId,
              sequenceNumber: item.sequenceNumber,
            }),
            signal: this.abortController?.signal,
          });

          if (!res.ok) {
            throw new Error(`Audio chunk failed with status ${res.status}`);
          }

          // Successfully delivered, remove from queue
          this.queue.shift();
          this.onChunkSent?.(item.index, item.sequenceNumber);
        } catch (err) {
          if (this.isCancelled || (err instanceof DOMException && err.name === 'AbortError')) {
            break;
          }
          // On delivery failure, audio is lost: mark turn incomplete and halt
          this.hasAudioLoss = true;
          this.isTurnIncomplete = true;
          this.queue = [];
          this.stopCaptureOnly();
          const error = err instanceof Error ? err : new Error(String(err));
          this.onAudioLoss?.(error);
          this.onError?.(error);
          break;
        }
      }
    } finally {
      this.isSending = false;
      if (this.queue.length === 0 && this.drainPromiseResolve) {
        this.drainPromiseResolve();
        this.drainPromiseResolve = null;
      }
    }
  }

  /**
   * Stop recording on push-to-talk release, drain pending chunks, and commit the turn.
   */
  async stop(): Promise<{ committed: boolean; error?: string }> {
    if (!this.isRecordingState && !this.isTurnIncomplete) {
      return { committed: false, error: 'Not recording' };
    }
    const inputRate = this.audioContext?.sampleRate;
    this.stopCaptureOnly();

    // Never commit an incomplete turn if audio loss occurred
    if (this.hasAudioLoss || this.isTurnIncomplete) {
      this.queue = [];
      const errMsg =
        'Turn incomplete: audio loss occurred during transmission. Discarding without committing.';
      this.onError?.(new Error(errMsg));
      return { committed: false, error: errMsg };
    }

    // Flush any remaining samples in the buffer
    if (this.sampleBuffer.length > 0 && inputRate && this.currentTurnId && !this.isCancelled) {
      const rawChunk = new Float32Array(this.sampleBuffer);
      this.sampleBuffer = [];
      const resampled = resampleFloat32(rawChunk, inputRate, this.targetSampleRate);
      const base64Chunk = float32ToBase64Pcm16(resampled);
      if (base64Chunk) {
        this.enqueueChunk(base64Chunk, this.currentTurnId);
      }
    }

    if (this.chunkIndex === 0) {
      return {
        committed: false,
        error:
          'No microphone audio was captured. Hold the microphone button while speaking, then release it.',
      };
    }

    // Drain all pending chunks in the queue
    if (this.queue.length > 0 || this.isSending) {
      await new Promise<void>((resolve) => {
        this.drainPromiseResolve = resolve;
        void this.processQueue();
        // Safety timeout of 5 seconds for drain
        setTimeout(() => {
          if (this.drainPromiseResolve) {
            this.drainPromiseResolve();
            this.drainPromiseResolve = null;
          }
        }, 5000);
      });
    }

    // Re-check audio loss after draining
    if (this.hasAudioLoss || this.isTurnIncomplete || this.isCancelled) {
      return { committed: false, error: 'Turn incomplete or cancelled during chunk drain' };
    }

    // Commit turn only after all pending chunks have been acknowledged
    if (this.currentTurnId) {
      try {
        const res = await this.fetchFn(`/api/v1/voice/sessions/${this.sessionId}/audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commit: true,
            turnId: this.currentTurnId,
          }),
          signal: this.abortController?.signal,
        });
        if (!res.ok) {
          throw new Error(`Commit failed with status ${res.status}`);
        }
        return { committed: true };
      } catch (err) {
        if (!this.isCancelled) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.onError?.(error);
          return { committed: false, error: error.message };
        }
      } finally {
        this.currentTurnId = null;
      }
    }

    return { committed: false };
  }

  /**
   * Cancel capture immediately, abort in-flight requests, and purge queued chunks.
   */
  cancel(): void {
    this.isCancelled = true;
    this.isRecordingState = false;
    this.hasAudioLoss = false;
    this.isTurnIncomplete = false;
    this.currentTurnId = null;
    this.sampleBuffer = [];
    this.queue = [];

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.drainPromiseResolve) {
      this.drainPromiseResolve();
      this.drainPromiseResolve = null;
    }

    this.stopCaptureOnly();
  }

  private disconnectAudioNodes(): void {
    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.processorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }
  }

  /**
   * Dispose all resources permanently.
   */
  dispose(): void {
    this.cancel();
  }
}
