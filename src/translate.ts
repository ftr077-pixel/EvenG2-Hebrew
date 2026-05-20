/**
 * Live Hebrew → Russian translation via Claude API.
 *
 * Each confirmed Deepgram segment is sent individually for low-latency live
 * translation. We use claude-haiku-4-5 (fast) and non-streaming (single
 * segments are short enough).
 *
 * Transport mirrors summarize.ts:
 *   • Dev (Vite)        → /api/anthropic proxy (see vite.config.ts)
 *   • Even Hub WebView  → direct https://api.anthropic.com
 */

const ANTHROPIC_BASE =
  typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__evenBridge
    ? 'https://api.anthropic.com'
    : '/api/anthropic';

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

  const response = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: trimmed }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Translate API: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find(b => b.type === 'text')?.text ?? '';
  return text.trim();
}
