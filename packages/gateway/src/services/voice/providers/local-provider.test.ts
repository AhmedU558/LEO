import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceAudioDeltaEvent, VoiceProviderEvents } from '@ownpilot/core/voice';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

const { LocalVoiceProvider } = await import('./local-provider.js');
type Synth = NonNullable<ConstructorParameters<typeof LocalVoiceProvider>[1]>;

const WINDOWS_PCM = Buffer.alloc(8, 1).toString('base64');

/** Whisper hears "hello leo"; Windows speech returns 8 bytes of PCM. */
function fakeProcesses() {
  execFileMock.mockImplementation(
    (cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string) => void) => {
      let input = '';
      const stdin = {
        on: () => stdin,
        end: (text: string) => {
          input = text;
          const out = cmd === 'python' ? (input ? 'hello leo' : 'ready') : input ? WINDOWS_PCM : '';
          queueMicrotask(() => cb(null, out));
        },
      };
      return { stdin };
    }
  );
}

function recorder() {
  const statuses: string[] = [];
  const order: string[] = [];
  const audio: VoiceAudioDeltaEvent[] = [];
  const errors: string[] = [];
  const events: VoiceProviderEvents = {
    onStatusChange: (s) => statuses.push(s),
    onTranscript: (t) => order.push(`transcript:${t.role}`),
    onAudioDelta: (a) => {
      order.push('audio');
      audio.push(a);
    },
    onError: (e) => errors.push(e.message),
  };
  return { statuses, order, audio, errors, events };
}

const ranPowerShell = () => execFileMock.mock.calls.some(([cmd]) => cmd === 'powershell.exe');

async function speakOneTurn(
  provider: InstanceType<typeof LocalVoiceProvider>,
  events: VoiceProviderEvents
) {
  await provider.connect(events);
  provider.sendAudio(Buffer.alloc(4).toString('base64'));
  provider.commitAudio();
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  fakeProcesses();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/api/chat')
        ? new Response(JSON.stringify({ message: { content: 'Hi from LEO.' } }))
        : new Response('{}')
    )
  );
});

afterEach(() => {
  execFileMock.mockReset();
  vi.unstubAllGlobals();
});

describe('LocalVoiceProvider', () => {
  it('defaults to Windows speech', async () => {
    const provider = new LocalVoiceProvider();
    const r = recorder();
    await speakOneTurn(provider, r.events);
    await vi.waitFor(() => expect(r.audio).toHaveLength(1));

    expect(provider.name).toBe('local');
    expect(ranPowerShell()).toBe(true);
    expect(r.audio[0]!.delta).toBe(WINDOWS_PCM);
    expect(r.statuses.at(-1)).toBe('connected');
  });

  describe('with a speech synthesizer', () => {
    const pcm = Buffer.alloc(6, 2);

    it('checks it at connect, sends text first, then streams its audio', async () => {
      const synth: Synth = {
        check: vi.fn(),
        stream: vi.fn(async (_text, _signal, onPcm) => {
          onPcm(pcm);
          onPcm(pcm);
        }),
      };
      const provider = new LocalVoiceProvider('local-gradium', synth);
      const r = recorder();
      await speakOneTurn(provider, r.events);
      await vi.waitFor(() => expect(r.statuses.at(-1)).toBe('connected'));

      expect(synth.check).toHaveBeenCalledOnce();
      expect(synth.stream).toHaveBeenCalledWith(
        'Hi from LEO.',
        expect.any(AbortSignal),
        expect.any(Function)
      );
      expect(r.order).toEqual(['transcript:user', 'transcript:assistant', 'audio', 'audio']);
      expect(r.audio[0]).toMatchObject({
        format: 'pcm16',
        sampleRate: 24000,
        delta: pcm.toString('base64'),
      });
      expect(r.audio[0]!.responseId).toBeTruthy();
      expect(r.statuses).toContain('speaking');
      expect(ranPowerShell()).toBe(false);
    });

    it('keeps the text reply, reports the failure and stays usable without a fallback voice', async () => {
      const synth: Synth = {
        check: vi.fn(),
        stream: vi.fn().mockRejectedValue(new Error('Gradium credits are exhausted.')),
      };
      const provider = new LocalVoiceProvider('local-gradium', synth);
      const r = recorder();
      await speakOneTurn(provider, r.events);
      await vi.waitFor(() => expect(r.errors).toHaveLength(1));

      expect(r.errors[0]).toBe('Gradium credits are exhausted.');
      expect(r.order).toContain('transcript:assistant');
      expect(r.audio).toHaveLength(0);
      expect(ranPowerShell()).toBe(false);
      await vi.waitFor(() => expect(provider.getStatus()).toBe('connected'));
    });

    it('fails the connect when the synthesizer is not configured', async () => {
      const synth: Synth = {
        check: () => {
          throw new Error('Gradium is not configured');
        },
        stream: vi.fn(),
      };
      const provider = new LocalVoiceProvider('local-gradium', synth);
      const r = recorder();
      await expect(provider.connect(r.events)).rejects.toThrow('Gradium is not configured');
      expect(r.errors).toEqual(['Gradium is not configured']);
    });

    it('drops audio from a turn that was interrupted', async () => {
      let late: ((pcm: Buffer) => void) | undefined;
      const synth: Synth = {
        check: vi.fn(),
        stream: vi.fn(
          (_text, signal, onPcm) =>
            new Promise<void>((_resolve, reject) => {
              late = onPcm;
              signal.addEventListener('abort', () => reject(signal.reason));
            })
        ),
      };
      const provider = new LocalVoiceProvider('local-gradium', synth);
      const r = recorder();
      await speakOneTurn(provider, r.events);
      await vi.waitFor(() => expect(late).toBeDefined());

      provider.interrupt();
      late!(pcm);
      await Promise.resolve();

      expect(r.audio).toHaveLength(0);
      expect(r.errors).toHaveLength(0);
      expect(provider.getStatus()).toBe('connected');
    });
  });
});
