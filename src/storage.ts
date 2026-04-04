/**
 * Transcript storage — localStorage-based session persistence.
 *
 * Each session stores:
 *   id        — uuid-style timestamp key
 *   startedAt — ISO timestamp
 *   segments  — confirmed DiarizedSegments
 *   summary   — AI-generated summary (null until generated)
 */

import type { DiarizedSegment } from './deepgram';

const STORAGE_KEY = 'eveng2-sessions';
const MAX_SESSIONS = 50; // cap to avoid filling localStorage

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  startedAt: string;
  segments: DiarizedSegment[];
  summary: string | null;
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Quota exceeded — drop oldest sessions and retry
    const trimmed = sessions.slice(-Math.floor(MAX_SESSIONS / 2));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  }
}

export function saveSession(session: Session): void {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    sessions[idx] = session;
  } else {
    sessions.push(session);
    // Keep only the most recent MAX_SESSIONS
    if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
  }
  saveSessions(sessions);
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
}

export function clearAllSessions(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Create a new session ID (timestamp-based). */
export function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
