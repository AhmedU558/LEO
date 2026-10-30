/**
 * Voice session lifecycle shared by the Voice page and the LEO console.
 *
 * Owns the gateway voice session (create/connect/disconnect), its SSE event
 * stream, push-to-talk capture (PcmStreamRecorder) and assistant playback
 * (Pcm16Player), plus the persisted speech-output choice.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '../components/ToastProvider';
import type { VoiceSession, VoiceSessionStatus, VoiceMessage } from '../types/leo';
import { Pcm16Player } from '../utils/pcm-player';
import { PcmStreamRecorder } from '../utils/pcm-recorder';
import { STORAGE_KEYS } from '../constants/storage-keys';

export type SpeechOutput = 'local' | 'local-gradium';

export interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

function readSpeechOutput(): SpeechOutput {
  try {
    return localStorage.getItem(STORAGE_KEYS.VOICE_SPEECH_OUTPUT) === 'local-gradium'
      ? 'local-gradium'
      : 'local';
  } catch {
    return 'local';
  }
}

export function useVoiceSession() {
  const toast = useToast();
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [status, setStatus] = useState<VoiceSessionStatus>('disconnected');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [streamingDelta, setStreamingDelta] = useState<string>('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isPressing, setIsPressing] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
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
    setMicStream(null);

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
    setMicStream(null);

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
          setMicStream(null);
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
          setMicStream(null);
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
      setMicStream(stream);
      setStatus('listening');
    } catch (err) {
      setIsPressing(false);
      setMicStream(null);
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
    setMicStream(null);

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

  /** Typed turn: LEO answers and speaks it like a spoken one. */
  const sendText = useCallback(
    async (text: string) => {
      if (!session || !text.trim()) return;
      // Submitting is a user gesture, so audio can start; drop any stale speech.
      void pcmPlayerRef.current?.initOrResume();
      pcmPlayerRef.current?.flush();
      setStatus('processing');
      try {
        const res = await fetch(`/api/v1/voice/sessions/${session.id}/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('LEO could not receive that message.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'LEO could not receive that message.');
        setStatus('connected');
      }
    },
    [session, toast]
  );

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

  /** Live analyser on LEO's speech output, or null before audio is initialised. */
  const getOutputAnalyser = useCallback(() => pcmPlayerRef.current?.getAnalyser() ?? null, []);

  return {
    session,
    status,
    transcripts,
    streamingDelta,
    permissionError,
    isPressing,
    micStream,
    speechOutput,
    chooseSpeechOutput,
    startSession,
    endSession,
    cancelActiveTurn,
    startRecording,
    stopRecording,
    sendText,
    handleKeyDown,
    handleKeyUp,
    getOutputAnalyser,
  };
}
