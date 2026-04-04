/**
 * Builds the glasses display for each app state.
 *
 * Used as the `toDisplayData` callback in useGlasses().
 * even-toolkit renders these DisplayLines as text on the G2 (10 lines max).
 *
 * States:
 *   idle       — "מוכן להקלטה" + single [הקלט] action
 *   loading    — "מתחבר לשירות..."
 *   listening  — live interim transcript (Deepgram) + [עצור] action at bottom
 *   processing — "מעבד..." (batch flush; rare for Deepgram streaming)
 *   error      — error message + [נסה שוב | נקה]
 *   result     — final transcript + [הקלט שוב | נקה]
 */

import type { DisplayData, GlassNavState } from 'even-toolkit';
import { line } from 'even-toolkit';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import type { AppSnapshot } from './types';

/** Max chars per display line before we soft-wrap */
const CHARS_PER_LINE = 28;

/** Word-wrap a string into display lines of ≤ CHARS_PER_LINE characters. */
function wrapText(text: string, maxLines = 8): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = '';

  for (const word of words) {
    if (result.length >= maxLines) break;
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= CHARS_PER_LINE) {
      current += ` ${word}`;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current && result.length < maxLines) result.push(current);
  return result;
}

export function toDisplayData(snap: AppSnapshot, nav: GlassNavState): DisplayData {
  // ── Loading ────────────────────────────────────────────────────────────────
  if (snap.state === 'loading') {
    return { lines: [line('מתחבר לשירות...')] };
  }

  // ── Processing ─────────────────────────────────────────────────────────────
  if (snap.state === 'processing') {
    return { lines: [line('מעבד...')] };
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (snap.state === 'error') {
    const errLines = wrapText(snap.errorMsg ?? 'שגיאה לא ידועה', 6);
    return {
      lines: [
        ...errLines.map(t => line(t, 'meta')),
        line(''),
        ...buildScrollableList({
          items: ['נסה שוב', 'נקה'],
          highlightedIndex: nav.highlightedIndex,
          maxVisible: 2,
          formatter: (a) => a,
        }),
      ],
    };
  }

  // ── Listening — show live Deepgram interim transcript ──────────────────────
  if (snap.isListening) {
    const displayText = snap.interimTranscript || 'מקליט...';
    const textLines = wrapText(displayText, 8);
    return {
      lines: [
        ...textLines.map(t => line(t)),
        // Pad to push "עצור" to the bottom (max 10 lines total)
        ...Array.from({ length: Math.max(0, 9 - textLines.length) }, () => line('')),
        line('▶ עצור', 'meta', true),
      ],
    };
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  if (snap.transcript) {
    const textLines = wrapText(snap.transcript, 7);
    return {
      lines: [
        ...textLines.map(t => line(t)),
        line(''),
        ...buildScrollableList({
          items: ['הקלט שוב', 'נקה'],
          highlightedIndex: nav.highlightedIndex,
          maxVisible: 2,
          formatter: (a) => a,
        }),
      ],
    };
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  return {
    lines: [
      line(''),
      line('מוכן להקלטה'),
      line(''),
      line('▶ הקלט', 'meta', true),
    ],
  };
}
