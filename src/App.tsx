/**
 * Even G2 — Hebrew Meeting Transcription App
 *
 * Implements the spec's Edge + Brain layers directly in the Even Hub WebView.
 * (The "Bridge / Companion Phone" layer is the Even Hub native app itself,
 *  which manages BLE 5.4 and routes audio from the glasses to this WebView.)
 *
 * Data pipeline:
 *   G2 4-mic array
 *     → GlassBridgeSource (even-toolkit) — Float32 PCM @ 16 kHz
 *       → f32ToI16 conversion
 *         → Deepgram nova-2 WebSocket (language=he, diarize=true)
 *           → DiarizedSegments ([אני] / [ד2])
 *             → useGlasses display renderer
 *               → G2 monochrome HUD
 *
 * Glass controls (tap/ring/keyboard all map to the same GlassAction):
 *   SELECT  — idle: start session  |  listening: stop session
 *             idle+history: record again  |  idle+history+move: clear
 *   MOVE    — scroll action highlight (הקלט שוב ↔ נקה)
 */

import { useMemo, useRef, useCallback } from 'react';
import { useGlasses } from 'even-toolkit/useGlasses';
import { moveHighlight } from 'even-toolkit/glass-nav';
import type { GlassNavState, GlassAction } from 'even-toolkit';
import { useDiarizedSTT } from './deepgram';
import { toDisplayData } from './display';
import type { AppSnapshot } from './types';

const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY ?? '';

export default function App() {
  // ── Diarized speech-to-text ────────────────────────────────────────────────
  const stt = useDiarizedSTT(DEEPGRAM_API_KEY);
  const sttRef = useRef(stt);
  sttRef.current = stt;

  // ── Stable snapshot (reference-stable between polls) ──────────────────────
  const snap = useMemo<AppSnapshot>(() => {
    const hasContent = stt.segments.length > 0;
    return {
      sttState: stt.sttState,
      segments: stt.segments,
      interim: stt.interim,
      hasContent,
      error: stt.error,
      numActions: hasContent && stt.sttState === 'idle' ? 2 : 1,
    };
  }, [stt.sttState, stt.segments, stt.interim, stt.error]);

  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ── Glass action handler ───────────────────────────────────────────────────
  const onGlassAction = useCallback((
    action: GlassAction,
    nav: GlassNavState,
  ): GlassNavState => {
    const s   = sttRef.current;
    const cur = snapRef.current;

    if (action.type === 'HIGHLIGHT_MOVE') {
      return {
        ...nav,
        highlightedIndex: moveHighlight(
          nav.highlightedIndex,
          action.direction,
          cur.numActions - 1,
        ),
      };
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      switch (cur.sttState) {
        case 'listening':
          // Stop the session — Deepgram flushes final segments before closing
          s.stop();
          break;

        case 'idle':
          if (cur.hasContent) {
            if (nav.highlightedIndex === 0) {
              // "הקלט שוב" — keep history, start new session
              void s.start();
            } else {
              // "נקה" — wipe history
              s.reset();
            }
          } else {
            // "התחל" — begin first session
            void s.start();
          }
          break;

        case 'error':
          if (nav.highlightedIndex === 0) {
            s.reset();
            void s.start();     // "נסה שוב"
          } else {
            s.reset();          // "נקה"
          }
          break;
      }
      return { ...nav, highlightedIndex: 0 };
    }

    return nav;
  }, []);

  // ── Glasses bridge ─────────────────────────────────────────────────────────
  useGlasses<AppSnapshot>({
    appName: 'עברית',
    getSnapshot: () => snapRef.current,
    deriveScreen: () => 'main',
    toDisplayData,
    onGlassAction,
  });

  return null; // glasses-only app
}
