/**
 * Glasses display builder — "HUD Display Logic" for image tiles.
 *
 * Canvas: 576×100, font: 20px bold → 4 lines max in image tiles.
 * Layout: up to 3 transcript lines in tiles + action button as inverted line.
 * The inverted line is rendered subtly in tiles but extracted for the text area.
 */

import type { DisplayData, GlassNavState, LineStyle } from 'even-toolkit';
import { line } from 'even-toolkit';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import type { AppSnapshot, DiarizedSegment } from './types';


const CHARS_PER_LINE = 38;
const TRANSCRIPT_LINES = 3; // 3 transcript + 1 action = 4 total

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

function segmentsToLines(
  confirmed: DiarizedSegment[],
  interim: DiarizedSegment[],
  maxLines: number,
) {
  const allLines: ReturnType<typeof line>[] = [];

  const addSegment = (seg: DiarizedSegment, isInterim: boolean) => {
    const prefix = `${speakerLabel(seg.speaker)}: `;
    const style  = speakerStyle(seg.speaker);
    const wrapped = wrapText(prefix + seg.text, 2);
    wrapped.forEach((t, i) => {
      const invert = isInterim && i === wrapped.length - 1;
      allLines.push(line(t, style, invert));
    });
  };

  for (const seg of confirmed) addSegment(seg, false);
  for (const seg of interim)   addSegment(seg, true);

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
        line('מסכם עם AI...', 'meta'),
        line('אנא המתן', 'meta'),
      ],
    };
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (snap.sttState === 'error') {
    const errLines = wrapText(snap.error ?? 'שגיאה לא ידועה', 3);
    return {
      lines: [
        ...errLines.map(t => line(t, 'meta')),
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

    if (transcriptLines.length === 0) {
      // No speech yet — show "listening" indicator
      return {
        lines: [
          line('מקשיב...', 'meta'),
          line(''),
          line(''),
          line('עצור', 'meta', true),
        ],
      };
    }

    // Pad transcript to keep action at line 4
    const pad = Math.max(0, TRANSCRIPT_LINES - transcriptLines.length);
    return {
      lines: [
        ...transcriptLines,
        ...Array.from({ length: pad }, () => line('')),
        line('עצור', 'meta', true),
      ],
    };
  }

  // ── Idle with conversation history ────────────────────────────────────────
  if (snap.hasContent) {
    if (snap.summary) {
      const summaryLines = wrapText(snap.summary, TRANSCRIPT_LINES);
      const pad = Math.max(0, TRANSCRIPT_LINES - summaryLines.length);
      return {
        lines: [
          ...summaryLines.map(t => line(t, 'normal')),
          ...Array.from({ length: pad }, () => line('')),
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
      line('זיהוי דיבור עברית'),
      line(''),
      line(''),
      line('התחל', 'meta', true),
    ],
  };
}
