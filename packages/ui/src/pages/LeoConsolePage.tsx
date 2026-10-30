/**
 * LEO Command Center — the JARVIS-style home page.
 *
 * Every panel reads real LEO data (health, host metrics, summary, agents,
 * providers, tasks, memory, workflow runs). The core orb is the push-to-talk
 * control, and "Hey Leo" starts a hands-free turn via local Whisper.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  CalendarDays,
  Cpu,
  Ear,
  ListChecks,
  MessageSquare,
  Play,
  Power,
  Radio,
  Send,
  Server,
  SlidersHorizontal,
  Sparkles,
  Wifi,
  WifiOff,
  Workflow,
  XCircle,
} from 'lucide-react';
import { useVoiceSession, type SpeechOutput } from '../hooks/useVoiceSession';
import { useWakeWord, useSilenceStop } from '../hooks/useWakeWord';
import { usePageData } from '../hooks/usePageData';
import { LeoOrb, orbStateFor, ORB_COLOR } from '../components/leo/LeoOrb';
import { VoiceWaveform } from '../components/leo/VoiceWaveform';
import { systemApi } from '../api/endpoints/misc';
import { summaryApi } from '../api/endpoints/summary';
import { agentsApi } from '../api/endpoints/agents';
import { providersApi } from '../api/endpoints/providers';
import { tasksApi } from '../api/endpoints/tasks';
import { memoriesApi } from '../api/endpoints/personal-data';
import { workflowsApi } from '../api/endpoints/workflows';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { CHAT_PATH } from '../constants/routes';

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

interface Health {
  status: string;
  checks: Array<{ name: string; status: string }>;
}

/** Public gateway health, refreshed every 30 s. */
function useGatewayHealth(): Health | null | 'unreachable' {
  const [health, setHealth] = useState<Health | null | 'unreachable'>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/health');
        const json = await res.json();
        if (!cancelled) setHealth(json.data ?? 'unreachable');
      } catch {
        if (!cancelled) setHealth('unreachable');
      }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return health;
}

type Metrics = Awaited<ReturnType<typeof systemApi.metrics>>;

function useHostMetrics(): Metrics | null {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      systemApi
        .metrics()
        .then((m) => !cancelled && setMetrics(m))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return metrics;
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function readWakePref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.WAKE_WORD) === '1';
  } catch {
    return false;
  }
}

/** Short rising chime when "Hey Leo" is heard. */
function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(990, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio output; the visual state change still shows the wake.
  }
}

// ---------------------------------------------------------------------------
// HUD primitives
// ---------------------------------------------------------------------------

function HudPanel({
  title,
  icon,
  action,
  className = '',
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`relative flex min-h-0 flex-col border border-sky-400/15 bg-[#06101c]/80 shadow-[0_0_24px_rgba(56,189,248,0.05)] ${className}`}
    >
      {/* Corner brackets */}
      <span
        aria-hidden
        className="absolute -left-px -top-px size-3 border-l-2 border-t-2 border-sky-400/70"
      />
      <span
        aria-hidden
        className="absolute -right-px -top-px size-3 border-r-2 border-t-2 border-sky-400/70"
      />
      <span
        aria-hidden
        className="absolute -bottom-px -left-px size-3 border-b-2 border-l-2 border-sky-400/70"
      />
      <span
        aria-hidden
        className="absolute -bottom-px -right-px size-3 border-b-2 border-r-2 border-sky-400/70"
      />
      <header className="flex items-center justify-between gap-2 border-b border-sky-400/10 px-4 py-2.5">
        <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-sky-300">
          {icon}
          {title}
        </h2>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  );
}

