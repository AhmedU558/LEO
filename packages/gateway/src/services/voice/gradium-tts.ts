/**
 * Gradium text-to-speech for voice sessions.
 *
 * POST {base_url}/post/speech/tts with `only_audio: true` streams raw
 * `pcm_24000` audio (16-bit signed mono), the format Pcm16Player plays.
 * Docs: https://docs.gradium.ai/api-reference/endpoint/tts-post
 *
 * The API key is read here, on the gateway, and never leaves it: it is not
 * logged, returned, or included in any error message.
 */

import { getConfigCenter } from '@ownpilot/core/services';
import { ignoreError } from '@ownpilot/core/utils';
import type { SpeechSynthesizer } from './providers/local-provider.js';

const SERVICE = 'gradium';
const DEFAULT_BASE_URL = 'https://api.gradium.ai/api';
/** Free tier: 1500 characters per session (docs.gradium.ai/guides/faq). */
export const GRADIUM_MAX_CHARS = 1500;
const TIMEOUT_MS = 60_000;
/** Two minutes of 24 kHz 16-bit mono audio. */
const MAX_AUDIO_BYTES = 24000 * 2 * 120;
/** Half a second per delta, so the player's 100-node queue holds 50 s. */
const CHUNK_BYTES = 24000;

interface GradiumConfig {
  apiKey: string;
  baseUrl: string;
  voiceId: string;
  modelName: string;
}

function readString(field: string): string {
  const value = getConfigCenter().getFieldValue(SERVICE, field);
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveGradiumConfig(): GradiumConfig {
  const apiKey = getConfigCenter().getApiKey(SERVICE)?.trim();
  if (!apiKey) {
    throw new Error(
      'Gradium is not configured: set GRADIUM_API_KEY on the gateway or the Gradium API key in Config Center.'
    );
  }
  const voiceId = readString('voice_id');
  if (!voiceId) {
    throw new Error(
      'Gradium voice is not configured: set GRADIUM_VOICE_ID or the Gradium voice ID in Config Center.'
    );
  }
  return {
    apiKey,
    voiceId,
    baseUrl: (readString('base_url') || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    modelName: readString('model_name') || 'default',
  };
}

/** Upstream text is not secret, but strip the key anyway and keep it short. */
function sanitize(text: string, apiKey: string): string {
  return text.split(apiKey).join('[redacted]').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function describeFailure(status: number, body: string): string {
  if (status === 401 || status === 403) return 'Gradium rejected the API key.';
  if (status === 404) return 'Gradium could not find the endpoint or voice.';
  if (status === 402) return 'Gradium credits are exhausted.';
  if (status === 429) return 'Gradium rate limit reached. Try again shortly.';
  // Documented pre-stream errors: HTTP 500 with "error from server <code>: <reason>".
  const upstream = /^error from server (\d+): (.*)$/.exec(body);
  if (upstream) return `Gradium rejected the request (code ${upstream[1]}: ${upstream[2]}).`;
  return body
    ? `Gradium request failed (HTTP ${status}: ${body}).`
    : `Gradium request failed (HTTP ${status}).`;
}

/**
 * Stream `text` as 24 kHz PCM16. `onPcm` only ever receives whole samples.
 * Rejects on cancellation, timeout, or upstream failure; never falls back.
 */
export async function streamGradiumSpeech(
  text: string,
  signal: AbortSignal,
  onPcm: (pcm: Buffer) => void
): Promise<void> {
  const config = resolveGradiumConfig();
  if (text.length > GRADIUM_MAX_CHARS) {
    throw new Error(
      `Reply is too long for Gradium speech (${text.length}/${GRADIUM_MAX_CHARS} characters).`
    );
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/post/speech/tts`, {
      method: 'POST',
      headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice_id: config.voiceId,
        output_format: 'pcm_24000',
        model_name: config.modelName,
        only_audio: true,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Gradium speech timed out.');
    }
    throw new Error('Could not reach Gradium.');
  }

  if (!response.ok) {
    const body = sanitize(await response.text().catch(() => ''), config.apiKey);
    throw new Error(describeFailure(response.status, body));
  }
  // The docs say audio/pcm, but the live API sends raw PCM as application/octet-stream.
  const contentType = response.headers.get('content-type') ?? '';
  const isAudio =
    contentType.startsWith('audio/') || contentType.startsWith('application/octet-stream');
  if (!isAudio || !response.body) {
    ignoreError(response.body?.cancel(), 'gradium-tts-cancel');
    throw new Error('Gradium returned an unexpected response instead of audio.');
  }

  const reader = response.body.getReader();
  let pending = Buffer.alloc(0);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_AUDIO_BYTES) throw new Error('Gradium audio exceeded the two-minute limit.');
      pending = Buffer.concat([pending, value]);
      if (pending.length >= CHUNK_BYTES) {
        // Keep an odd trailing byte for the next read so no sample is split.
        const whole = pending.length - (pending.length % 2);
        onPcm(pending.subarray(0, whole));
        pending = pending.subarray(whole);
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Gradium speech timed out.');
    }
    throw error instanceof Error && error.message.startsWith('Gradium')
      ? error
      : new Error('Gradium audio stream was interrupted.');
  } finally {
    ignoreError(reader.cancel(), 'gradium-tts-reader');
  }
  const whole = pending.length - (pending.length % 2);
  if (whole) onPcm(pending.subarray(0, whole));
  if (!total) throw new Error('Gradium returned no audio.');
}

export const gradiumSpeech: SpeechSynthesizer = {
  check: () => void resolveGradiumConfig(),
  stream: streamGradiumSpeech,
};
