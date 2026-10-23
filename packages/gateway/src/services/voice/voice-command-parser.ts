import { resolveDefaultProviderAndModel, getApiKey } from '../app-settings.js';
import { getAggregatorProvider } from '@ownpilot/core';

export interface VoiceCommandIntent {
  intent: 'INITIATE_TASK' | 'CANCEL_TASK' | 'AMBIGUOUS';
  objective?: string;
  reason?: string;
}

export async function parseVoiceCommandIntent(text: string): Promise<VoiceCommandIntent> {
  const { provider, model } = await resolveDefaultProviderAndModel('openai', 'default');
  if (!provider) {
    return { intent: 'AMBIGUOUS', reason: 'No AI provider configured' };
  }

  const apiKey = await getApiKey(provider);
  if (!apiKey) return { intent: 'AMBIGUOUS', reason: 'No AI API key' };

  const baseUrl = getAggregatorProvider(provider)?.apiBase || 'https://api.openai.com/v1';

  const prompt = `You are a voice command parser for an AI agent.
The user said: "${text}".
Classify the intent into one of:
1. INITIATE_TASK: The user wants the AI to perform a computer-use task (e.g. search, buy, read). Extract their explicit goal into 'objective'.
2. CANCEL_TASK: The user wants to stop, cancel, or abort the current action.
3. AMBIGUOUS: The user's request is unclear, missing critical information, or not a command.

Return ONLY valid JSON matching this schema:
{
  "intent": "INITIATE_TASK" | "CANCEL_TASK" | "AMBIGUOUS",
  "objective": "string (only if INITIATE_TASK)",
  "reason": "string (if AMBIGUOUS, explain why)"
}`;

  const payload = {
    model: model || 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  };

  const response = await fetch(`${baseUrl.replace(/\/v1$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    return { intent: 'AMBIGUOUS', reason: 'LLM parsing failed' };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(content) as VoiceCommandIntent;
  } catch {
    return { intent: 'AMBIGUOUS', reason: 'Failed to parse JSON' };
  }
}