function Dot({ ok }: { ok: boolean | null }) {
  return (
    <span
      aria-hidden
      className={`size-1.5 shrink-0 rounded-full ${
        ok === null ? 'bg-slate-500' : ok ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-400'
      }`}
    />
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-xs text-slate-500">{children}</p>;
}

function Ring({ label, percent }: { label: string; percent: number | null }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const value = percent ?? 0;
  const color = value > 85 ? '#f87171' : value > 65 ? '#fbbf24' : '#38bdf8';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        viewBox="0 0 80 80"
        className="size-20"
        role="img"
        aria-label={`${label} ${percent ?? '—'}%`}
      >
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(56,189,248,0.12)" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          transform="rotate(-90 40 40)"
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dashoffset .6s' }}
        />
        <text x="40" y="45" textAnchor="middle" className="fill-slate-100 font-mono text-[15px]">
          {percent === null ? '—' : `${percent}%`}
        </text>
      </svg>
      <span className="font-mono text-[10px] uppercase tracking-widest text-slate-400">
        {label}
      </span>
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const HINT: Record<ReturnType<typeof orbStateFor>, string> = {
  offline: 'Press the core — or say "Hey Leo" — to bring LEO online.',
  idle: 'Hold the core or Space and speak.',
  listening: 'Listening…',
  thinking: 'Working on it…',
  speaking: 'Speaking. Hold the core to interrupt.',
  error: 'Something needs attention — see the message above.',
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'text-red-300',
  high: 'text-amber-300',
  normal: 'text-sky-300',
  low: 'text-slate-400',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LeoConsolePage() {
  const voice = useVoiceSession();
  const health = useGatewayHealth();
  const metrics = useHostMetrics();
  const now = useClock();
  const online = useOnline();

  const summary = usePageData(() => summaryApi.get(), []);
  const agents = usePageData(() => agentsApi.list(), []);
  const providers = usePageData(() => providersApi.list(), []);
  const tasks = usePageData(() => tasksApi.list({ status: ['pending', 'in_progress'] }), []);
  const memory = usePageData(() => memoriesApi.stats(), []);
  const runs = usePageData(() => workflowsApi.recentLogs({ limit: '4' }), []);

  const live = Boolean(voice.session) && voice.status !== 'disconnected';
  const orbState = live ? orbStateFor(voice.status) : 'offline';
  const busy =
    voice.status === 'listening' || voice.status === 'processing' || voice.status === 'speaking';
  const gatewayOk = health !== null && health !== 'unreachable' && health.status === 'healthy';

  // --- "Hey Leo" hands-free flow -------------------------------------------
  const [wakeEnabled, setWakeEnabled] = useState(readWakePref);
  const [handsFree, setHandsFree] = useState(false);
  // State, not a ref: when the session is already connected, a wake changes
  // nothing else the turn-start effect watches, so a ref never re-ran it and
  // only the first "Hey Leo" (which also started the session) worked.
  const [pendingTurn, setPendingTurn] = useState(false);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  });

  const toggleWake = () => {
    const next = !wakeEnabled;
    setWakeEnabled(next);
    try {
      localStorage.setItem(STORAGE_KEYS.WAKE_WORD, next ? '1' : '0');
    } catch {
      // Preference only.
    }
  };

  const onWake = useCallback(() => {
    chime();
    setPendingTurn(true);
    if (!liveRef.current) void voice.startSession();
  }, [voice]);

  const wake = useWakeWord({
    enabled: wakeEnabled,
    paused: (live && voice.status !== 'connected') || voice.isPressing,
    onWake,
  });

  // Start the hands-free turn once the session is ready.
  const { startRecording, stopRecording } = voice;
  useEffect(() => {
    if (pendingTurn && live && voice.status === 'connected' && !voice.isPressing) {
      setPendingTurn(false);
      setHandsFree(true);
      void startRecording();
    }
  }, [pendingTurn, live, voice.status, voice.isPressing, startRecording]);

  // --- Typed turns: LEO answers out loud, like a spoken turn ----------------
  const [typed, setTyped] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const { sendText } = voice;
  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    // Sent once the session is connected and idle (starting it if needed).
    setPendingText(text);
    if (!live) void voice.startSession();
  };
  useEffect(() => {
    if (pendingText && live && voice.status === 'connected' && !voice.isPressing) {
      setPendingText(null);
      void sendText(pendingText);
    }
  }, [pendingText, live, voice.status, voice.isPressing, sendText]);

  useSilenceStop(voice.micStream, handsFree, () => {
    setHandsFree(false);
    void stopRecording();
  });

  const pressCore = () => {
    if (!live) void voice.startSession();
    else void voice.startRecording();
  };

  // --- Derived panel data ---------------------------------------------------
  const providerList = providers.data?.providers ?? [];
  const connected = providerList.filter(
    (p) => 'isConfigured' in p && p.isConfigured && p.isEnabled
  );
  const timeline = [...(tasks.data ?? [])]
    .filter((t) => t.dueDate)
    .sort((a, b) =>
      `${a.dueDate}${a.dueTime ?? ''}`.localeCompare(`${b.dueDate}${b.dueTime ?? ''}`)
    )
    .slice(0, 5);

  const feed: Array<{ text: string; to: string; tone: 'warn' | 'info' | 'ok' }> = [];
  if (health === 'unreachable') feed.push({ text: 'Gateway unreachable', to: '/', tone: 'warn' });
  const s = summary.data;
  if (s?.tasks.overdue)
    feed.push({ text: `${s.tasks.overdue} tasks overdue`, to: '/tasks', tone: 'warn' });
  if (s?.tasks.dueToday)
    feed.push({ text: `${s.tasks.dueToday} tasks due today`, to: '/tasks', tone: 'info' });
  if (s?.calendar.today)
    feed.push({ text: `${s.calendar.today} events today`, to: '/calendar', tone: 'info' });
  if (s?.habits?.totalToday)
    feed.push({
      text: `Habits ${s.habits.completedToday}/${s.habits.totalToday} done today`,
      to: '/habits',
      tone: s.habits.completedToday === s.habits.totalToday ? 'ok' : 'info',
    });
  for (const log of runs.data?.logs ?? [])
    feed.push({
      text: `${log.workflowName ?? 'Workflow'} · ${log.status}`,
      to: '/workflows',
      tone: log.status === 'failed' ? 'warn' : 'ok',
    });

  const dbCheck =
    health && health !== 'unreachable' ? health.checks.find((c) => c.name === 'database') : null;
  const disk = metrics?.disk
    ? pct(metrics.disk.total - metrics.disk.free, metrics.disk.total)
    : null;

  const overview: Array<{ label: string; value: string; ok: boolean | null; to: string }> = [
    {
      label: 'AI Core',
      value: health === null ? 'Checking' : gatewayOk ? 'Online' : 'Degraded',
      ok: health === null ? null : gatewayOk,
      to: '/',
    },
    {
      label: 'Memory',
      value: memory.data ? `${memory.data.total} stored` : '—',
      ok: memory.data ? true : null,
      to: '/memories',
    },
    {
      label: 'Voice',
      value: live ? voice.status : wakeEnabled ? 'Wake word on' : 'Offline',
      ok: live ? voice.status !== 'error' : null,
      to: '/voice',
    },
    {
      label: 'Agents',
      value: agents.data ? `${agents.data.length} ready` : '—',
      ok: agents.data ? true : null,
      to: '/agents',
    },
    {
      label: 'LLMs',
      value: providers.data ? `${connected.length} connected` : '—',
      ok: providers.data ? connected.length > 0 : null,
      to: '/settings',
    },
    {
      label: 'System',
      value: dbCheck ? (dbCheck.status === 'pass' ? 'Optimal' : 'Check database') : '—',
      ok: dbCheck ? dbCheck.status === 'pass' : null,
      to: '/settings',
    },
  ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#03070d] text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(#38bdf8_1px,transparent_1px),linear-gradient(90deg,#38bdf8_1px,transparent_1px)] [background-size:44px_44px]"
      />

      {/* Top bar */}
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-sky-400/10 px-4 py-3 sm:px-6">
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-[0.35em] text-sky-200">LEO</h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400">
            Command Center
          </p>
        </div>
        <div className="flex items-center gap-3 rounded border border-sky-400/20 px-3 py-1.5 font-mono text-xs">
          <Dot ok={health === null ? null : gatewayOk} />
          <span className="uppercase tracking-widest text-slate-300">
            System {health === null ? 'checking' : gatewayOk ? 'optimal' : 'degraded'}
          </span>
        </div>
        <div className="text-right font-mono">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">
            {now.toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
          <p className="text-xl tabular-nums tracking-wider text-sky-200" aria-label="Local time">
            {now.toLocaleTimeString()}
          </p>
        </div>
      </header>

      {voice.permissionError && (
        <div
          role="alert"
          className="relative mx-4 mt-3 flex items-center gap-2 border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 sm:mx-6"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{voice.permissionError}</span>
        </div>
      )}

      <main className="relative grid flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-12">
        {/* AI core overview */}
        <HudPanel
          title="AI Core Overview"
          icon={<Cpu className="size-3.5" />}
          className="xl:col-span-3"
        >
          <ul className="space-y-1">
            {overview.map((row) => (
              <li key={row.label}>
                <Link
                  to={row.to}
                  className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm hover:bg-sky-400/5"
                >
                  <span className="flex items-center gap-2 text-slate-300">
                    <Dot ok={row.ok} />
                    {row.label}
                  </span>
                  <span className="font-mono text-xs capitalize text-sky-200">{row.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </HudPanel>

        {/* Core */}
        <section
          aria-label="Voice control"
          className="relative flex flex-col items-center justify-center gap-4 py-4 md:col-span-2 xl:col-span-6 xl:row-span-1"
        >
          <div className="text-center">
            <p className="font-mono text-3xl font-semibold tracking-[0.5em] text-sky-100 [text-shadow:0_0_18px_rgba(56,189,248,0.7)]">
              LEO
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-sky-300/80">
              AI Core
            </p>
          </div>
          <LeoOrb
            state={orbState}
            label={live ? 'Hold to talk to LEO' : 'Start a voice session'}
            onPress={pressCore}
            onRelease={() => void voice.stopRecording()}
            onKeyDown={voice.handleKeyDown}
            onKeyUp={voice.handleKeyUp}
          />
          <VoiceWaveform
            state={orbState}
            micStream={voice.micStream}
            getOutputAnalyser={voice.getOutputAnalyser}
          />
          <p className="max-w-sm text-center text-sm text-slate-400">{HINT[orbState]}</p>
          {busy && (
            <button
              type="button"
              onClick={() => void voice.cancelActiveTurn()}
              className="flex items-center gap-1.5 border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
            >
              <XCircle className="size-3.5" /> Cancel turn
            </button>
          )}
          <div className="w-full max-w-lg space-y-2" aria-live="polite">
            {voice.transcripts.length === 0 && !voice.streamingDelta ? (
              <p className="text-center text-xs text-slate-500">
                Your words and LEO&apos;s replies appear here.
              </p>
            ) : (
              [...voice.transcripts.slice(-3)].map((t) => (
                <p
                  key={t.id}
                  className={`text-sm ${t.role === 'user' ? 'text-right text-sky-200' : 'text-slate-100'}`}
                >
                  <span className="mr-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                    {t.role === 'user' ? 'You' : 'LEO'}
                  </span>
                  {t.text}
                </p>
              ))
            )}
            {voice.streamingDelta && (
              <p className="text-sm text-slate-300">{voice.streamingDelta}</p>
            )}
          </div>
          <form onSubmit={submitTyped} className="flex w-full max-w-lg gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={2000}
              placeholder='Type to LEO — e.g. "open YouTube" or "what is the weather in Lahore?"'
              aria-label="Type a message to LEO"
              className="min-w-0 flex-1 rounded-lg border border-sky-400/20 bg-[#06101c]/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-300 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!typed.trim() || pendingText !== null}
              aria-label="Send to LEO"
              className="flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100 hover:bg-sky-500/20 disabled:opacity-40"
            >
              <Send className="size-4" /> Send
            </button>
          </form>
          {voice.blockedLink && (
            <p
              role="alert"
              className="w-full max-w-lg rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
            >
              Your browser blocked the new tab.{' '}
              <a
                href={voice.blockedLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={voice.dismissBlockedLink}
                className="font-semibold underline"
              >
                Open {new URL(voice.blockedLink).hostname}
              </a>
              . To let LEO open sites hands-free, allow pop-ups for this page: click the blocked
              pop-up icon at the right of the address bar and choose &quot;Always allow&quot;.
            </p>
          )}
        </section>

        {/* Live intelligence feed */}
        <HudPanel
          title="Live Intelligence"
          icon={<Radio className="size-3.5" />}
          action={<span className="font-mono text-[10px] text-emerald-300">● LIVE</span>}
          className="xl:col-span-3"
        >
          {feed.length === 0 ? (
            <Empty>All quiet. Nothing needs your attention.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {feed.slice(0, 7).map((item, i) => (
                <li key={i}>
                  <Link
                    to={item.to}
                    className="flex items-center gap-2 border-l-2 px-2 py-1.5 text-sm hover:bg-sky-400/5"
                    style={{
                      borderColor:
                        item.tone === 'warn'
                          ? '#fbbf24'
                          : item.tone === 'ok'
                            ? '#34d399'
                            : '#38bdf8',
                    }}
                  >
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>

        {/* Active agents */}
        <HudPanel
          title="Agents"
          icon={<Bot className="size-3.5" />}
          action={
            <Link to="/agents" className="text-[10px] text-sky-300 hover:underline">
              View all
            </Link>
          }
          className="xl:col-span-5"
        >
          {agents.isLoading ? (
            <Empty>Loading…</Empty>
          ) : !agents.data?.length ? (
            <Empty>No agents yet.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {agents.data.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 border border-sky-400/10 px-3 py-2"
                >
                  <Bot className="size-4 shrink-0 text-sky-300" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-100">{a.name}</p>
                    <p className="truncate font-mono text-[10px] text-slate-500">
                      {a.model || a.provider}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>

        {/* Mission timeline */}
        <HudPanel
          title="Mission Timeline"
          icon={<CalendarDays className="size-3.5" />}
          action={
            <Link to="/tasks" className="text-[10px] text-sky-300 hover:underline">
              Tasks
            </Link>
          }
          className="xl:col-span-4"
        >
          {timeline.length === 0 ? (
            <Empty>No upcoming deadlines.</Empty>
          ) : (
            <ol className="space-y-2 border-l border-sky-400/20 pl-3">
              {timeline.map((t) => (
                <li key={t.id} className="relative text-sm">
                  <span
                    aria-hidden
                    className="absolute -left-[17px] top-1.5 size-2 rounded-full bg-sky-400 shadow-[0_0_6px_#38bdf8]"
                  />
                  <span className="mr-2 font-mono text-[11px] text-slate-400">
                    {t.dueDate}
                    {t.dueTime ? ` ${t.dueTime}` : ''}
                  </span>
                  <span className={PRIORITY_COLOR[t.priority] ?? 'text-slate-200'}>{t.title}</span>
                </li>
              ))}
            </ol>
          )}
        </HudPanel>

        {/* Quick commands */}
        <HudPanel
          title="Quick Commands"
          icon={<SlidersHorizontal className="size-3.5" />}
          className="xl:col-span-3"
        >
          <div className="grid gap-2 text-sm">
            {[
              { to: '/tasks', icon: <ListChecks className="size-4" />, label: 'Start new task' },
              {
                to: '/calendar',
                icon: <CalendarDays className="size-4" />,
                label: 'Open calendar',
              },
              { to: CHAT_PATH, icon: <MessageSquare className="size-4" />, label: 'Open chat' },
              { to: '/workflows', icon: <Workflow className="size-4" />, label: 'Run workflow' },
            ].map((cmd) => (
              <Link
                key={cmd.to}
                to={cmd.to}
                className="flex items-center gap-2 border border-sky-400/15 px-3 py-2 text-slate-200 hover:border-sky-400/40 hover:bg-sky-400/5"
              >
                <span className="text-sky-300">{cmd.icon}</span>
                {cmd.label}
              </Link>
            ))}
          </div>
        </HudPanel>

        {/* System monitor */}
        <HudPanel
          title="System Monitor"
          icon={<Activity className="size-3.5" />}
          className="xl:col-span-3"
        >
          <div className="flex justify-around gap-2">
            <Ring label="CPU" percent={metrics ? metrics.cpu.percent : null} />
            <Ring
              label="RAM"
              percent={metrics ? pct(metrics.memory.used, metrics.memory.total) : null}
            />
            <Ring label="Disk" percent={disk} />
          </div>
          {metrics && (
            <p className="mt-3 text-center font-mono text-[10px] text-slate-500">
              {metrics.cpu.cores} cores · up {Math.floor(metrics.uptime / 3600)} h
            </p>
          )}
        </HudPanel>

        {/* Memory insights */}
        <HudPanel
          title="Memory Insights"
          icon={<Brain className="size-3.5" />}
          action={
            <Link to="/memories" className="text-[10px] text-sky-300 hover:underline">
              Open
            </Link>
          }
          className="xl:col-span-3"
        >
          {!memory.data ? (
            <Empty>{memory.isLoading ? 'Loading…' : 'Memory unavailable.'}</Empty>
          ) : (
            <div className="space-y-2">
              <p className="font-mono text-2xl text-sky-200">
                {memory.data.total}
                <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-400">
                  memories
                </span>
              </p>
              {Object.entries(memory.data.byType)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([type, n]) => (
                  <div key={type} className="text-xs">
                    <div className="flex justify-between text-slate-300">
                      <span className="capitalize">{type}</span>
                      <span className="font-mono">{n}</span>
                    </div>
                    <div className="mt-0.5 h-1 bg-sky-400/10">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${pct(n, memory.data!.total)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </HudPanel>

        {/* LLM status */}
        <HudPanel
          title="LLM Status"
          icon={<Sparkles className="size-3.5" />}
          action={
            <span className="font-mono text-[10px] text-slate-400">
              {connected.length} connected
            </span>
          }
          className="md:col-span-2 xl:col-span-6"
        >
          {!providers.data ? (
            <Empty>{providers.isLoading ? 'Loading…' : 'Providers unavailable.'}</Empty>
          ) : connected.length === 0 ? (
            <Empty>No AI providers connected. Add one in Settings.</Empty>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {connected.slice(0, 9).map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 border border-sky-400/10 px-3 py-2 text-sm"
                >
                  <Dot ok />
                  <span className="truncate text-slate-100">{p.name}</span>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>
      </main>

      {/* Bottom command bar */}
      <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-sky-400/15 bg-[#040b14]/90 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4 font-mono text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            {online ? (
              <Wifi className="size-3.5 text-emerald-300" />
            ) : (
              <WifiOff className="size-3.5 text-red-300" />
            )}
            {online ? 'Network online' : 'Offline'}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <Server className="size-3.5 text-sky-300" /> Whisper + Ollama local
          </span>
        </div>

        <button
          type="button"
          onClick={pressCore}
          className="flex min-w-[220px] flex-col items-center border border-sky-400/40 bg-sky-500/10 px-6 py-2 shadow-[0_0_24px_rgba(56,189,248,0.25)] hover:bg-sky-500/20"
          style={{ color: ORB_COLOR[orbState] }}
        >
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.3em]">
            Talk to LEO
          </span>
          <span className="text-[11px] text-slate-300">
            {live ? HINT[orbState] : wakeEnabled ? 'Say "Hey Leo"' : 'Press to start'}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={wakeEnabled}
            onClick={toggleWake}
            title={wake.error ?? 'Listen for "Hey Leo" (audio is checked by local Whisper only)'}
            className={`flex items-center gap-2 border px-3 py-2 text-xs ${
              wakeEnabled
                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                : 'border-sky-400/20 text-slate-300'
            }`}
          >
            <Ear className="size-4" />
            Hey Leo: {wakeEnabled ? (wake.state === 'error' ? 'error' : wake.state) : 'off'}
          </button>
          <label className="sr-only" htmlFor="leo-speech-output">
            Speech output
          </label>
          <select
            id="leo-speech-output"
            value={voice.speechOutput}
            disabled={live}
            onChange={(e) => voice.chooseSpeechOutput(e.target.value as SpeechOutput)}
            className="border border-sky-400/20 bg-[#03070d] px-2 py-2 text-xs text-slate-200 disabled:opacity-60"
          >
            <option value="local">Windows speech (offline)</option>
            <option value="local-gradium">Gradium voice clone (cloud)</option>
          </select>
          {live ? (
            <button
              type="button"
              onClick={() => void voice.endSession()}
              className="flex items-center gap-1.5 border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20"
            >
              <Power className="size-3.5" /> End session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void voice.startSession()}
              className="flex items-center gap-1.5 border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200 hover:bg-sky-500/20"
            >
              <Play className="size-3.5" /> Start session
            </button>
          )}
        </div>
      </footer>
      {wake.error && wakeEnabled && (
        <p
          role="status"
          className="absolute bottom-20 right-6 border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          {wake.error}
        </p>
      )}
    </div>
  );
}
