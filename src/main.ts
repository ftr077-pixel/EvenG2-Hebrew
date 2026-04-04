/**
 * Even G2 — Hebrew Speech Recognition App (Deepgram)
 *
 * Flow
 * ────
 * 1. Connect to the Even Hub bridge (waitForEvenAppBridge)
 * 2. Initialise the glasses display (idle state, "הקלט" action)
 * 3. User selects "הקלט":
 *    a. Open Deepgram streaming WebSocket (nova-2, language=he)
 *    b. Enable G2 microphone
 *    c. PCM chunks are forwarded to Deepgram in real-time
 *    d. Interim Hebrew transcripts appear on the glasses display live
 * 4. User selects "עצור" (or 30 s elapses):
 *    a. Microphone disabled
 *    b. CloseStream sent to Deepgram; final transcript collected
 *    c. Result shown on display
 * 5. User can record again or clear
 *
 * Configuration
 * ─────────────
 * Copy .env.example → .env and set VITE_DEEPGRAM_API_KEY before building.
 */

import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { DeepgramStreamer, DeepgramError, MAX_RECORDING_SECONDS } from './audio';
import { GlassesUI } from './ui';

const DEEPGRAM_API_KEY: string = import.meta.env['VITE_DEEPGRAM_API_KEY'] ?? '';

// ---------------------------------------------------------------------------
// App controller
// ---------------------------------------------------------------------------

class HebrewSpeechApp {
  private streamer: DeepgramStreamer | null = null;
  private stopRequested = false;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bridge: EvenAppBridge,
    private readonly ui: GlassesUI,
  ) {}

  // ---------------------------------------------------------------------------
  // Recording lifecycle
  // ---------------------------------------------------------------------------

  private async startRecording(): Promise<void> {
    this.stopRequested = false;

    // Create and connect the Deepgram streamer before enabling the mic so
    // audio chunks don't arrive before the WebSocket is ready.
    const s = new DeepgramStreamer();
    s.onInterim = (text) => { this.ui.setInterimText(text); };

    try {
      await s.connect(DEEPGRAM_API_KEY);
    } catch (err) {
      const msg = err instanceof DeepgramError
        ? err.message
        : `שגיאת חיבור: ${err instanceof Error ? err.message : String(err)}`;
      await this.ui.setError(msg);
      return;
    }

    this.streamer = s;

    // Auto-stop after MAX_RECORDING_SECONDS
    this.autoStopTimer = setTimeout(() => { void this.stopRecording(); }, MAX_RECORDING_SECONDS * 1_000);

    await this.ui.setRecording();
    await this.bridge.audioControl(true);
  }

  private async stopRecording(): Promise<void> {
    if (this.stopRequested) return;
    this.stopRequested = true;

    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    await this.bridge.audioControl(false);
    await this.ui.setProcessing();

    let text = '';
    try {
      text = (await this.streamer?.finish()) ?? '';
    } catch (err) {
      const msg = err instanceof DeepgramError
        ? err.message
        : `שגיאה: ${err instanceof Error ? err.message : String(err)}`;
      await this.ui.setError(msg);
      this.streamer = null;
      return;
    }

    this.streamer = null;
    await this.ui.setResult(text);
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  async handleEvent(
    event: Parameters<Parameters<EvenAppBridge['onEvenHubEvent']>[0]>[0],
  ): Promise<void> {
    // ── Audio PCM → forward to Deepgram ───────────────────────────────────
    if (event.audioEvent?.audioPcm) {
      if (this.ui.getState() === 'recording' && !this.stopRequested) {
        this.streamer?.sendPcm(event.audioEvent.audioPcm as number[]);
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
          await this.ui.setIdle();
          await this.startRecording();
        } else if (idx === 1) {
          await this.ui.setIdle();
        }
      }
    }

    // ── System exit ───────────────────────────────────────────────────────
    if (event.sysEvent?.exit) {
      if (this.ui.getState() === 'recording') {
        await this.bridge.audioControl(false);
        this.streamer?.finish().catch(() => undefined);
      }
      await this.bridge.shutDownPageContainer();
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    await this.ui.init();
    this.bridge.onEvenHubEvent((event) => { void this.handleEvent(event); });
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
