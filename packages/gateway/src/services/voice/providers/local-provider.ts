import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  VoiceProvider,
  VoiceProviderEvents,
  VoiceProviderOptions,
  VoiceSessionStatus,
} from '@ownpilot/core/voice';

const MODEL = 'qwen3:4b-instruct';
const OLLAMA = 'http://127.0.0.1:11434';
const WHISPER = `
import base64, io, sys, wave
from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cpu', compute_type='int8', local_files_only=True)
audio = sys.stdin.read().strip()
if audio:
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(base64.b64decode(audio, validate=True))
    stream.seek(0)
    segments, _ = model.transcribe(stream, beam_size=1, vad_filter=True)
    print(' '.join(segment.text.strip() for segment in segments))
else:
    print('ready')
`;
const SPEAK = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$leoText = [Console]::In.ReadToEnd()
$leoSynth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$leoStream = [IO.MemoryStream]::new()
try {
  if ($leoSynth.GetInstalledVoices().Count -eq 0) { throw 'No Windows speech voice installed' }
  if ([String]::IsNullOrWhiteSpace($leoText)) { return }
  $leoFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $leoSynth.SetOutputToAudioStream($leoStream, $leoFormat)
  $leoSynth.Speak($leoText)
  $leoSynth.SetOutputToNull()
  [Console]::Out.Write([Convert]::ToBase64String($leoStream.ToArray()))
} finally {
  $leoSynth.Dispose()
  $leoStream.Dispose()
}
`;

/** Offline Whisper + Ollama + Windows speech; never falls back to a paid provider. */
export class LocalVoiceProvider implements VoiceProvider {
  readonly name = 'local';
  private events: VoiceProviderEvents = {};
  private status: VoiceSessionStatus = 'disconnected';
  private audio: Buffer[] = [];
  private audioBytes = 0;
  private request: AbortController | null = null;
  private history: Array<{ role: string; content: string }> = [];

  getStatus(): VoiceSessionStatus {
    return this.status;
  }

  private setStatus(status: VoiceSessionStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  private runProcess(
    command: string,
    args: string[],
    input: string,
    signal: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        command,
        args,
        {
          windowsHide: true,
          timeout: 25_000,
          maxBuffer: 12 * 1024 * 1024,
          signal,
        },
        (error, stdout) => {
          if (error)
            reject(
              new Error(
                `Local speech failed (${command}). Check the installed voice and cached Whisper model.`
              )
            );
          else resolve(stdout.trim());
        }
      );
      child.stdin?.on('error', () => {}); // execFile reports early process exits above.
      child.stdin?.end(input);
    });
  }

  async connect(events: VoiceProviderEvents, options?: VoiceProviderOptions): Promise<void> {
    if (process.platform !== 'win32')
      throw new Error('Local voice currently requires Windows speech.');
    this.events = events;
    this.setStatus('connecting');
    const request = new AbortController();
    this.request = request;
    try {
      const response = await fetch(`${OLLAMA}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error(`Start Ollama and install the local ${MODEL} model.`);
      // shortcut: reload tiny Whisper per turn; use a persistent worker if startup latency becomes noticeable.
      await this.runProcess('python', ['-c', WHISPER], '', request.signal);
      await this.runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SPEAK],
        '',
        request.signal
      );
      request.signal.throwIfAborted();
      this.history = [
        {
          role: 'system',
          content:
            options?.instructions ||
            'You are LEO, a helpful voice assistant. Give brief, conversational replies.',
        },
      ];
      this.setStatus('connected');
    } catch (error) {
      if (!request.signal.aborted) this.fail(error);
      throw error;
    }
  }

  private fail(error: unknown): void {
    this.setStatus('error');
    this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  sendAudio(base64Audio: string): void {
    if (this.status === 'disconnected' || this.status === 'error' || this.status === 'connecting')
      return;
    const chunk = Buffer.from(base64Audio, 'base64');
    if (!this.audioBytes) this.request?.abort();
    if (this.audioBytes + chunk.length > 24000 * 2 * 120) {
      this.audio = [];
      this.audioBytes = 0;
      this.fail(new Error('Local voice recordings are limited to two minutes per turn.'));
      return;
    }
    this.audio.push(chunk);
    this.audioBytes += chunk.length;
    this.setStatus('listening');
  }

  commitAudio(): void {
    if (!this.audioBytes) return;
    const audio = Buffer.concat(this.audio);
    this.audio = [];
    this.audioBytes = 0;
    void this.respond(audio);
  }

  sendText(text: string): void {
    if (this.status === 'disconnected' || this.status === 'connecting' || this.status === 'error')
      return;
    void this.respond(text);
  }

  sendToolResult(toolCallId: string, result: unknown): void {
    this.sendText(`Result of tool ${toolCallId}: ${JSON.stringify(result)}`);
  }

  private async respond(input: Buffer | string): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.setStatus('processing');
    try {
      const text =
        typeof input === 'string'
          ? input
          : await this.runProcess(
              'python',
              ['-c', WHISPER],
              input.toString('base64'),
              request.signal
            );
      request.signal.throwIfAborted();
      if (!text.trim()) {
        this.events.onError?.(
          new Error(
            'No speech was detected. Check that your microphone is selected and speak clearly while holding the microphone button.'
          )
        );
        this.setStatus('connected');
        return;
      }
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      this.events.onTranscript?.({ sessionId: id, role: 'user', text, isFinal: true, timestamp });
      this.events.onMessage?.({ id: `${id}_user`, role: 'user', type: 'text', text, timestamp });
      this.history.push({ role: 'user', content: text });
      const response = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: this.history,
          stream: false,
          options: { num_predict: 160 },
        }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(40_000)]),
      });
      const body = await response.json();
      request.signal.throwIfAborted();
      if (!response.ok || body.error) throw new Error(body.error || 'Local AI request failed.');
      const reply = body.message?.content;
      if (typeof reply !== 'string' || !reply.trim())
        throw new Error('Local AI returned an empty reply.');
      this.history.push({ role: 'assistant', content: reply });
      // Bound the local context while retaining the system instruction.
      if (this.history.length > 13) this.history.splice(1, this.history.length - 13);
      const pcm = await this.runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SPEAK],
        reply,
        request.signal
      );
      request.signal.throwIfAborted();
      if (!pcm) throw new Error('Windows speech returned no audio.');
      this.setStatus('speaking');
      this.events.onTranscript?.({
        sessionId: id,
        role: 'assistant',
        text: reply,
        isFinal: true,
        timestamp: new Date().toISOString(),
      });
      this.events.onMessage?.({
        id,
        role: 'assistant',
        type: 'text',
        text: reply,
        timestamp: new Date().toISOString(),
      });
      const bytes = Buffer.from(pcm, 'base64');
      for (let offset = 0; offset < bytes.length; offset += 24000) {
        request.signal.throwIfAborted();
        this.events.onAudioDelta?.({
          sessionId: id,
          responseId: id,
          delta: bytes.subarray(offset, offset + 24000).toString('base64'),
          format: 'pcm16',
          sampleRate: 24000,
          channels: 1,
          timestamp: new Date().toISOString(),
        });
      }
      this.setStatus('connected');
    } catch (error) {
      if (!request.signal.aborted) this.fail(error);
    }
  }

  interrupt(): void {
    this.request?.abort();
    this.audio = [];
    this.audioBytes = 0;
    this.setStatus('connected');
  }

  disconnect(): void {
    this.request?.abort();
    this.audio = [];
    this.audioBytes = 0;
    this.history = [];
    this.setStatus('disconnected');
    this.events = {};
  }
}
