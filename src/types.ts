import type { DiarizedSegment } from './deepgram';

export type { DiarizedSegment };

/**
 * Snapshot passed from App → useGlasses → toDisplayData / onGlassAction.
 *
 * Reflects the spec's "pipeline state":
 *   idle        — no active session
 *   connecting  — Deepgram WS opening + G2 mic starting
 *   listening   — streaming audio, segments accumulating
 *   summarizing — session stopped, AI summary in progress
 *   error       — connection or mic failure
 */
export type AppMode = 'transcribe' | 'translate';

export interface AppSnapshot {
  sttState: 'idle' | 'connecting' | 'listening' | 'summarizing' | 'error';
  /** All confirmed (is_final) diarized segments for the session */
  segments: DiarizedSegment[];
  /** Live partial segments for the current utterance */
  interim: DiarizedSegment[];
  /** True when there is conversation history to display */
  hasContent: boolean;
  error: string | null;
  /** Number of selectable action items (for HIGHLIGHT_MOVE clamping) */
  numActions: number;
  /** AI-generated summary for the current session */
  summary: string | null;
  /** Active mode: Hebrew transcription or live Hebrew→Russian translation */
  mode: AppMode;
}
