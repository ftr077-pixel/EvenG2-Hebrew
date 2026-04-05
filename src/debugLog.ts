/**
 * Debug logger — stores log entries in memory so they can be
 * rendered on the phone Dashboard for on-device debugging.
 */

export interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const MAX_ENTRIES = 100;
const entries: LogEntry[] = [];
const listeners: Array<() => void> = [];

// Stable snapshot for useSyncExternalStore — only changes when entries change
let snapshot: LogEntry[] = [];

function now(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

function push(level: LogEntry['level'], message: string) {
  const entry: LogEntry = { time: now(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  // Create new snapshot reference so React knows it changed
  snapshot = [...entries];
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[DBG ${entry.time}] ${message}`);
  for (const cb of listeners) cb();
}

export const dbg = {
  info: (msg: string) => push('info', msg),
  warn: (msg: string) => push('warn', msg),
  error: (msg: string) => push('error', msg),
  getEntries: () => snapshot,
  subscribe: (cb: () => void) => {
    listeners.push(cb);
    return () => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  },
};
