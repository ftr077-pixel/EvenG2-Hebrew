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
 * Additional layers:
 *   Session end → Claude AI (claude-opus-4-6) → Hebrew summary → HUD flash + Dashboard
 *   All sessions → localStorage (src/storage.ts)
 *   Phone screen → Dashboard (src/Dashboard.tsx)
 *
 * Glass controls (tap/ring/keyboard all map to the same GlassAction):
 *   SELECT  — idle: start session  |  listening: stop session
 *             idle+history: record again  |  idle+history+move: clear
 *   MOVE    — scroll action highlight (הקלט שוב ↔ נקה)
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { moveHighlight } from 'even-toolkit/glass-nav';
import type { GlassNavState, GlassAction } from 'even-toolkit';
import { useGlassesHebrew } from './useGlassesHebrew';
import { useDiarizedSTT } from './deepgram';
import type { DiarizedSegment } from './deepgram';
import { toDisplayData } from './display';
import type { AppMode, AppSnapshot } from './types';
import { summarizeTranscript } from './summarize';
import { translateToRussian } from './translate';
import { loadSessions, saveSession, deleteSession, clearAllSessions, newSessionId } from './storage';
import type { Session } from './storage';
import { Dashboard } from './Dashboard';
import { dbg } from './debugLog';

const MODE_STORAGE_KEY = 'eveng2-mode';

function loadMode(): AppMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    return v === 'translate' ? 'translate' : 'transcribe';
  } catch {
    return 'transcribe';
  }
}

const DEEPGRAM_API_KEY    = import.meta.env.VITE_DEEPGRAM_API_KEY    ?? '';
const OPENROUTER_API_KEY  = import.meta.env.VITE_OPENROUTER_API_KEY  ?? '';

dbg.info('App loaded');
dbg.info(`DG key: ${DEEPGRAM_API_KEY ? DEEPGRAM_API_KEY.slice(0, 8) + '...' : 'MISSING'}`);
dbg.info(`URL: ${window.location.href.slice(0, 60)}`);

