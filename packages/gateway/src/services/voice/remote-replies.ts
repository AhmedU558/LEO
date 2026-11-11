/**
 * Voice replies from LEO's connected AI providers (OpenAI, Google, OpenRouter, …)
 * instead of local Ollama. Same provider plumbing as analyze_image: the API key
 * and base URL come from LEO's provider config and never leave the gateway.
 */
import { createProvider, type Message, type ProviderConfig } from '@ownpilot/core/agent';
import { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } from '../agent/cache.js';

export type ChatTurn = { role: string; content: string };

/** Throws a user-facing message when the provider can't be used. */
export async function checkRemoteProvider(provider: string): Promise<void> {
  if (!(await getProviderApiKey(provider))) {
    throw new Error(`No API key is set for ${provider}. Add it in Settings → Providers.`);
  }
}

export async function remoteReply(
  provider: string,
  model: string,
  history: readonly ChatTurn[],
  maxTokens: number
): Promise<string> {
  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) throw new Error(`No API key is set for ${provider}.`);
  const config = loadProviderConfig(provider);
  const client = createProvider({
    provider: (NATIVE_PROVIDERS.has(provider) ? provider : 'openai') as ProviderConfig['provider'],
    apiKey,
    baseUrl: config?.baseUrl,
    headers: config?.headers,
  });
  const result = await client.complete({
    messages: history.map((t) => ({ role: t.role, content: t.content }) as Message),
    model: { model, maxTokens, temperature: 0.7 },
  });
  if (!result.ok) throw new Error(`${provider}: ${result.error.message}`);
  const reply = result.value.content;
  if (typeof reply !== 'string' || !reply.trim()) {
    throw new Error(`${provider} returned an empty reply.`);
  }
  return reply;
}
