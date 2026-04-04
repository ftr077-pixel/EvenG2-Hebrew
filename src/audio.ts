/**
 * Deepgram streaming transcription for Even G2 Hebrew speech recognition.
 *
 * Uses Deepgram's real-time WebSocket API so Hebrew text appears on the
 * glasses display live as the user speaks — no waiting until recording ends.
 *
 * PCM format assumed from the G2 SDK:
 *   - Sample rate : 16 000 Hz
 *   - Bit depth   : 16-bit signed, little-endian
 *   - Channels    : mono
 *
 * Browser auth: Deepgram accepts the API key as a WebSocket sub-protocol
 * ("token", apiKey) because browsers cannot set custom HTTP headers on WS.
 */

export const MAX_RECORDING_SECONDS = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
}

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: DeepgramAlternative[] };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class DeepgramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepgramError';
  }
}

// ---------------------------------------------------------------------------
// Streamer
// ---------------------------------------------------------------------------

/**
 * Opens a Deepgram streaming WebSocket, forwards PCM audio chunks, and
 * exposes interim transcripts via onInterim.
 *
 * Usage:
 *   const s = new DeepgramStreamer();
 *   s.onInterim = (text) => ui.setInterimText(text);
 *   await s.connect(apiKey);
 *   // …send chunks…
 *   const finalText = await s.finish();
 */
export class DeepgramStreamer {
  /** Called with the running transcript on every Deepgram Results event. */
  onInterim: (text: string) => void = () => undefined;

  private ws: WebSocket | null = null;
  private confirmed = '';   // accumulated is_final segments

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  connect(apiKey: string): Promise<void> {
    if (!apiKey) {
      return Promise.reject(
        new DeepgramError('מפתח Deepgram חסר — הגדר VITE_DEEPGRAM_API_KEY בקובץ .env'),
      );
    }

    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        model: 'nova-2',
        language: 'he',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true',
        punctuate: 'true',
        smart_format: 'true',
      });

      // Deepgram browser auth: pass token as WebSocket sub-protocol
      this.ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params.toString()}`,
        ['token', apiKey],
      );
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => resolve();
      this.ws.onerror = () =>
        reject(new DeepgramError('חיבור ל-Deepgram נכשל — בדוק את מפתח ה-API וחיבור הרשת'));
      this.ws.onmessage = (ev: MessageEvent<string>) => this.handleMessage(ev);
    });
  }

  // ---------------------------------------------------------------------------
  // Send PCM
  // ---------------------------------------------------------------------------

  /** Forward a raw PCM byte chunk from the G2 microphone to Deepgram. */
  sendPcm(bytes: number[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(new Uint8Array(bytes));
    }
  }

  // ---------------------------------------------------------------------------
  // Finish
  // ---------------------------------------------------------------------------

  /**
   * Signals end-of-stream, waits for Deepgram to flush remaining audio,
   * and returns the complete final transcript.
   */
  finish(): Promise<string> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve(this.confirmed);
        return;
      }

      // Resolve once the server closes the connection (or after timeout).
      const done = () => resolve(this.confirmed);
      const timer = setTimeout(done, 5_000);

      this.ws.addEventListener('close', () => {
        clearTimeout(timer);
        done();
      });

      try {
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        clearTimeout(timer);
        done();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Internal message handler
  // ---------------------------------------------------------------------------

  private handleMessage(ev: MessageEvent<string>): void {
    let data: DeepgramResult;
    try {
      data = JSON.parse(ev.data) as DeepgramResult;
    } catch {
      return;
    }

    if (data.type !== 'Results') return;

    const transcript = data.channel?.alternatives?.[0]?.transcript ?? '';

    if (data.is_final && transcript) {
      // Append to the confirmed transcript
      this.confirmed = this.confirmed
        ? `${this.confirmed} ${transcript}`
        : transcript;
    }

    // Emit running display: confirmed finals + current partial (if any)
    const partial = data.is_final ? '' : transcript;
    const display = partial
      ? `${this.confirmed} ${partial}`.trim()
      : this.confirmed;

    if (display) this.onInterim(display);
  }
}
