/**
 * Dashboard — phone companion UI.
 *
 * Displays on the phone screen (Even Hub companion app WebView):
 *   • Live diarized transcript for the current session
 *   • AI-generated summary when available
 *   • Session history from localStorage
 *   • Export / copy buttons
 *
 * RTL Hebrew layout.
 */

import { useState, useCallback, useSyncExternalStore } from 'react';
import type { DiarizedSegment } from './deepgram';
import type { AppMode } from './types';
import type { Session } from './storage';
import { dbg } from './debugLog';
import type { LogEntry } from './debugLog';

// ---------------------------------------------------------------------------
// Mode-aware helpers
// ---------------------------------------------------------------------------

function speakerLabel(speaker: number, mode: AppMode): string {
  if (mode === 'translate') {
    return speaker === 0 ? 'Я' : `Г${speaker + 1}`;
  }
  return speaker === 0 ? 'אני' : `ד${speaker + 1}`;
}

function segmentText(seg: DiarizedSegment, mode: AppMode): string {
  if (mode === 'translate') return seg.translation ?? '…';
  return seg.text;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SpeakerBadgeProps {
  speaker: number;
  mode: AppMode;
}

function SpeakerBadge({ speaker, mode }: SpeakerBadgeProps) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 700,
      marginLeft: 6,
      background: speaker === 0 ? '#2563eb' : '#6b7280',
      color: '#fff',
    }}>
      {speakerLabel(speaker, mode)}
    </span>
  );
}

interface SegmentRowProps {
  seg: DiarizedSegment;
  mode: AppMode;
  isInterim?: boolean;
}

