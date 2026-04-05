/**
 * LLM summarization — Gemini 2.0 Flash API.
 *
 * Produces a Hebrew summary of a diarized transcript:
 *   • One-sentence overview of the meeting
 *   • Up to 3 bullet points with key decisions / action items
 */

import type { DiarizedSegment } from './deepgram';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.0-flash';

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
 * Summarize a diarized transcript using Gemini 2.0 Flash.
 *
 * @param segments  - Confirmed DiarizedSegments for the session
 * @param apiKey    - Gemini API key (VITE_GEMINI_API_KEY)
 * @returns         - Full summary string
 */
export async function summarizeTranscript(
  segments: DiarizedSegment[],
  apiKey: string,
): Promise<string> {
  if (segments.length === 0) {
    return 'אין מספיק תוכן לסיכום.';
  }

  const transcriptText = transcriptToText(segments);

  const response = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `תמלול הפגישה:\n\n${transcriptText}` }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1024,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  return text.trim() || 'אין מספיק תוכן לסיכום.';
}
