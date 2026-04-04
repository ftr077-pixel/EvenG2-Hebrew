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

import { useState, useCallback } from 'react';
import type { DiarizedSegment } from './deepgram';
import type { Session } from './storage';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SpeakerBadgeProps {
  speaker: number;
}

function SpeakerBadge({ speaker }: SpeakerBadgeProps) {
  const label = speaker === 0 ? 'אני' : `ד${speaker + 1}`;
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
      {label}
    </span>
  );
}

interface SegmentRowProps {
  seg: DiarizedSegment;
  isInterim?: boolean;
}

function SegmentRow({ seg, isInterim }: SegmentRowProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid #f0f0f0',
      opacity: isInterim ? 0.6 : 1,
      fontStyle: isInterim ? 'italic' : 'normal',
    }}>
      <SpeakerBadge speaker={seg.speaker} />
      <span style={{ flex: 1, fontSize: 15, lineHeight: 1.5 }}>{seg.text}</span>
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

  const date = new Date(session.startedAt).toLocaleString('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const copyText = useCallback(() => {
    const lines = session.segments
      .map(s => `${s.speaker === 0 ? 'אני' : `ד${s.speaker + 1}`}: ${s.text}`)
      .join('\n');
    const full = session.summary ? `${session.summary}\n\n---\n${lines}` : lines;
    void navigator.clipboard.writeText(full);
  }, [session]);

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
            {session.segments.length} קטעים
            {session.summary ? ' · יש סיכום' : ''}
          </div>
        </div>
        <span style={{ fontSize: 18, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f3f4f6' }}>
          {session.summary && (
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
              <SegmentRow key={i} seg={seg} />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={copyText} style={btnStyle('#2563eb')}>העתק</button>
            <button onClick={() => onDelete(session.id)} style={btnStyle('#dc2626')}>מחק</button>
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
  /** Called when user deletes a session */
  onDeleteSession: (id: string) => void;
  /** Called when user clears all history */
  onClearAll: () => void;
}

export function Dashboard({
  liveSegments,
  liveInterim,
  sttState,
  summary,
  summarizing,
  sessions,
  onDeleteSession,
  onClearAll,
}: DashboardProps) {
  const [tab, setTab] = useState<'live' | 'history'>('live');

  const copyLive = useCallback(() => {
    const lines = liveSegments
      .map(s => `${s.speaker === 0 ? 'אני' : `ד${s.speaker + 1}`}: ${s.text}`)
      .join('\n');
    const full = summary ? `${summary}\n\n---\n${lines}` : lines;
    void navigator.clipboard.writeText(full);
  }, [liveSegments, summary]);

  const statusColor: Record<string, string> = {
    idle: '#6b7280',
    connecting: '#f59e0b',
    listening: '#10b981',
    error: '#ef4444',
  };

  const statusLabel: Record<string, string> = {
    idle: 'ממתין',
    connecting: 'מתחבר...',
    listening: 'מקשיב',
    error: 'שגיאה',
  };

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      direction: 'rtl',
      maxWidth: 480,
      margin: '0 auto',
      padding: '16px 14px',
      background: '#fff',
      minHeight: '100dvh',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, flex: 1 }}>
          עברית — G2
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
            {t === 'live' ? 'שיחה נוכחית' : `היסטוריה (${sessions.length})`}
          </button>
        ))}
      </div>

      {/* Live tab */}
      {tab === 'live' && (
        <div>
          {/* AI Summary */}
          {(summarizing || summary) && (
            <div style={{
              background: '#eff6ff',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 14,
              fontSize: 14,
              lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, color: '#1d4ed8' }}>
                {summarizing ? 'מסכם עם AI...' : 'סיכום AI'}
              </div>
              {summarizing ? (
                <span style={{ color: '#6b7280' }}>⏳ מייצר סיכום...</span>
              ) : (
                <span style={{ whiteSpace: 'pre-wrap' }}>{summary}</span>
              )}
            </div>
          )}

          {/* Transcript */}
          {liveSegments.length === 0 && liveInterim.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>
              {sttState === 'listening' ? 'ממתין לדיבור...' : 'לחץ על המשקפיים להתחלת הקלטה'}
            </div>
          ) : (
            <div>
              {liveSegments.map((seg, i) => <SegmentRow key={i} seg={seg} />)}
              {liveInterim.map((seg, i) => <SegmentRow key={`interim-${i}`} seg={seg} isInterim />)}
            </div>
          )}

          {/* Copy button */}
          {liveSegments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={copyLive} style={btnStyle('#2563eb')}>העתק תמלול</button>
            </div>
          )}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div>
          {sessions.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>
              אין הקלטות שמורות
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
                מחק הכל
              </button>
            </>
          )}
        </div>
      )}
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