function SegmentRow({ seg, mode, isInterim }: SegmentRowProps) {
  const text = segmentText(seg, mode);
  const pending = mode === 'translate' && !seg.translation;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid #f0f0f0',
      opacity: isInterim || pending ? 0.6 : 1,
      fontStyle: isInterim || pending ? 'italic' : 'normal',
      direction: mode === 'translate' ? 'ltr' : 'rtl',
      textAlign: mode === 'translate' ? 'left' : 'right',
    }}>
      <SpeakerBadge speaker={seg.speaker} mode={mode} />
      <span style={{ flex: 1, fontSize: 15, lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session card (history)
// ---------------------------------------------------------------------------

interface SessionCardProps {
  session: Session;
  onDelete: (id: string) => void;
}

function SessionCard({ session, onDelete }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cardMode: AppMode = session.mode ?? 'transcribe';

  const locale = cardMode === 'translate' ? 'ru-RU' : 'he-IL';
  const date = new Date(session.startedAt).toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const copyText = useCallback(() => {
    const lines = session.segments
      .map(s => `${speakerLabel(s.speaker, cardMode)}: ${segmentText(s, cardMode)}`)
      .join('\n');
    const full = session.summary ? `${session.summary}\n\n---\n${lines}` : lines;
    void navigator.clipboard.writeText(full);
  }, [session, cardMode]);

  const meta = cardMode === 'translate'
    ? `${session.segments.length} реплик · перевод RU`
    : `${session.segments.length} קטעים${session.summary ? ' · יש סיכום' : ''}`;
  const copyLabel = cardMode === 'translate' ? 'Копировать' : 'העתק';
  const deleteLabel = cardMode === 'translate' ? 'Удалить' : 'מחק';

  return (
    <div style={{
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      marginBottom: 10,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          cursor: 'pointer',
          background: expanded ? '#f9fafb' : '#fff',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{date}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {meta}
          </div>
        </div>
        <span style={{ fontSize: 18, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f3f4f6' }}>
          {session.summary && cardMode !== 'translate' && (
            <div style={{
              background: '#eff6ff',
              borderRadius: 8,
              padding: '10px 12px',
              marginTop: 12,
              marginBottom: 12,
              fontSize: 14,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}>
              <strong>סיכום AI:</strong>{'\n'}{session.summary}
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            {session.segments.map((seg, i) => (
              <SegmentRow key={i} seg={seg} mode={cardMode} />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={copyText} style={btnStyle('#2563eb')}>{copyLabel}</button>
            <button onClick={() => onDelete(session.id)} style={btnStyle('#dc2626')}>{deleteLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export interface DashboardProps {
  /** Confirmed segments from the current active session */
  liveSegments: DiarizedSegment[];
  /** In-progress interim segment */
  liveInterim: DiarizedSegment[];
  /** 'idle' | 'connecting' | 'listening' | 'error' */
  sttState: string;
  /** AI summary for the current session (null while summarizing) */
  summary: string | null;
  /** True while summary is being generated */
  summarizing: boolean;
  /** All stored sessions (passed in from App so state stays in one place) */
  sessions: Session[];
  /** Active mode (transcribe vs Hebrew→Russian translate) */
  mode: AppMode;
  /** Called when user toggles the mode */
  onModeChange: (mode: AppMode) => void;
  /** Called when user deletes a session */
  onDeleteSession: (id: string) => void;
  /** Called when user clears all history */
  onClearAll: () => void;
}

function DebugLogPanel() {
  const logs = useSyncExternalStore(dbg.subscribe, dbg.getEntries);
  const color: Record<LogEntry['level'], string> = { info: '#10b981', warn: '#fbbf24', error: '#ef4444' };
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5 }}>
      {logs.length === 0 ? (
        <div style={{ color: '#9ca3af' }}>No logs yet — tap glasses to start</div>
      ) : logs.map((e, i) => (
        <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #1f2937', color: color[e.level], wordBreak: 'break-all', direction: 'ltr', textAlign: 'left' }}>
          <span style={{ color: '#6b7280' }}>{e.time}</span> {e.level === 'error' ? 'ERR ' : ''}{e.message}
        </div>
      ))}
    </div>
  );
}

interface UIStrings {
  title: string;
  statusIdle: string;
  statusConnecting: string;
  statusListening: string;
  statusError: string;
  tabLive: string;
  tabHistory: (n: number) => string;
  summarizing: string;
  summaryTitle: string;
  summarySpinner: string;
  emptyListening: string;
  emptyTapHint: string;
  copyTranscript: string;
  emptyHistory: string;
  clearAll: string;
}

const UI: Record<AppMode, UIStrings> = {
  transcribe: {
    title: 'עברית — G2',
    statusIdle: 'ממתין',
    statusConnecting: 'מתחבר...',
    statusListening: 'מקשיב',
    statusError: 'שגיאה',
    tabLive: 'שיחה נוכחית',
    tabHistory: n => `היסטוריה (${n})`,
    summarizing: 'מסכם עם AI...',
    summaryTitle: 'סיכום AI',
    summarySpinner: '⏳ מייצר סיכום...',
    emptyListening: 'ממתין לדיבור...',
    emptyTapHint: 'לחץ על המשקפיים להתחלת הקלטה',
    copyTranscript: 'העתק תמלול',
    emptyHistory: 'אין הקלטות שמורות',
    clearAll: 'מחק הכל',
  },
  translate: {
    title: 'Иврит → Русский — G2',
    statusIdle: 'Ожидание',
    statusConnecting: 'Подключение...',
    statusListening: 'Слушаю',
    statusError: 'Ошибка',
    tabLive: 'Текущая сессия',
    tabHistory: n => `История (${n})`,
    summarizing: '',
    summaryTitle: '',
    summarySpinner: '',
    emptyListening: 'Ожидание речи...',
    emptyTapHint: 'Коснитесь очков, чтобы начать запись',
    copyTranscript: 'Скопировать перевод',
    emptyHistory: 'Нет сохранённых записей',
    clearAll: 'Очистить всё',
  },
};

export function Dashboard({
  liveSegments,
  liveInterim,
  sttState,
  summary,
  summarizing,
  sessions,
  mode,
  onModeChange,
  onDeleteSession,
  onClearAll,
}: DashboardProps) {
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const ui = UI[mode];
  const isTranslate = mode === 'translate';

  const copyLive = useCallback(() => {
    const lines = liveSegments
      .map(s => `${speakerLabel(s.speaker, mode)}: ${segmentText(s, mode)}`)
      .join('\n');
    const full = summary && !isTranslate ? `${summary}\n\n---\n${lines}` : lines;
    void navigator.clipboard.writeText(full);
  }, [liveSegments, summary, mode, isTranslate]);

  const statusColor: Record<string, string> = {
    idle: '#6b7280',
    connecting: '#f59e0b',
    listening: '#10b981',
    error: '#ef4444',
  };

  const statusLabel: Record<string, string> = {
    idle: ui.statusIdle,
    connecting: ui.statusConnecting,
    listening: ui.statusListening,
    error: ui.statusError,
  };

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      direction: isTranslate ? 'ltr' : 'rtl',
      maxWidth: 480,
      margin: '0 auto',
      padding: '16px 14px',
      background: '#fff',
      minHeight: '100dvh',
    }}>
      {/* DEBUG LOG */}
      <div style={{ background: '#111827', color: '#10b981', borderRadius: 8, padding: '10px 12px', marginBottom: 14, maxHeight: 300, overflow: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', marginBottom: 6, direction: 'ltr', textAlign: 'left' }}>DEBUG LOG</div>
        <DebugLogPanel />
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>
          {ui.title}
        </h1>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '3px 10px',
          borderRadius: 20,
          background: statusColor[sttState] ?? '#6b7280',
          color: '#fff',
        }}>
          {statusLabel[sttState] ?? sttState}
        </span>
      </div>

      {/* Mode toggle */}
      <ModeToggle mode={mode} onChange={onModeChange} />

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 16 }}>
        {(['live', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '8px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: tab === t ? 700 : 400,
              color: tab === t ? '#2563eb' : '#6b7280',
              borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {t === 'live' ? ui.tabLive : ui.tabHistory(sessions.length)}
          </button>
        ))}
      </div>

      {/* Live tab */}
      {tab === 'live' && (
        <div>
          {/* AI Summary (transcribe mode only) */}
          {!isTranslate && (summarizing || summary) && (
            <div style={{
              background: '#eff6ff',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 14,
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#1d4ed8' }}>
                {summarizing ? ui.summarizing : ui.summaryTitle}
              </div>
              {summarizing ? (
                <span style={{ color: '#6b7280' }}>{ui.summarySpinner}</span>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{summary}</span>
              )}
            </div>
          )}

          {/* Transcript */}
          {liveSegments.length === 0 && liveInterim.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>
              {sttState === 'listening' ? ui.emptyListening : ui.emptyTapHint}
            </div>
          ) : (
            <div>
              {liveSegments.map((seg, i) => <SegmentRow key={i} seg={seg} mode={mode} />)}
              {liveInterim.map((seg, i) => <SegmentRow key={`interim-${i}`} seg={seg} mode={mode} isInterim />)}
            </div>
          )}

          {/* Copy button */}
          {liveSegments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={copyLive} style={btnStyle('#2563eb')}>{ui.copyTranscript}</button>
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div>
          {sessions.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>
              {ui.emptyHistory}
            </div>
          ) : (
            <>
              {[...sessions].reverse().map(s => (
                <SessionCard key={s.id} session={s} onDelete={onDeleteSession} />
              ))}
              <button
                onClick={onClearAll}
                style={{ ...btnStyle('#dc2626'), marginTop: 8, width: '100%' }}
              >
                {ui.clearAll}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function ModeToggle({ mode, onChange }: { mode: AppMode; onChange: (m: AppMode) => void }) {
  const options: Array<{ id: AppMode; label: string }> = [
    { id: 'transcribe', label: 'עברית' },
    { id: 'translate',  label: 'RU' },
  ];
  return (
    <div style={{
      display: 'inline-flex',
      borderRadius: 999,
      background: '#f3f4f6',
      padding: 3,
      marginBottom: 14,
      direction: 'ltr',
    }}>
      {options.map(opt => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={{
            padding: '6px 14px',
            borderRadius: 999,
            border: 'none',
            background: mode === opt.id ? '#fff' : 'transparent',
            color: mode === opt.id ? '#111827' : '#6b7280',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: mode === opt.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared button style
// ---------------------------------------------------------------------------

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: bg,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
