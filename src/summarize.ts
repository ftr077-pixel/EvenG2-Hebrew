/**
 * LLM summarization — OpenRouter (google/gemini-2.5-flash) with streaming.
 *
 * Produces a Hebrew summary of a diarized transcript:
 *   • One-sentence overview of the meeting
 *   • Up to 3 bullet points with key decisions / action items
 */

import type { DiarizedSegment } from './deepgram';
import { chatStream } from './openrouter';

const SUMMARY_MODEL = 'google/gemini-2.5-flash';

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

/**
 * Summarize a diarized transcript using OpenRouter.
 *
 * @param segments  - Confirmed DiarizedSegments for the session
 * @param apiKey    - OpenRouter API key (VITE_OPENROUTER_API_KEY)
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

  const fullText = await chatStream(
    {
      model: SUMMARY_MODEL,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `תמלול הפגישה:\n\n${transcriptText}` },
      ],
    },
    apiKey,
    onChunk,
  );

  return fullText.trim() || 'אין מספיק תוכן לסיכום.';
}
