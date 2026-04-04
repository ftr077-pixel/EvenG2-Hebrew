/**
 * Audio utilities for Even G2 Hebrew speech recognition.
 *
 * The Even Hub SDK delivers microphone audio as raw PCM bytes via
 * audioEvent.audioPcm.  This module collects those bytes, encodes them
 * as a standard WAV file, and sends the file to the OpenAI Whisper API
 * requesting Hebrew (he) transcription.
 *
 * Assumed PCM format delivered by the G2 SDK:
 *   - Sample rate : 16 000 Hz
 *   - Bit depth   : 16-bit signed, little-endian
 *   - Channels    : mono
 */

const SAMPLE_RATE = 16_000;
const BIT_DEPTH = 16;
const CHANNELS = 1;

// Hard limit so the Whisper request stays well below the 25 MB API cap.
export const MAX_RECORDING_SECONDS = 30;
export const MAX_PCM_BYTES = SAMPLE_RATE * (BIT_DEPTH / 8) * CHANNELS * MAX_RECORDING_SECONDS;

// ---------------------------------------------------------------------------
// PCM → WAV
// ---------------------------------------------------------------------------

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Wraps a raw PCM byte array in a WAV container (RIFF/WAVE format).
 * The caller is responsible for ensuring the bytes match SAMPLE_RATE,
 * BIT_DEPTH, and CHANNELS declared above.
 */
export function pcmToWav(pcmBytes: number[]): Blob {
  const byteRate = (SAMPLE_RATE * CHANNELS * BIT_DEPTH) / 8;
  const blockAlign = (CHANNELS * BIT_DEPTH) / 8;
  const dataSize = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);          // sub-chunk size (PCM = 16)
  view.setUint16(20, 1, true);           // AudioFormat: PCM = 1
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BIT_DEPTH, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM payload
  const dst = new Uint8Array(buffer, 44);
  pcmBytes.forEach((b, i) => { dst[i] = b; });

  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------
// Whisper transcription
// ---------------------------------------------------------------------------

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Sends a WAV blob to OpenAI Whisper and returns the Hebrew transcription.
 *
 * @param wavBlob  - WAV audio produced by pcmToWav()
 * @param apiKey   - OpenAI API key (VITE_OPENAI_API_KEY)
 * @returns        Transcribed text in Hebrew
 * @throws         TranscriptionError on API or network failure
 */
export async function transcribeHebrew(wavBlob: Blob, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new TranscriptionError(
      'מפתח API חסר — הגדר VITE_OPENAI_API_KEY בקובץ .env',
    );
  }

  const form = new FormData();
  form.append('file', wavBlob, 'recording.wav');
  form.append('model', 'whisper-1');
  form.append('language', 'he');          // force Hebrew
  form.append('response_format', 'json');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscriptionError(
      `שגיאת רשת: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      // ignore JSON parse errors
    }
    throw new TranscriptionError(
      `Whisper API נכשל (${res.status})${detail ? `: ${detail}` : ''}`,
      res.status,
    );
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
