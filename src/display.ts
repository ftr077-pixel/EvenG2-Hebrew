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
import type { AppSnapshot, AppMode, DiarizedSegment } from './types';


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

function speakerLabel(speaker: number, mode: AppMode): string {
  if (mode === 'translate') {
    return speaker === 0 ? 'Я' : `Г${speaker + 1}`;
  }
  return speaker === 0 ? 'אני' : `ד${speaker + 1}`;
}

function speakerStyle(speaker: number): LineStyle {
  return speaker === 0 ? 'normal' : 'meta';
}

/** Pick the text to display for a segment based on the current mode. */
function segmentText(seg: DiarizedSegment, mode: AppMode): string {
  if (mode === 'translate') {
    // Russian translation only — no Hebrew letters in translate mode.
    return seg.translation ?? '…';
  }
  return seg.text;
}

// ---------------------------------------------------------------------------
// Transcript → DisplayLines
// ---------------------------------------------------------------------------

function segmentsToLines(
  confirmed: DiarizedSegment[],
  interim: DiarizedSegment[],
  maxLines: number,
  mode: AppMode,
) {
  const allLines: ReturnType<typeof line>[] = [];

  const addSegment = (seg: DiarizedSegment, isInterim: boolean) => {
    const text = segmentText(seg, mode);
    if (mode === 'translate' && isInterim && !seg.translation) return;
    const prefix = `${speakerLabel(seg.speaker, mode)}: `;
    const style  = speakerStyle(seg.speaker);
    const wrapped = wrapText(prefix + text, 2);
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

// ---------------------------------------------------------------------------
// Localized UI strings — keep the HUD in a single language per mode so the
// user never sees mixed scripts (translate mode = no Hebrew letters at all).
// ---------------------------------------------------------------------------

interface UIStrings {
  connecting: string;
  summarizing: string[];
  unknownError: string;
  errRetry: string;
  errClear: string;
  listening: string;
  stop: string;
  again: string;
  clear: string;
  idleTitle: string;
  start: string;
}

const STRINGS: Record<AppMode, UIStrings> = {
  transcribe: {
    connecting: 'מתחבר לשירות...',
    summarizing: ['מסכם עם AI...', 'אנא המתן'],
    unknownError: 'שגיאה לא ידועה',
    errRetry: 'נסה שוב',
    errClear: 'נקה',
    listening: 'מקשיב...',
    stop: '▶ עצור',
    again: 'הקלט שוב',
    clear: 'נקה',
    idleTitle: 'זיהוי דיבור עברית',
    start: '▶ התחל',
  },
  translate: {
    connecting: 'Подключение...',
    summarizing: ['', ''],
    unknownError: 'Неизвестная ошибка',
    errRetry: 'Повторить',
    errClear: 'Очистить',
    listening: 'Слушаю...',
    stop: '▶ Стоп',
    again: 'Записать снова',
    clear: 'Очистить',
    idleTitle: 'Перевод иврит → русский',
    start: '▶ Старт',
  },
};

export function toDisplayData(snap: AppSnapshot, nav: GlassNavState): DisplayData {
  const t = STRINGS[snap.mode];

  // ── Connecting ─────────────────────────────────────────────────────────────
  if (snap.sttState === 'connecting') {
    return { lines: [line(t.connecting)] };
  }

  // ── Summarizing ────────────────────────────────────────────────────────────
  if (snap.sttState === 'summarizing') {
    return {
      lines: t.summarizing.map(s => line(s, 'meta')),
    };
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (snap.sttState === 'error') {
    const errLines = wrapText(snap.error ?? t.unknownError, 3);
    return {
      lines: [
        ...errLines.map(s => line(s, 'meta')),
        ...buildScrollableList({
          items: [t.errRetry, t.errClear],
          highlightedIndex: nav.highlightedIndex,
          maxVisible: 2,
          formatter: a => a,
        }),
      ],
    };
  }

  // ── Listening — live diarized conversation ────────────────────────────────
  if (snap.sttState === 'listening') {
    const transcriptLines = segmentsToLines(snap.segments, snap.interim, TRANSCRIPT_LINES, snap.mode);

    if (transcriptLines.length === 0) {
      return {
        lines: [
          line(t.listening, 'meta'),
          line(''),
          line(''),
          line(t.stop, 'meta', true),
        ],
      };
    }

    const pad = Math.max(0, TRANSCRIPT_LINES - transcriptLines.length);
    return {
      lines: [
        ...transcriptLines,
        ...Array.from({ length: pad }, () => line('')),
        line(t.stop, 'meta', true),
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
          ...summaryLines.map(s => line(s, 'normal')),
          ...Array.from({ length: pad }, () => line('')),
          ...buildScrollableList({
            items: [t.again, t.clear],
            highlightedIndex: nav.highlightedIndex,
            maxVisible: 2,
            formatter: a => a,
          }),
        ],
      };
    }

    const transcriptLines = segmentsToLines(snap.segments, [], TRANSCRIPT_LINES, snap.mode);
    const pad = Math.max(0, TRANSCRIPT_LINES - transcriptLines.length);
    return {
      lines: [
        ...transcriptLines,
        ...Array.from({ length: pad }, () => line('')),
        ...buildScrollableList({
          items: [t.again, t.clear],
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
      line(t.idleTitle),
      line(''),
      line(''),
      line(t.start, 'meta', true),
    ],
  };
}
