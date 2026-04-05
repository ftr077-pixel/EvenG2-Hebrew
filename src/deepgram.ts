/**
 * useDiarizedSTT — Deepgram streaming + speaker diarization for Even G2.
 *
 * Implements the spec's "AI Core" layer directly in the Even Hub WebView:
 *
 *   Audio capture  → GlassBridgeSource (G2's 4-mic array via Even Hub bridge)
 *   Transport      → Float32→Int16 PCM streamed to Deepgram WebSocket
 *   ASR            → Deepgram nova-3, language=he, diarize=true
 *   Diarization    → per-word speaker IDs grouped into DiarizedSegments
 *   VAD            → utterance_end_ms=1500 (Deepgram server-side)
 *
 * Speaker mapping (acoustic diarization only — no lip/camera tracking):
 *   speaker 0  → assumed to be the G2 wearer (closest to mic array)
 *   speaker 1+ → external speakers
 *
 * The hook is continuous: it keeps recording until stop() is called,
 * accumulating segments across the entire conversation session.
 */

import { useCallback, useRef, useState } from 'react';
import { GlassBridgeSource } from 'even-toolkit/stt';
import { dbg } from './debugLog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiarizedSegment {
  /** 0 = wearer (אני), 1+ = external speakers (ד2, ד3…) */
  speaker: number;
  text: string;
  timestamp: number;
}

type STTState = 'idle' | 'connecting' | 'listening' | 'error';

export interface UseDiarizedSTTReturn {
  sttState: STTState;
  /** Confirmed (is_final) diarized segments for the whole session */
  segments: DiarizedSegment[];
  /** Live partial segments for the current utterance */
  interim: DiarizedSegment[];
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Deepgram response shapes
// ---------------------------------------------------------------------------

interface DGWord {
  word: string;
  speaker?: number;
  punctuated_word?: string;
}

interface DGResult {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: Array<{ words?: DGWord[] }> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group consecutive same-speaker words into DiarizedSegments. */
function wordsToSegments(words: DGWord[]): DiarizedSegment[] {
  const out: DiarizedSegment[] = [];
  const now = Date.now();
  let spk = -1;
  let buf: string[] = [];

  const flush = () => {
    if (spk >= 0 && buf.length > 0) {
      out.push({ speaker: spk, text: buf.join(' '), timestamp: now });
      buf = [];
    }
  };

  for (const w of words) {
    const s = w.speaker ?? 0;
    const t = w.punctuated_word ?? w.word;
    if (s !== spk) { flush(); spk = s; }
    buf.push(t);
  }
  flush();
  return out;
}

/** Convert Float32 PCM (-1..1) → Int16 for Deepgram linear16 encoding. */
let reusableI16: Int16Array | null = null;
function f32ToI16(f32: Float32Array): Int16Array {
  if (!reusableI16 || reusableI16.length < f32.length) {
    reusableI16 = new Int16Array(f32.length);
  }
  for (let i = 0; i < f32.length; i++) {
    reusableI16[i] = Math.round(Math.max(-1, Math.min(1, f32[i])) * 32767);
  }
  return reusableI16;
}

const DG_PARAMS = new URLSearchParams({
  model: 'nova-3',
  language: 'he',             // Primary language: Hebrew
  detect_language: 'true',    // Also detect other languages automatically
  diarize: 'true',          // Speaker separation (acoustic only)
  encoding: 'linear16',
  sample_rate: '16000',
  channels: '1',
  interim_results: 'true',  // Live partial transcripts
  punctuate: 'true',
  smart_format: 'true',
  utterance_end_ms: '1500', // VAD: fire is_final after 1.5 s silence
}).toString();

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDiarizedSTT(apiKey: string): UseDiarizedSTTReturn {
  const [sttState, setSttState] = useState<STTState>('idle');
  const [segments, setSegments] = useState<DiarizedSegment[]>([]);
  const [interim, setInterim] = useState<DiarizedSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef    = useRef<WebSocket | null>(null);
  const sourceRef = useRef<GlassBridgeSource | null>(null);
  const unsubRef  = useRef<(() => void) | null>(null);
  const activeRef = useRef(false);

  // ── Teardown helpers ──────────────────────────────────────────────────────

  const closeSource = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    sourceRef.current?.stop();
    sourceRef.current = null;
  }, []);

