/**
 * "Hey Leo" detection on a short local Whisper transcript.
 *
 * Whisper tiny often renders "Leo" as a near-homophone, so those are accepted —
 * but only directly after a greeting, which keeps "Leo" in ordinary speech
 * from waking the assistant.
 */

/** Spoken to Whisper as `initial_prompt` so it expects the phrase. */
export const WAKE_PROMPT = 'Hey Leo.';

const WAKE = /\b(?:hey|hi|hay|hello|okay|ok)[\s,.!-]*(?:leo|lio|leah|lia|leeo)\b/;

export function heardWakeWord(transcript: string): boolean {
  return WAKE.test(transcript.toLowerCase());
}
