/**
 * Glasses display builder — implements the spec's "HUD Display Logic".
 *
 * Speaker formatting (monochrome constraints — no colour, use typography):
 *   Speaker 0 (wearer)  → normal style, prefix "אני: "
 *   Speaker 1+          → meta style (visually dimmer), prefix "ד2: ", "ד3: " …
 *
 * The conversation history scrolls upward as new segments arrive, keeping
 * the most recent speech at the bottom of the 10-line display.
 *
 * States:
 *   idle (no history)  — "מוכן להקלטה"  +  [התחל]
 *   idle (has history) — transcript view  +  [הקלט שוב | נקה]
 *   connecting         — "מתחבר..."
 *   listening          — live conversation (confirmed + interim) + [עצור]
 *   error              — error message  +  [נסה שוב | נקה]
 */

import type { DisplayData, GlassNavState, LineStyle } from 'even-toolkit';
import { line } from 'even-toolkit';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import type { AppSnapshot, DiarizedSegment } from './types';


const CHARS_PER_LINE = 28;
const TRANSCRIPT_LINES = 8; // rows reserved for conversation (2 for actions)

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function wrapText(text: string, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';

  for (const word of words) {
    if (out.length >= maxLines) break;
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= CHARS_PER_LINE) {
      cur += ` ${word}`;
    } else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur && out.length < maxLines) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// Speaker label helpers
// ---------------------------------------------------------------------------

function speakerLabel(speaker: number): string {
  return speaker === 0 ? 'אני' : `ד${speaker + 1}`;
}

function speakerStyle(speaker: number): LineStyle {
  return speaker === 0 ? 'normal' : 'meta';
}

// ---------------------------------------------------------------------------
// Transcript → DisplayLines
// ---------------------------------------------------------------------------

/**
 * Converts confirmed + interim segments into display lines, capped at maxLines.
 * Oldest lines scroll off the top; newest always visible at the bottom.
 */
function segmentsToLines(
  confirmed: DiarizedSegment[],
  interim: DiarizedSegment[],
  maxLines: number,
) {
  // Build all lines (oldest → newest)
  const allLines: ReturnType<typeof line>[] = [];

  const addSegment = (seg: DiarizedSegment, isInterim: boolean) => {
    const prefix = `${speakerLabel(seg.speaker)}: `;
    const style  = speakerStyle(seg.speaker);
    const wrapped = wrapText(prefix + seg.text, 3); // max 3 lines per segment
    wrapped.forEach((t, i) => {
      // Highlight the last line of the current interim segment (active speech)
      const invert = isInterim && i === wrapped.length - 1;
      allLines.push(line(t, style, invert));
    });
  };

  for (const seg of confirmed) addSegment(seg, false);
  for (const seg of interim)   addSegment(seg, true);

  // Slide window: show only the last maxLines
  return allLines.slice(-maxLines);
}

// ---------------------------------------------------------------------------
// Main display function
// ---------------------------------------------------------------------------

export function toDisplayData(snap: AppSnapshot, nav: GlassNavState): DisplayData {

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (snap.sttState === 'connecting') {
    return { lines: [line('מתחבר לשירות...')] };
  }

  // ── Summarizing ────────────────────────────────────────────────────────────
  if (snap.sttState === 'summarizing') {
    return {
      lines: [
        line(''),
        line('מסכם עם AI...', 'meta'),
        line(''),
        line('אנא המתן', 'meta'),
      ],
    };
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (snap.sttState === 'error') {
    const errLines = wrapText(snap.error ?? 'שגיאה לא ידועה', 6);
    return {
      lines: [
        ...errLines.map(t => line(t, 'meta')),
        line(''),
        ...buildScrollableList({
          items: ['נסה שוב', 'נקה'],
          highlightedIndex: nav.highlightedIndex,
          maxVisible: 2,
          formatter: a => a,
        }),
      ],
    };
  }

  // ── Listening — live diarized conversation ────────────────────────────────
  if (snap.sttState === 'listening') {
    const transcriptLines = segmentsToLines(snap.segments, snap.interim, TRANSCRIPT_LINES);

    // Pad so "עצור" is always anchored at the bottom
    const pad = Math.max(0, TRANSCRIPT_LINES - transcriptLines.length);

    return {
      lines: [
        ...transcriptLines,
        ...Array.from({ length: pad }, () => line('')),
        line(''),
        line('▶ עצור', 'meta', true),
      ],
    };
  }

  // ── Idle with conversation history ────────────────────────────────────────
  if (snap.hasContent) {
    // If a summary exists, show it instead of the raw transcript
    if (snap.summary) {
      const summaryLines = wrapText(snap.summary, 6);
      const pad = Math.max(0, 8 - summaryLines.length);
      return {
        lines: [
          ...summaryLines.map(t => line(t, 'normal')),
          ...Array.from({ length: pad }, () => line('')),
          line(''),
          ...buildScrollableList({
            items: ['הקלט שוב', 'נקה'],
            highlightedIndex: nav.highlightedIndex,
            maxVisible: 2,
            formatter: a => a,
          }),
        ],
      };
    }

    const transcriptLines = segmentsToLines(snap.segments, [], TRANSCRIPT_LINES);
    const pad = Math.max(0, TRANSCRIPT_LINES - transcriptLines.length);
    return {
      lines: [
        ...transcriptLines,
        ...Array.from({ length: pad }, () => line('')),
        line(''),
        ...buildScrollableList({
          items: ['הקלט שוב', 'נקה'],
          highlightedIndex: nav.highlightedIndex,
          maxVisible: 2,
          formatter: a => a,
        }),
      ],
    };
  }

  // ── Idle — no history ─────────────────────────────────────────────────────
  return {
    lines: [
      line(''),
      line('זיהוי דיבור עברית'),
      line(''),
      line('▶ התחל', 'meta', true),
    ],
  };
}
