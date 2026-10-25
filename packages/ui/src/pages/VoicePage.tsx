import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Settings,
  Activity,
  Square,
  Play,
  XCircle,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { VoiceSession, VoiceSessionStatus, VoiceMessage } from '../types/leo';
import { Pcm16Player } from '../utils/pcm-player';
import { PcmStreamRecorder } from '../utils/pcm-recorder';
import { STORAGE_KEYS } from '../constants/storage-keys';

type SpeechOutput = 'local' | 'local-gradium';

function readSpeechOutput(): SpeechOutput {
  try {
    return localStorage.getItem(STORAGE_KEYS.VOICE_SPEECH_OUTPUT) === 'local-gradium'
      ? 'local-gradium'
      : 'local';
  } catch {
    return 'local';
  }
}

interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

export function VoicePage() {
  const toast = useToast();
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [status, setStatus] = useState<VoiceSessionStatus>('disconnected');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [streamingDelta, setStreamingDelta] = useState<string>('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [toolName, setToolName] = useState('search_docs');
  const [isPressing, setIsPressing] = useState(false);
  const [speechOutput, setSpeechOutput] = useState<SpeechOutput>(readSpeechOutput);

  const chooseSpeechOutput = (value: SpeechOutput) => {
    setSpeechOutput(value);
    try {
      localStorage.setItem(STORAGE_KEYS.VOICE_SPEECH_OUTPUT, value);
    } catch {
      // Preference only; the selection still applies to this page.
    }
  };

  const isPressingRef = useRef(false);
  const isStartingRef = useRef(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const pcmPlayerRef = useRef<Pcm16Player | null>(null);
  const pcmRecorderRef = useRef<PcmStreamRecorder | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);

  // Dedicated Web Audio player for assistant PCM16 audio playback
  useEffect(() => {
    const player = new Pcm16Player({
      sampleRate: 24000,
      onStateChange: (playbackState) => {
        if (playbackState === 'playing') {
          setStatus((prev) => (prev === 'connected' || prev === 'processing' ? 'speaking' : prev));
        } else if (playbackState === 'idle') {
          setStatus((prev) => (prev === 'speaking' ? 'connected' : prev));
        }
      },
    });
    pcmPlayerRef.current = player;

    return () => {
      player.dispose();
      pcmPlayerRef.current = null;
      if (pcmRecorderRef.current) {
        pcmRecorderRef.current.dispose();
        pcmRecorderRef.current = null;
      }
    };
  }, []);

  // Auto-scroll transcript container
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, streamingDelta]);

  // Connect to SSE stream when session is active
  useEffect(() => {
    if (!session || session.status === 'disconnected') {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      pcmPlayerRef.current?.flush();
      return;
    }

    const sse = new EventSource(`/api/v1/voice/sessions/${session.id}/events`);
    eventSourceRef.current = sse;

    sse.addEventListener('status_change', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setStatus(data.status);
        if (
          data.status === 'listening' ||
          data.status === 'disconnected' ||
          data.status === 'error'
        ) {
          pcmPlayerRef.current?.flush();
        }
      } catch {
        // Ignore JSON error
      }
    });

    sse.addEventListener('audio_delta', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const event = data.event;
        if (event && event.delta) {
          pcmPlayerRef.current?.enqueue(event.delta, event.responseId);
        }
      } catch {
        // Ignore JSON error
      }
    });

    sse.addEventListener('transcript', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const event = data.event;
        if (event) {
          if (!event.isFinal && event.delta) {
            setStreamingDelta((prev) => prev + event.delta);
          } else if (event.isFinal) {
            setStreamingDelta('');
            setTranscripts((prev) => [
              ...prev,
              {
                id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: event.role,
                text: event.text,
              },
            ]);
          }
        }
      } catch {
        // Ignore JSON error
      }
    });

    sse.addEventListener('message', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const msg = data.message as VoiceMessage;
        if (msg && msg.text) {
          const text = msg.text;
          setTranscripts((prev) => {
            // Avoid duplicate message if transcript was already added
            if (prev.some((p) => p.text === text)) return prev;
            return [
              ...prev,
              {
                id: msg.id,
                role: msg.role === 'user' ? 'user' : 'assistant',
                text,
              },
            ];
          });
        }
      } catch {
        // Ignore JSON error
      }
    });

    sse.addEventListener('error', (e) => {
      // Native transport errors have no data and reconnect automatically.
      if (!(e instanceof MessageEvent)) return;
      try {
        const data = JSON.parse(e.data);
        const message = data.error || 'Voice provider error';
        setPermissionError(message);
        setStatus('error');
        pcmPlayerRef.current?.flush();
        toast.error(message);
      } catch {
        // Ignore malformed server events.
      }
    });

    return () => {
      sse.close();
      eventSourceRef.current = null;
      pcmPlayerRef.current?.flush();
    };
  }, [session]);

  const startSession = async () => {
    setPermissionError(null);
    try {
      // Resume or initialize Web Audio context during user gesture
      void pcmPlayerRef.current?.initOrResume();

      // Request mic permission up-front
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Close initial test stream
        stream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        const isNotAllowed = err instanceof DOMException && err.name === 'NotAllowedError';
        const errorMsg = isNotAllowed
          ? 'Microphone access was denied. Please allow microphone permissions in your browser.'
          : 'Unable to access microphone. Please check your audio input device.';
        setPermissionError(errorMsg);
        setStatus('error');
        toast.error(errorMsg);
        return;
      }

      // Both choices keep Whisper and Ollama local; 'local-gradium' only sends the
      // reply text to Gradium for speech. `/voice/status` reports the separate
      // TTS/STT config type and must not choose the session provider.
      const targetProvider = speechOutput;

      const res = await fetch('/api/v1/voice/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'push-to-talk', provider: targetProvider }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Failed to create voice session');
      }

      const resJson = await res.json();
      const newSession: VoiceSession = resJson.data || resJson;

      // Connect session provider
      const connRes = await fetch(`/api/v1/voice/sessions/${newSession.id}/connect`, {
        method: 'POST',
      });

      if (!connRes.ok) {
        const connErrJson = await connRes.json().catch(() => null);
        throw new Error(connErrJson?.error?.message || 'Failed to connect voice provider');
      }

      const connJson = await connRes.json();
      const connectedSession: VoiceSession = connJson.data || connJson;
      setSession(connectedSession);
      setStatus('connected');
      setTranscripts([]);
      toast.success('Voice session connected');
    } catch (err) {
      setStatus('error');
      toast.error(err instanceof Error ? err.message : 'Failed to start session');
    }
  };

  const endSession = async () => {
    pcmPlayerRef.current?.flush();
    if (pcmRecorderRef.current) {
      pcmRecorderRef.current.cancel();
      pcmRecorderRef.current = null;
    }
    currentTurnIdRef.current = null;
    setIsPressing(false);

    if (!session) return;
    try {
      await fetch(`/api/v1/voice/sessions/${session.id}/disconnect`, { method: 'POST' });
    } catch {
      // Best-effort disconnect
    }
    setStatus('disconnected');
    setSession((s) => (s ? { ...s, status: 'disconnected' } : null));
    toast.info('Voice session ended');
  };

  const cancelActiveTurn = async () => {
    pcmPlayerRef.current?.flush();
    if (pcmRecorderRef.current) {
      pcmRecorderRef.current.cancel();
      pcmRecorderRef.current = null;
    }
    currentTurnIdRef.current = null;
    setIsPressing(false);

    if (!session) return;
    try {
      const res = await fetch(`/api/v1/voice/sessions/${session.id}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setStreamingDelta('');
        setStatus('connected');
        if (data.cancelled) {
          toast.info('Interaction cancelled');
        } else {
          toast.warning(data.message || 'Action had already finished');
        }
      }
    } catch {
      toast.error('Failed to cancel interaction');
    }
  };

  const startRecording = useCallback(async () => {
    if (!session || status === 'disconnected' || isPressing || isStartingRef.current) return;
    isStartingRef.current = true;
    isPressingRef.current = true;
    setPermissionError(null);

    // Resume AudioContext on user gesture and flush any stale playing speech
    void pcmPlayerRef.current?.initOrResume();
    pcmPlayerRef.current?.flush();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Rapid tap guard: if user released while getUserMedia was resolving, release stream immediately
      if (!isPressingRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Device disconnection listener
      const audioTrack = stream.getAudioTracks ? stream.getAudioTracks()[0] : stream.getTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (pcmRecorderRef.current) {
            pcmRecorderRef.current.cancel();
            pcmRecorderRef.current = null;
          }
          setIsPressing(false);
          isPressingRef.current = false;
          setStatus('connected');
          toast.warning('Microphone was disconnected.');
        };
      }

      const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      currentTurnIdRef.current = turnId;

      const recorder = new PcmStreamRecorder({
        sessionId: session.id,
        targetSampleRate: 24000,
        chunkDurationMs: 200,
        onAudioLoss: (err) => {
          setIsPressing(false);
          isPressingRef.current = false;
          setStatus('connected');
          toast.warning(err.message || 'Audio input interrupted. Turn discarded.');
        },
        onError: (err) => {
          toast.error(err.message || 'Microphone streaming error');
        },
      });
      pcmRecorderRef.current = recorder;

      await recorder.start(stream, turnId);
      setIsPressing(true);
      setStatus('listening');
    } catch (err) {
      setIsPressing(false);
      isPressingRef.current = false;
      const errorMsg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied. Grant permissions in browser settings.'
          : err instanceof Error
            ? err.message
            : 'Could not start audio recording.';
      setPermissionError(errorMsg);
      setStatus('error');
      toast.error(errorMsg);
    } finally {
      isStartingRef.current = false;
    }
  }, [session, status, isPressing, toast]);

  const stopRecording = useCallback(async () => {
    isPressingRef.current = false;
    if (!isPressing) return;
    setIsPressing(false);

    const recorder = pcmRecorderRef.current;
    if (!recorder || !session) return;
    pcmRecorderRef.current = null;
    currentTurnIdRef.current = null;
    setStatus('processing');

    try {
      const res = await recorder.stop();
      if (!res.committed && res.error) {
        setPermissionError(res.error);
        toast.warning(res.error);
        setStatus('connected');
      }
    } catch {
      toast.error('Failed to commit voice audio');
      setStatus('connected');
    }
  }, [isPressing, session, toast]);

  // Keyboard accessibility: hold Space bar to talk when focused
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.code === 'Space' && !e.repeat && !isPressing && session && status === 'connected') {
      e.preventDefault();
      startRecording();
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.code === 'Space' && isPressing) {
      e.preventDefault();
      stopRecording();
    }
  };

  const simulateToolCall = async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/v1/voice/sessions/${session.id}/tool_call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCallId: `call_${Date.now()}`,
          toolName,
          toolArgs: { query: 'voice test' },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.allowed) {
          toast.success(`Tool ${toolName} executed by voice`);
        } else if (data.approvalRequired) {
          toast.warning(`Tool ${toolName} requires user approval`);
        } else {
          toast.error(`Tool ${toolName} denied: ${data.error}`);
        }
      }
    } catch {
      toast.error('Tool execution failed');
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <Mic className="w-5 h-5 text-accent" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Voice Interface
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Realtime speech interaction with Push-to-Talk and tool safety boundaries.
            </p>
          </div>
        </div>
        {session && status !== 'disconnected' && (
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                status === 'listening'
                  ? 'bg-red-500/20 text-red-500'
                  : status === 'speaking'
                    ? 'bg-blue-500/20 text-blue-500'
                    : status === 'processing'
                      ? 'bg-amber-500/20 text-amber-500'
                      : status === 'error'
                        ? 'bg-red-700/20 text-red-700'
                        : 'bg-green-500/20 text-green-500'
              }`}
            >
              {status.toUpperCase()}
            </span>
            <button
              onClick={endSession}
              className="flex items-center gap-1 bg-red-500/10 text-red-500 px-3 py-1.5 rounded text-sm hover:bg-red-500/20"
            >
              <Square className="w-4 h-4" /> End Session
            </button>
          </div>
        )}
      </header>

      {permissionError && (
        <div className="m-4 p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-lg flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{permissionError}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center">
        {!session || status === 'disconnected' ? (
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <div className="w-24 h-24 rounded-full bg-bg-secondary border-2 border-border flex items-center justify-center mb-2">
              <MicOff className="w-10 h-10 text-text-muted" />
            </div>
            <h3 className="text-xl font-medium">Ready to talk?</h3>
            <p className="text-text-muted">
              Start a new voice session to interact with LEO using realtime speech.
            </p>
            <label className="flex flex-col gap-1 text-sm text-left w-full">
              <span className="text-text-muted">Speech output</span>
              <select
                value={speechOutput}
                onChange={(e) => chooseSpeechOutput(e.target.value as SpeechOutput)}
                className="bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary border border-border dark:border-dark-border rounded px-3 py-2"
              >
                <option value="local">Windows speech (offline)</option>
                <option value="local-gradium">
                  Gradium voice clone (sends reply text to Gradium)
                </option>
              </select>
            </label>
            <button
              onClick={startSession}
              className="mt-4 flex items-center gap-2 bg-accent text-white px-6 py-3 rounded-full font-medium hover:opacity-90 transition-opacity shadow-md"
            >
              <Play className="w-5 h-5" /> Start Voice Session
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 w-full max-w-2xl h-full">
            {/* Session Info Bar */}
            <div className="flex items-center justify-between w-full p-3 border border-border rounded-lg bg-bg-secondary">
              <div className="flex items-center gap-3">
                <Activity
                  className={`w-5 h-5 ${
                    status === 'listening'
                      ? 'text-red-500 animate-bounce'
                      : status === 'speaking'
                        ? 'text-blue-500 animate-pulse'
                        : 'text-accent'
                  }`}
                />
                <div>
                  <div className="text-sm font-medium">
                    Session: <span className="font-mono text-xs">{session.id}</span>
                  </div>
                  <div className="text-xs text-text-muted">
                    Mode: Push-to-Talk | State: {status}
                  </div>
                </div>
              </div>

              {(status === 'listening' || status === 'processing' || status === 'speaking') && (
                <button
                  onClick={cancelActiveTurn}
                  className="flex items-center gap-1.5 bg-amber-500/10 text-amber-500 px-3 py-1 rounded text-xs font-medium hover:bg-amber-500/20"
                  aria-label="Cancel active interaction"
                >
                  <XCircle className="w-3.5 h-3.5" /> Cancel Turn
                </button>
              )}
            </div>

            {/* Live Transcripts Box */}
            <div className="w-full flex-1 min-h-[220px] max-h-[340px] border border-border rounded-lg bg-bg-secondary p-4 overflow-y-auto flex flex-col gap-3">
              {transcripts.length === 0 && !streamingDelta && (
                <div className="text-center text-text-muted my-auto text-sm">
                  Transcripts and spoken responses will stream here in real-time.
                </div>
              )}

              {transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`flex flex-col max-w-[80%] rounded-lg p-3 text-sm ${
                    t.role === 'user'
                      ? 'self-end bg-accent text-white rounded-br-none'
                      : 'self-start bg-bg-tertiary border border-border rounded-bl-none text-text-primary'
                  }`}
                >
                  <span className="text-[10px] opacity-75 font-semibold mb-1 uppercase tracking-wider">
                    {t.role === 'user' ? 'You' : 'LEO'}
                  </span>
                  <span>{t.text}</span>
                </div>
              ))}

              {streamingDelta && (
                <div className="self-start bg-bg-tertiary border border-border rounded-lg rounded-bl-none p-3 text-sm text-text-primary flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-accent animate-pulse" />
                  <span>{streamingDelta}</span>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Push-to-Talk Circular Button */}
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-40 h-40 rounded-full border-4 flex items-center justify-center transition-all ${
                  isPressing || status === 'listening'
                    ? 'border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.5)] scale-105'
                    : status === 'speaking'
                      ? 'border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.4)]'
                      : 'border-accent shadow-[0_0_20px_rgba(var(--color-accent-rgb),0.2)]'
                }`}
              >
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  tabIndex={0}
                  role="button"
                  aria-label="Push and hold to speak"
                  aria-pressed={isPressing}
                  className={`w-28 h-28 rounded-full flex flex-col items-center justify-center text-white transition-all select-none ${
                    isPressing || status === 'listening'
                      ? 'bg-red-500 scale-95'
                      : status === 'speaking'
                        ? 'bg-blue-500 animate-pulse'
                        : 'bg-accent hover:opacity-95'
                  }`}
                >
                  <Mic className="w-10 h-10 mb-1" />
                  <span className="text-[11px] font-medium uppercase tracking-wider">
                    {isPressing ? 'Release' : 'Hold'}
                  </span>
                </button>
              </div>

              <div className="text-center">
                <p className="text-sm font-medium">
                  {status === 'listening'
                    ? 'Listening... Release to process'
                    : status === 'processing'
                      ? 'Processing voice input...'
                      : status === 'speaking'
                        ? 'LEO is speaking...'
                        : 'Push and hold to talk (or hold Spacebar)'}
                </p>
                <p className="text-xs text-text-muted">
                  Audio is processed safely server-side with strict authorization boundaries.
                </p>
              </div>
            </div>

            {/* Tool Simulation Test Box */}
            <div className="w-full p-4 border border-border rounded-lg bg-bg-secondary mt-auto">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2 flex items-center gap-2">
                <Settings className="w-3.5 h-3.5" /> Voice Tool Invocation
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm"
                  placeholder="Tool Name (e.g. search_docs)"
                />
                <button
                  onClick={simulateToolCall}
                  className="bg-bg-tertiary border border-border px-4 py-1.5 rounded text-sm hover:bg-bg-primary font-medium"
                >
                  Execute Tool
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
