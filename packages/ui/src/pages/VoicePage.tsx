import React, { useState } from 'react';
import { Mic, MicOff, Settings, Activity, Square, Play } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { VoiceSession } from '@ownpilot/core/voice';

export function VoicePage() {
  const toast = useToast();
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [_isRecording, setIsRecording] = useState(false);
  const [toolName, setToolName] = useState('search_docs');

  const startSession = async () => {
    try {
      const res = await fetch('/api/v1/voice/sessions', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSession(data);
        toast.success('Voice session started');
      }
    } catch {
      toast.error('Failed to start session');
    }
  };

  const endSession = () => {
    if (session) {
      setSession({ ...session, status: 'disconnected', endedAt: new Date().toISOString() });
      toast.info('Session ended');
    }
  };

  const toggleRecording = () => {
    setIsRecording((r) => !r);
    // In a real implementation this would trigger WebRTC/AudioContext
  };

  const simulateToolCall = async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/v1/voice/sessions/${session.id}/tool_call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, toolArgs: { query: 'test' } }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.allowed) {
          toast.success(`Tool ${toolName} executed by voice`);
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
              Realtime speech-to-speech interaction and voice-triggered actions.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 flex flex-col items-center justify-center">
        {!session || session.status === 'disconnected' ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-24 h-24 rounded-full bg-bg-secondary border-2 border-border flex items-center justify-center mb-2">
              <MicOff className="w-10 h-10 text-text-muted" />
            </div>
            <h3 className="text-xl font-medium">Ready to talk?</h3>
            <p className="text-text-muted max-w-md">
              Start a new voice session to interact with LEO using realtime speech.
            </p>
            <button
              onClick={startSession}
              className="mt-4 flex items-center gap-2 bg-accent text-white px-6 py-3 rounded-full font-medium hover:opacity-90 transition-opacity"
            >
              <Play className="w-5 h-5" /> Start Voice Session
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
            <div className="flex items-center justify-between w-full p-4 border border-border rounded-lg bg-bg-secondary">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-accent animate-pulse" />
                <div>
                  <div className="font-medium">Session Active</div>
                  <div className="text-xs text-text-muted">ID: {session.id}</div>
                </div>
              </div>
              <button
                onClick={endSession}
                className="flex items-center gap-1 bg-red-500/10 text-red-500 px-3 py-1.5 rounded hover:bg-red-500/20"
              >
                <Square className="w-4 h-4" /> End Session
              </button>
            </div>

            <div className="w-48 h-48 rounded-full border-4 border-accent flex items-center justify-center relative shadow-[0_0_30px_rgba(var(--color-accent-rgb),0.3)]">
              <button
                onMouseDown={toggleRecording}
                onMouseUp={toggleRecording}
                onMouseLeave={() => setIsRecording(false)}
                className="w-32 h-32 rounded-full bg-accent text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
              >
                <Mic className="w-12 h-12" />
              </button>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium mb-1">Push and hold to talk</p>
              <p className="text-xs text-text-muted">
                The transcript will appear here once you speak.
              </p>
            </div>

            <div className="w-full mt-8 p-4 border border-border rounded-lg bg-bg-secondary">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Settings className="w-4 h-4" /> Simulate Voice Action
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  className="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm"
                  placeholder="Tool Name (e.g. read_file)"
                />
                <button
                  onClick={simulateToolCall}
                  className="bg-bg-tertiary border border-border px-4 py-2 rounded text-sm hover:bg-bg-primary"
                >
                  Trigger
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
