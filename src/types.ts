/**
 * Shared snapshot type for the Hebrew speech app.
 * Passed to both toDisplayData() and onGlassAction() by useGlasses.
 */
export interface AppSnapshot {
  /** STT engine state */
  state: 'idle' | 'loading' | 'listening' | 'processing' | 'error';
  /** Accumulated final transcript */
  transcript: string;
  /** Current interim (partial) transcript from Deepgram */
  interimTranscript: string;
  /** Convenience flags derived from state */
  isListening: boolean;
  isLoading: boolean;
  /** Error message when state === 'error' */
  errorMsg: string | null;
  /** Number of selectable actions on the current screen (for HIGHLIGHT_MOVE clamping) */
  numActions: number;
}
