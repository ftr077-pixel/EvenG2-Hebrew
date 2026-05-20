/**
 * Live Hebrew → Russian translation via OpenRouter (google/gemini-2.5-flash).
 *
 * Each confirmed Deepgram segment is sent individually for low-latency live
 * translation. We use a fast multilingual model and non-streaming (single
 * segments are short enough to wait for the full response).
 */

import { chat } from './openrouter';

const TRANSLATE_MODEL = 'google/gemini-2.5-flash';

const SYSTEM_PROMPT =
  'You are a real-time Hebrew-to-Russian translator. ' +
  'Translate the given Hebrew utterance into natural, fluent Russian. ' +
  'Output ONLY the Russian translation — no quotes, no transliteration, ' +
  'no commentary, no Hebrew script. If the input is empty or untranslatable, ' +
  'return an empty string.';

export async function translateToRussian(
  hebrew: string,
  apiKey: string,
): Promise<string> {
  const trimmed = hebrew.trim();
  if (!trimmed) return '';

  return chat(
    {
      model: TRANSLATE_MODEL,
      max_tokens: 512,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: trimmed },
      ],
    },
    apiKey,
  );
}
