/**
 * Even G2 — Hebrew Speech Recognition App
 *
 * Flow
 * ────
 * 1. Connect to the Even Hub bridge (waitForEvenAppBridge)
 * 2. Initialise the glasses display (idle state, "הקלט" action)
 * 3. User selects "הקלט" → microphone is enabled, PCM bytes are buffered
 * 4. User selects "עצור" (or MAX_RECORDING_SECONDS elapses) →
 *    a. Microphone disabled
 *    b. PCM bytes encoded as WAV
 *    c. Sent to OpenAI Whisper with language=he
 *    d. Transcription shown on display
 * 5. User can record again or clear the result
 *
 * Configuration
 * ─────────────
 * Copy .env.example → .env and set VITE_OPENAI_API_KEY before building.
 */

import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { pcmToWav, transcribeHebrew, TranscriptionError, MAX_PCM_BYTES } from './audio';
import { GlassesUI } from './ui';

// Injected at build-time by Vite (see .env / .env.example)
const OPENAI_API_KEY: string = import.meta.env['VITE_OPENAI_API_KEY'] ?? '';

// ---------------------------------------------------------------------------
// App controller
// ---------------------------------------------------------------------------

class HebrewSpeechApp {
  private pcmBuffer: number[] = [];
  private stopRequested = false;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly ui: GlassesUI,
  ) {}

  // ---------------------------------------------------------------------------
  // Recording lifecycle
  // ---------------------------------------------------------------------------

  private async startRecording(): Promise<void> {
    this.pcmBuffer = [];
    this.stopRequested = false;
    await this.ui.setRecording();
    await this.bridge.audioControl(true);
  }

  private async stopRecording(): Promise<void> {
    if (this.stopRequested) return;   // guard against double-stop
    this.stopRequested = true;

    await this.bridge.audioControl(false);
    await this.transcribeBuffer();
  }

  private async transcribeBuffer(): Promise<void> {
    await this.ui.setProcessing();

    if (this.pcmBuffer.length === 0) {
      await this.ui.setError('לא הוקלט שמע');
      return;
    }

    try {
      const wav = pcmToWav(this.pcmBuffer);
      const text = await transcribeHebrew(wav, OPENAI_API_KEY);
      await this.ui.setResult(text);
    } catch (err) {
      const message =
        err instanceof TranscriptionError
          ? err.message
          : `שגיאה: ${err instanceof Error ? err.message : String(err)}`;
      await this.ui.setError(message);
    }
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  /** Called for every event from the bridge. */
  async handleEvent(event: Parameters<Parameters<EvenAppBridge['onEvenHubEvent']>[0]>[0]): Promise<void> {
    // ── Audio PCM ──────────────────────────────────────────────────────────
    if (event.audioEvent?.audioPcm) {
      if (this.ui.getState() === 'recording' && !this.stopRequested) {
        const chunk = event.audioEvent.audioPcm as number[];
        this.pcmBuffer.push(...chunk);

        // Auto-stop when buffer reaches the max duration limit
        if (this.pcmBuffer.length >= MAX_PCM_BYTES) {
          await this.stopRecording();
        }
      }
    }

    // ── List selection ────────────────────────────────────────────────────
    if (event.listEvent != null) {
      const idx: number =
        typeof event.listEvent === 'object' && 'itemIndex' in event.listEvent
          ? (event.listEvent as { itemIndex: number }).itemIndex
          : 0;

      const state = this.ui.getState();

      if (state === 'idle' && idx === 0) {
        await this.startRecording();

      } else if (state === 'recording' && idx === 0) {
        await this.stopRecording();

      } else if (state === 'result' || state === 'error') {
        if (idx === 0) {
          // "הקלט שוב" / "הקלט"
          await this.ui.setIdle();
          await this.startRecording();
        } else if (idx === 1) {
          // "נקה"
          await this.ui.setIdle();
        }
      }
    }

    // ── System exit ───────────────────────────────────────────────────────
    if (event.sysEvent?.exit) {
      if (this.ui.getState() === 'recording') {
        await this.bridge.audioControl(false);
      }
      await this.bridge.shutDownPageContainer();
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    await this.ui.init();
    this.bridge.onEvenHubEvent((event) => {
      void this.handleEvent(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const bridge = await waitForEvenAppBridge();
  const ui = new GlassesUI(bridge);
  const app = new HebrewSpeechApp(bridge, ui);
  await app.start();
}

main().catch((err: unknown) => {
  console.error('[EvenG2-Hebrew] Fatal error:', err);
});
