import { useState, useEffect, useRef } from 'react';
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
import { useVoiceSession, type SpeechOutput } from '../hooks/useVoiceSession';

export function VoicePage() {
  const toast = useToast();
  const {
    session,
    status,
    transcripts,
    streamingDelta,
    permissionError,
    isPressing,
    speechOutput,
    chooseSpeechOutput,
    startSession,
    endSession,
    cancelActiveTurn,
    startRecording,
    stopRecording,
    handleKeyDown,
    handleKeyUp,
  } = useVoiceSession();
  const [toolName, setToolName] = useState('search_docs');
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript container
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, streamingDelta]);

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
