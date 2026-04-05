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
import { toDisplayData } from './display';
import type { AppSnapshot } from './types';
import { summarizeTranscript } from './summarize';
import { loadSessions, saveSession, deleteSession, clearAllSessions, newSessionId } from './storage';
import type { Session } from './storage';
import { Dashboard } from './Dashboard';
import { dbg } from './debugLog';

const DEEPGRAM_API_KEY   = import.meta.env.VITE_DEEPGRAM_API_KEY   ?? '';
const GEMINI_API_KEY     = import.meta.env.VITE_GEMINI_API_KEY     ?? '';

dbg.info('App loaded');
dbg.info(`DG key: ${DEEPGRAM_API_KEY ? 'present' : 'MISSING'}`);
dbg.info(`Gemini key: ${GEMINI_API_KEY ? 'present' : 'MISSING'}`);
dbg.info(`Stored sessions: ${loadSessions().length}`);
dbg.info(`URL: ${window.location.href.slice(0, 60)}`);

export default function App() {
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

  // ── Session storage ────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const sessionIdRef = useRef<string | null>(null);

  // Refresh sessions from storage whenever we save
  const refreshSessions = useCallback(() => setSessions(loadSessions()), []);

  // ── Stable snapshot ───────────────────────────────────────────────────────
  const snap = useMemo<AppSnapshot>(() => {
    const hasContent = stt.segments.length > 0;
    const state = effectiveSttState;
    return {
      sttState: state,
      segments: stt.segments,
      interim: stt.interim,
      hasContent,
      error: stt.error,
      summary,
      numActions: hasContent && (state === 'idle') ? 2 : 1,
    };
  }, [effectiveSttState, stt.segments, stt.interim, stt.error, summary]);

  const snapRef = useRef(snap);
  snapRef.current = snap;

  // ── Summarize and store a completed session ───────────────────────────────
  const summarizeAndStore = useCallback(async (segments: typeof stt.segments) => {
    if (segments.length === 0) return;

    const id = sessionIdRef.current ?? newSessionId();
    sessionIdRef.current = id;

    // Save immediately without summary
    const partial: Session = {
      id,
      startedAt: new Date().toISOString(),
      segments,
      summary: null,
    };
    saveSession(partial);
    refreshSessions();

    if (!GEMINI_API_KEY) return; // skip summarization if no key

    setSummarizing(true);
    setSummary(null);

    try {
      const result = await summarizeTranscript(segments, GEMINI_API_KEY);
      setSummary(result);

      // Update stored session with summary
      saveSession({ ...partial, summary: result });
      refreshSessions();
    } catch (err) {
      dbg.warn(`Summarization failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSummarizing(false);
    }
  }, [refreshSessions]);

  // ── Handle session lifecycle ───────────────────────────────────────────────
  // When sttState transitions from listening → idle, trigger summarization
  const prevSttStateRef = useRef(stt.sttState);
  useEffect(() => {
    const prev = prevSttStateRef.current;
    prevSttStateRef.current = stt.sttState;

    if (prev === 'listening' && stt.sttState === 'idle') {
      void summarizeAndStore(stt.segments);
    }
  }, [stt.sttState, stt.segments, summarizeAndStore]);

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

  // ── Glasses bridge (image-based for Hebrew support) ────────────────────────
  useGlassesHebrew<AppSnapshot>({
    appName: 'עברית',
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
      liveSegments={stt.segments}
      liveInterim={stt.interim}
      sttState={stt.sttState}
      summary={summary}
      summarizing={summarizing}
      sessions={sessions}
      onDeleteSession={handleDeleteSession}
      onClearAll={handleClearAll}
    />
  );
}
