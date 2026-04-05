/**
 * LLM summarization — Claude API (claude-opus-4-6) with adaptive thinking + streaming.
 *
 * Produces a Hebrew summary of a diarized transcript:
 *   • One-sentence overview of the meeting
 *   • Up to 3 bullet points with key decisions / action items
 *
 * Transport:
 *   • Dev (Vite)        → /api/anthropic proxy (see vite.config.ts)
 *   • Even Hub WebView  → direct https://api.anthropic.com (no CORS enforcement)
 */

import type { DiarizedSegment } from './deepgram';

const ANTHROPIC_BASE =
  typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__evenBridge
    ? 'https://api.anthropic.com'   // Running inside Even Hub WebView
    : '/api/anthropic';             // Dev: proxied by Vite

const SYSTEM_PROMPT = `אתה מסכם ישיבות בעברית. קבל תמלול מדויק של שיחה ועשה:
1. משפט סיכום אחד (תמציתי, בעברית).
2. עד 3 נקודות בולט עם החלטות עיקריות / פריטי פעולה.

פורמט תגובה:
סיכום: <משפט אחד>
• <נקודה 1>
• <נקודה 2>
• <נקודה 3>

אם אין מספיק תוכן, כתוב: "אין מספיק תוכן לסיכום."`;

function speakerLabel(speaker: number): string {
  return speaker === 0 ? 'אני' : `ד${speaker + 1}`;
}

function transcriptToText(segments: DiarizedSegment[]): string {
  return segments
    .map(s => `${speakerLabel(s.speaker)}: ${s.text}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main summarization function
// ---------------------------------------------------------------------------

/**
 * Summarize a diarized transcript using Claude.
 *
 * @param segments  - Confirmed DiarizedSegments for the session
 * @param apiKey    - Anthropic API key (VITE_ANTHROPIC_API_KEY)
 * @param onChunk   - Called with each streamed text chunk (for live display)
 * @returns         - Full summary string
 */
export async function summarizeTranscript(
  segments: DiarizedSegment[],
  apiKey: string,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (segments.length === 0) {
    return 'אין מספיק תוכן לסיכום.';
  }

  const transcriptText = transcriptToText(segments);

  const response = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `תמלול הפגישה:\n\n${transcriptText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`שגיאת Claude API: ${response.status} ${errText}`);
  }

  // Stream-parse the SSE response
  const reader = response.body?.getReader();
  if (!reader) throw new Error('אין תמיכה ב-streaming');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  // Timeout guard: abort if stream stalls for 60s
  const streamTimeout = 60_000;
  let lastActivity = Date.now();
  const timeoutCheck = setInterval(() => {
    if (Date.now() - lastActivity > streamTimeout) {
      reader.cancel().catch(() => {});
    }
  }, 5_000);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastActivity = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(raw); } catch { continue; }

        if (event.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            fullText += delta.text;
            onChunk?.(delta.text);
          }
        }
      }
    }
  } finally {
    clearInterval(timeoutCheck);
  }

  return fullText.trim() || 'אין מספיק תוכן לסיכום.';
}