export default function App() {
  // ── Mode (transcribe vs translate) ────────────────────────────────────────
  const [mode, setMode] = useState<AppMode>(loadMode);
  const handleModeChange = useCallback((next: AppMode) => {
    setMode(next);
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  // ── Diarized speech-to-text ────────────────────────────────────────────────
  const stt = useDiarizedSTT(DEEPGRAM_API_KEY);
  const sttRef = useRef(stt);
  sttRef.current = stt;

  // ── Summarization state ───────────────────────────────────────────────────
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary]         = useState<string | null>(null);

  // Derive effective sttState (adds 'summarizing' pseudo-state for HUD)
  const effectiveSttState = useMemo<AppSnapshot['sttState']>(() => {
    if (summarizing) return 'summarizing';
    return stt.sttState;
  }, [summarizing, stt.sttState]);

  // ── Translation state (translate mode only) ───────────────────────────────
  // Keyed by index in stt.segments. Reset whenever a new session starts
  // (i.e. when stt.segments goes back to empty).
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const lastTranslatedRef = useRef(0);
  const pendingTranslationsRef = useRef(0);

  // Translate newly-confirmed segments while in translate mode.
  useEffect(() => {
    if (mode !== 'translate') return;
    if (!OPENROUTER_API_KEY) return;
    const start = lastTranslatedRef.current;
    const total = stt.segments.length;
    if (total <= start) return;
    lastTranslatedRef.current = total;

    for (let i = start; i < total; i++) {
      const seg = stt.segments[i];
      if (!seg) continue;
      pendingTranslationsRef.current++;
      void translateToRussian(seg.text, OPENROUTER_API_KEY)
        .then(ru => setTranslations(t => ({ ...t, [i]: ru || '—' })))
        .catch(err => {
          dbg.error(`Translate ${i}: ${err instanceof Error ? err.message : String(err)}`);
          setTranslations(t => ({ ...t, [i]: '⚠ ошибка перевода' }));
        })
        .finally(() => { pendingTranslationsRef.current--; });
    }
  }, [stt.segments, mode]);

  // Reset translation cache when segments are reset (new session / clear).
  useEffect(() => {
    if (stt.segments.length === 0) {
      if (lastTranslatedRef.current !== 0) setTranslations({});
      lastTranslatedRef.current = 0;
    }
  }, [stt.segments.length]);

  // Build the segments/interim that downstream consumers (HUD + Dashboard)
  // actually display. In translate mode we attach `translation` so the
  // display layer can render Russian instead of Hebrew.
  const displaySegments = useMemo<DiarizedSegment[]>(() => {
    if (mode !== 'translate') return stt.segments;
    return stt.segments.map((s, i) => ({ ...s, translation: translations[i] }));
  }, [stt.segments, translations, mode]);

  const displayInterim = useMemo<DiarizedSegment[]>(() => {
    if (mode !== 'translate') return stt.interim;
    // No live translation for interim utterances — too chatty for the API.
    // The HUD/dashboard render a "…" placeholder instead.
    return stt.interim.map(s => ({ ...s, translation: undefined }));
  }, [stt.interim, mode]);

  // ── Session storage ────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const sessionIdRef = useRef<string | null>(null);

  // Refresh sessions from storage whenever we save
  const refreshSessions = useCallback(() => setSessions(loadSessions()), []);

  // ── Stable snapshot ───────────────────────────────────────────────────────
  const snap = useMemo<AppSnapshot>(() => {
    const hasContent = displaySegments.length > 0;
    const state = effectiveSttState;
    return {
      sttState: state,
      segments: displaySegments,
      interim: displayInterim,
      hasContent,
      error: stt.error,
      summary,
      numActions: hasContent && (state === 'idle') ? 2 : 1,
      mode,
    };
  }, [effectiveSttState, displaySegments, displayInterim, stt.error, summary, mode]);

  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ── Finalize a completed session ──────────────────────────────────────────
  // Transcribe mode: save transcript, then summarize with Claude.
  // Translate mode: save transcript + Russian translations (re-saved by a
  // separate effect as more translations stream in). No summary.
  const finalizeSession = useCallback(async (
    segments: DiarizedSegment[],
    sessionMode: AppMode,
  ) => {
    if (segments.length === 0) return;

    const id = sessionIdRef.current ?? newSessionId();
    sessionIdRef.current = id;

    const partial: Session = {
      id,
      startedAt: new Date().toISOString(),
      segments,
      summary: null,
      mode: sessionMode,
    };
    saveSession(partial);
    refreshSessions();

    if (sessionMode === 'translate') return; // translate mode: no summary
    if (!OPENROUTER_API_KEY) return;

    setSummarizing(true);
    setSummary(null);

    try {
      const result = await summarizeTranscript(segments, OPENROUTER_API_KEY);
      setSummary(result);
      saveSession({ ...partial, summary: result });
      refreshSessions();
    } catch {
      // Non-fatal — transcript is saved without summary
    } finally {
      setSummarizing(false);
    }
  }, [refreshSessions]);

  // ── Handle session lifecycle ───────────────────────────────────────────────
  // When sttState transitions from listening → idle, finalize the session.
  // In translate mode we pass `displaySegments` so any translations that
  // arrived before stop are persisted.
  const prevSttStateRef = useRef(stt.sttState);
  useEffect(() => {
    const prev = prevSttStateRef.current;
    prevSttStateRef.current = stt.sttState;

    if (prev === 'listening' && stt.sttState === 'idle') {
      const segs = mode === 'translate' ? displaySegments : stt.segments;
      void finalizeSession(segs, mode);
    }
  }, [stt.sttState, stt.segments, displaySegments, mode, finalizeSession]);

  // Re-save the current session whenever translations arrive after stop so
  // history reflects the final Russian text without the user needing to
  // wait for translation before stopping.
  useEffect(() => {
    if (mode !== 'translate') return;
    if (stt.sttState !== 'idle') return;
    const id = sessionIdRef.current;
    if (!id) return;
    if (displaySegments.length === 0) return;
    const existing = sessions.find(s => s.id === id);
    if (!existing) return;
    // Only re-save if translations have advanced.
    const same = existing.segments.length === displaySegments.length &&
      existing.segments.every((s, i) => s.translation === displaySegments[i]?.translation);
    if (same) return;
    saveSession({ ...existing, segments: displaySegments, mode: 'translate' });
    refreshSessions();
  }, [translations, mode, stt.sttState, displaySegments, sessions, refreshSessions]);

  // ── Glass action handler ──────────────────────────────────────────────────
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
          s.stop();
          break;

        case 'idle':
          if (cur.hasContent) {
            if (nav.highlightedIndex === 0) {
              // "הקלט שוב" — keep history, start new session
              sessionIdRef.current = newSessionId();
              setSummary(null);
              void s.start();
            } else {
              // "נקה" — wipe history
              s.reset();
              setSummary(null);
              sessionIdRef.current = null;
            }
          } else {
            // "התחל"
            sessionIdRef.current = newSessionId();
            setSummary(null);
            void s.start();
          }
          break;

        case 'error':
          if (nav.highlightedIndex === 0) {
            s.reset();
            setSummary(null);
            sessionIdRef.current = newSessionId();
            void s.start();
          } else {
            s.reset();
            setSummary(null);
            sessionIdRef.current = null;
          }
          break;
      }
      return { ...nav, highlightedIndex: 0 };
    }

    return nav;
  }, []);

  // ── Glasses bridge (image-based to support Hebrew + Cyrillic) ─────────────
  useGlassesHebrew<AppSnapshot>({
    appName: mode === 'translate' ? 'RU' : 'עברית',
    getSnapshot: () => snapRef.current,
    deriveScreen: () => 'main',
    toDisplayData,
    onGlassAction,
  });

  // ── Dashboard (phone screen) ──────────────────────────────────────────────
  const handleDeleteSession = useCallback((id: string) => {
    deleteSession(id);
    refreshSessions();
  }, [refreshSessions]);

  const handleClearAll = useCallback(() => {
    clearAllSessions();
    refreshSessions();
  }, [refreshSessions]);

  return (
    <Dashboard
      liveSegments={displaySegments}
      liveInterim={displayInterim}
      sttState={stt.sttState}
      summary={summary}
      summarizing={summarizing}
      sessions={sessions}
      mode={mode}
      onModeChange={handleModeChange}
      onDeleteSession={handleDeleteSession}
      onClearAll={handleClearAll}
    />
  );
}
