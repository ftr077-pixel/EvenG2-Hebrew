/**
 * Even G2 — Hebrew Speech App (even-toolkit edition)
 *
 * Architecture
 * ─────────────
 * useGlasses  — initialises the Even Hub bridge, polls snapshot every 100 ms,
 *               renders display lines, and dispatches glass actions (tap/scroll).
 *               Stores the bridge at window.__evenBridge for the STT source.
 *
 * useSTT      — wraps Deepgram streaming via GlassBridgeSource, which reads
 *               window.__evenBridge to open/close the G2 microphone and
 *               forward PCM audio chunks to the Deepgram WebSocket.
 *               Emits interimTranscript live and transcript on stop.
 *
 * Glass flow
 * ──────────
 * 1. idle     → user presses SELECT → start() called → Deepgram WS opens,
 *               mic enabled
 * 2. listening → interim Hebrew text appears on display in real-time
 * 3. user presses SELECT (עצור) → stop() called → Deepgram flushes finals,
 *               mic disabled
 * 4. result   → highlight between [הקלט שוב] and [נקה]
 */

import { useMemo, useRef, useCallback } from 'react';
import { useGlasses } from 'even-toolkit/useGlasses';
import { useSTT } from 'even-toolkit/stt/react';
import { moveHighlight } from 'even-toolkit/glass-nav';
import type { GlassNavState, GlassAction } from 'even-toolkit';
import { toDisplayData } from './display';
import type { AppSnapshot } from './types';

const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY ?? '';

export default function App() {
  // ── Speech-to-text ─────────────────────────────────────────────────────────
  // source: 'glass-bridge' → GlassBridgeSource uses window.__evenBridge
  // (set by useGlasses on init) to control the G2 mic and receive PCM audio.
  const stt = useSTT({
    provider: 'deepgram',
    source: 'glass-bridge',
    language: 'he',
    apiKey: DEEPGRAM_API_KEY,
    continuous: false,
  });

  // Keep an always-current ref so onGlassAction (stable callback) can read stt
  const sttRef = useRef(stt);
  sttRef.current = stt;

  // ── Snapshot ────────────────────────────────────────────────────────────────
  // useMemo keeps the same object reference until the listed deps change.
  // useGlasses polls getSnapshot() every 100 ms and only re-renders the display
  // when the reference changes — this prevents spurious redraws.
  const snap = useMemo<AppSnapshot>(() => ({
    state: stt.state,
    transcript: stt.transcript,
    interimTranscript: stt.interimTranscript,
    isListening: stt.isListening,
    isLoading: stt.isLoading,
    errorMsg: stt.error?.message ?? null,
    numActions: stt.transcript ? 2 : 1,
  }), [stt.state, stt.transcript, stt.interimTranscript, stt.isListening, stt.isLoading, stt.error]);

  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ── Action handler ──────────────────────────────────────────────────────────
  const onGlassAction = useCallback((
    action: GlassAction,
    nav: GlassNavState,
    _snap: AppSnapshot,       // same as snapRef.current; use ref for freshness
  ): GlassNavState => {
    const s = sttRef.current;
    const curr = snapRef.current;

    if (action.type === 'HIGHLIGHT_MOVE') {
      return {
        ...nav,
        highlightedIndex: moveHighlight(
          nav.highlightedIndex,
          action.direction,
          curr.numActions - 1,
        ),
      };
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      if (s.isListening) {
        // Stop recording — Deepgram will flush remaining audio and emit finals
        s.stop();
      } else if (curr.transcript) {
        if (nav.highlightedIndex === 0) {
          // "הקלט שוב" — clear result and start a new recording
          s.reset();
          void s.start();
        } else {
          // "נקה" — clear result, return to idle
          s.reset();
        }
      } else if (curr.state === 'error') {
        if (nav.highlightedIndex === 0) {
          // "נסה שוב"
          s.reset();
          void s.start();
        } else {
          // "נקה"
          s.reset();
        }
      } else if (!s.isLoading) {
        // "הקלט" — start recording
        void s.start();
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

  // Glasses-only app — no web UI
  return null;
}
