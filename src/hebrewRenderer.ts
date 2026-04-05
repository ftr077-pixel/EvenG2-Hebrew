/**
 * Hebrew image-based renderer for G2 glasses.
 *
 * Preloads Noto Sans Hebrew via FontFace API, then renders with canvas fillText.
 * Uses large bold white text for maximum visibility on the G2's small display.
 *
 * Canvas: 576×100 → 3 tiles (200×100, 200×100, 176×100).
 * At 20px font with 24px line height → 4 visible lines max.
 */

// @ts-ignore
import UPNG from 'upng-js';
import type { DisplayData } from 'even-toolkit';
import { dbg } from './debugLog';
import { HEBREW_FONT_B64 } from './hebrewFontData';

const CANVAS_W = 576;
const CANVAS_H = 100;

export const TILES = [
  { id: 2, name: 'tile-1', x: 0,   y: 0, w: 200, h: 100, crop: { sx: 0,   sw: 200 } },
  { id: 3, name: 'tile-2', x: 200, y: 0, w: 200, h: 100, crop: { sx: 200, sw: 200 } },
  { id: 4, name: 'tile-3', x: 400, y: 0, w: 200, h: 100, crop: { sx: 400, sw: 176 } },
];

const FONT_SIZE = 20;
const LINE_HEIGHT = 24;
const FONT_FAMILY = 'NotoHebrew';
const FONT = `bold ${FONT_SIZE}px '${FONT_FAMILY}', sans-serif`;

// ── Font preloading ──────────────────────────────────────────────────────────

let fontLoaded = false;
let fontLoadPromise: Promise<void> | null = null;

function preloadFont(): Promise<void> {
  if (fontLoaded) return Promise.resolve();
  if (fontLoadPromise) return fontLoadPromise;

  fontLoadPromise = (async () => {
    try {
      const fontUrl = `data:font/woff2;base64,${HEBREW_FONT_B64}`;
      const face = new FontFace(FONT_FAMILY, `url('${fontUrl}')`, {
        weight: 'normal',
        style: 'normal',
      });
      const loaded = await face.load();
      (document.fonts as any).add(loaded);
      fontLoaded = true;
      dbg.info('Hebrew font loaded');
    } catch (err) {
      dbg.warn(`Font load failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
      fontLoaded = true; // Continue with system fallback font
    }
  })();

  return fontLoadPromise;
}

// ── Canvas ───────────────────────────────────────────────────────────────────

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function ensureCanvas(): CanvasRenderingContext2D {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
  }
  if (!ctx) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    ctx = context;
  }
  return ctx;
}

// Reusable tile canvases — created once per tile width to avoid per-frame allocation
const tileCanvasCache = new Map<number, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();

function getTileCanvas(tw: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let cached = tileCanvasCache.get(tw);
  if (!cached) {
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = CANVAS_H;
    const context = c.getContext('2d');
    if (!context) throw new Error('Tile canvas 2D context unavailable');
    cached = { canvas: c, ctx: context };
    tileCanvasCache.set(tw, cached);
  }
  return cached;
}

/** Encode a region of the canvas to a 4-bit indexed greyscale PNG. */
function encodeTile(sx: number, tw: number): Uint8Array {
  const { ctx: tc } = getTileCanvas(tw);

  tc.fillStyle = '#000000';
  tc.fillRect(0, 0, tw, CANVAS_H);
  tc.drawImage(canvas!, sx, 0, tw, CANVAS_H, 0, 0, tw, CANVAS_H);

  const imgData = tc.getImageData(0, 0, tw, CANVAS_H);
  const pixels = imgData.data;
  const pc = tw * CANVAS_H;

  const buf = new Uint8Array(pc * 4);
  for (let i = 0; i < pc; i++) {
    const si = i * 4;
    const lum = Math.round(0.299 * pixels[si]! + 0.587 * pixels[si + 1]! + 0.114 * pixels[si + 2]!);
    const idx = Math.min(15, Math.round(lum / 17));
    const v = idx * 17;
    buf[si] = v; buf[si + 1] = v; buf[si + 2] = v; buf[si + 3] = 255;
  }

  const pngBuf = UPNG.encode([buf.buffer.slice(0, pc * 4) as ArrayBuffer], tw, CANVAS_H, 16);
  return new Uint8Array(pngBuf);
}

/**
 * Render DisplayData with large bold white Hebrew text on black background.
 */
export async function renderHebrewTiles(
  data: DisplayData,
): Promise<Array<{ id: number; name: string; bytes: Uint8Array }>> {
  await preloadFont();

  const c = ensureCanvas();

  // Clear to black
  c.fillStyle = '#000000';
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);

  c.font = FONT;
  c.textBaseline = 'top';

  let y = 2;
  let drawnLines = 0;

  for (const ln of data.lines) {
    if (y + LINE_HEIGHT > CANVAS_H) break;

    if (ln.style === 'separator') {
      c.fillStyle = '#666666';
      c.fillRect(6, y + LINE_HEIGHT / 2 - 1, CANVAS_W - 12, 2);
      y += LINE_HEIGHT;
      continue;
    }

    // Interim (active speech) — subtle underline indicator instead of blinding inverted bar
    if (ln.inverted) {
      c.fillStyle = '#888888';
      c.fillRect(CANVAS_W / 2, y + LINE_HEIGHT - 2, CANVAS_W / 2 - 6, 2);
    }

    // Text color — pure white for max contrast
    if (ln.style === 'meta') {
      c.fillStyle = '#bbbbbb';
    } else {
      c.fillStyle = '#ffffff';
    }

    const text = ln.text;
    if (text) {
      c.font = FONT;
      // Always draw from the left edge — tile 3 (rightmost) is partially
      // outside the G2's visible area, so left-aligning ensures the beginning
      // of every line is visible in tiles 1-2.
      c.fillText(text, 6, y);
      drawnLines++;
    }

    y += LINE_HEIGHT;
  }

  // Debug
  let nonBlack = 0;
  try {
    const check = c.getImageData(0, 0, CANVAS_W, CANVAS_H);
    for (let i = 0; i < check.data.length; i += 4) {
      if (check.data[i]! > 0 || check.data[i + 1]! > 0 || check.data[i + 2]! > 0) {
        nonBlack++;
      }
    }
  } catch (_) { /* ignore */ }

  dbg.info(`Draw: ${drawnLines} lines, ${nonBlack} px`);

  return TILES.map(t => ({
    id: t.id,
    name: t.name,
    bytes: encodeTile(t.crop.sx, t.crop.sw),
  }));
}