  const closeWs = useCallback((ws: WebSocket | null) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    if (ws.readyState === WebSocket.OPEN) {
      // Ask Deepgram to flush remaining audio before closing
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      setTimeout(() => { if (ws.readyState !== WebSocket.CLOSED) ws.close(); }, 2_000);
    } else {
      ws.close();
    }
  }, []);

  // ── stop ─────────────────────────────────────────────────────────────────

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    closeSource();
    closeWs(wsRef.current);
    wsRef.current = null;
    setInterim([]);
    setSttState('idle');
  }, [closeSource, closeWs]);

  // ── reset ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    stop();
    setSegments([]);
    setError(null);
  }, [stop]);

  // ── start ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    if (activeRef.current) return;

    setError(null);
    setSttState('connecting');
    dbg.info('=== STT START ===');
    dbg.info(`API key: ${apiKey ? 'present' : 'MISSING'}`);
    dbg.info(`UA: ${navigator.userAgent.slice(0, 80)}`);
    dbg.info(`Bridge: ${!!((window as unknown) as Record<string, unknown>).__evenBridge}`);

    if (!apiKey) {
      dbg.error('No API key');
      setError('Missing Deepgram key');
      setSttState('error');
      return;
    }

    // WebSocket to Deepgram
    dbg.info('Connecting WebSocket to Deepgram...');
    let ws: WebSocket;
    const wsUrl = `wss://api.deepgram.com/v1/listen?${DG_PARAMS}`;
    try {
      const t0 = Date.now();
      ws = await new Promise<WebSocket>((resolve, reject) => {
        let settled = false;
        const sock = new WebSocket(wsUrl, ['token', apiKey]);
        const timer = setTimeout(() => {
          if (!settled) { settled = true; dbg.error(`WS TIMEOUT 10s (state=${sock.readyState})`); sock.close(); reject(new Error('WS timeout')); }
        }, 10000);
        sock.onopen = () => {
          if (!settled) { settled = true; clearTimeout(timer); dbg.info(`WS OPEN (${Date.now() - t0}ms)`); resolve(sock); }
        };
        sock.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timer); dbg.error(`WS ERROR (${Date.now() - t0}ms)`); reject(new Error('WS error')); }
        };
        sock.onclose = (ev) => {
          if (!settled) { settled = true; clearTimeout(timer); dbg.error(`WS CLOSED code=${ev.code} (${Date.now() - t0}ms)`); reject(new Error(`WS closed ${ev.code}`)); }
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      dbg.error(`WS failed: ${msg}`);
      setError(`Deepgram: ${msg}`);
      setSttState('error');
      return;
    }

    wsRef.current = ws;
    dbg.info('WS connected OK');

    ws.onmessage = (ev: MessageEvent<string>) => {
      let data: DGResult;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type !== 'Results') return;
      const words = data.channel?.alternatives?.[0]?.words ?? [];
      if (words.length === 0) return;
      const segs = wordsToSegments(words);
      if (data.is_final) { setSegments(prev => [...prev, ...segs]); setInterim([]); }
      else { setInterim(segs); }
    };

    ws.onclose = (ev) => {
      dbg.warn(`WS closed: code=${ev.code} reason=${ev.reason}`);
      if (activeRef.current) { activeRef.current = false; closeSource(); wsRef.current = null; setInterim([]); setSttState('idle'); }
    };

    ws.onerror = () => {
      dbg.error('WS error during session');
      if (activeRef.current) {
        activeRef.current = false;
        closeSource();
        wsRef.current = null;
        setInterim([]);
        setError('WebSocket connection lost');
        setSttState('error');
      }
    };

    // Start mic
    dbg.info('Starting GlassBridgeSource...');
    const source = new GlassBridgeSource();
    try {
      await source.start();
      dbg.info('Mic started OK');
    } catch (e: unknown) {
      dbg.error(`Mic FAIL: ${e instanceof Error ? e.message : String(e)}`);
      closeWs(ws); wsRef.current = null;
      setError(`Mic: ${e instanceof Error ? e.message : 'failed'}`);
      setSttState('error');
      return;
    }

    sourceRef.current = source;
    activeRef.current = true;

    let chunks = 0;
    unsubRef.current = source.onAudioData((pcm: Float32Array) => {
      if (ws.readyState === WebSocket.OPEN) {
        const i16 = f32ToI16(pcm);
        ws.send(new Uint8Array(i16.buffer, 0, pcm.length * 2));
        chunks++;
        if (chunks === 1) dbg.info('First audio chunk sent');
        if (chunks % 1000 === 0) dbg.info(`Audio chunks: ${chunks}`);
      }
    });

    dbg.info('LISTENING');
    setSttState('listening');
  }, [apiKey, closeSource, closeWs]);

  return { sttState, segments, interim, error, start, stop, reset };
}
