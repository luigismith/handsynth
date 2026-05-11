// Owner: visualizer
//
// Pre-rendered CRT scanlines, blitted to the main canvas each frame. Drawing
// hundreds of horizontal lines per frame is wasteful; instead we render once
// into an offscreen `p5.Graphics`, then `image()` it tiled. A slow vertical
// drift is achieved by shifting the source-rect Y offset each frame (the
// pattern repeats every PATTERN_HEIGHT pixels).
//
// AESTHETIC (cyberpunk redesign):
// - PATTERN_HEIGHT 6 (was 16) for a denser CRT feel — 1px line every 6px.
//   At a 1280×608 backing buffer that's ~100 image() blits per frame, which
//   is still well within the perf budget.
// - Tear line: every 8–12s a 1px ORANGE_DARK horizontal line flashes for
//   ~80ms at a random vertical position. Tasteful glitch flair.

import type p5 from 'p5';

// 1px line every 6px — denser CRT pattern for the cyberpunk look.
const PATTERN_HEIGHT = 6;

// Tear-line constants. We pick a fresh y on each scheduled tear and hold it
// for ~80ms, then arm the next tear 8–12s later.
const TEAR_HOLD_MS = 80;
const TEAR_INTERVAL_MIN_MS = 8000;
const TEAR_INTERVAL_MAX_MS = 12000;

// ORANGE_DARK in HSB (matches the brief).
const TEAR_HUE = 18;
const TEAR_SAT = 95;
const TEAR_BRI = 78;
const TEAR_ALPHA = 0.85;

export interface ScanlineLayer {
  /** Resize the offscreen buffer; pattern is regenerated. */
  resize(p: p5, width: number, height: number): void;
  /** Composite the buffer over the canvas. */
  draw(p: p5, drift: number): void;
  /** Free the buffer. */
  dispose(): void;
}

export function createScanlineLayer(p: p5, width: number, height: number): ScanlineLayer {
  let buf: p5.Graphics | null = null;
  // Tear-line state. Time fields are in ms (performance.now()).
  let nextTearAt = performance.now() + randomTearDelay();
  let tearActiveUntil = 0;
  let tearY = 0;

  // BUG FIX (live capture v0.3.x): the earlier try/catch prevented the
  // crash but the old buffer stayed in p5's internal tracker every resize
  // because .remove() threw before completing. Cumulative leak per resize
  // tick → contributed to "rallenta sempre di più". Switched to reuse-via-
  // resizeCanvas, mirroring the vignette / hexGrid / horizon fixes.
  function paint(w: number): void {
    if (!buf) return;
    buf.clear();
    buf.noStroke();
    buf.fill(0, 0, 0, 46);
    buf.rect(0, 0, w, 1);
  }

  function rebuild(p: p5, w: number, _h: number): void {
    if (buf) {
      try {
        buf.resizeCanvas(w, PATTERN_HEIGHT);
        paint(w);
      } catch (e) {
        console.warn('[scanlines] resize repaint failed', e);
      }
      return;
    }
    buf = p.createGraphics(w, PATTERN_HEIGHT);
    paint(w);
  }

  rebuild(p, width, height);

  return {
    resize(p: p5, w: number, h: number): void {
      rebuild(p, w, h);
      // On resize, refresh the tear y so we don't end up off-canvas.
      tearY = Math.floor(Math.random() * h);
    },

    draw(p: p5, drift: number): void {
      if (!buf) return;
      // Drift in [0, PATTERN_HEIGHT). Tile rows top-down starting from -drift.
      const start = -((drift % PATTERN_HEIGHT) + PATTERN_HEIGHT) % PATTERN_HEIGHT;
      const w = p.width;
      const h = p.height;
      // Ensure no blend-mode bleed from the particle layer.
      p.push();
      p.blendMode(p.BLEND);
      for (let y = start; y < h; y += PATTERN_HEIGHT) {
        p.image(buf, 0, y, w, PATTERN_HEIGHT);
      }
      // Tear line: schedule + render. The cost when no tear is active is a
      // single performance.now() + comparison, so this stays cheap.
      const now = performance.now();
      if (now >= nextTearAt) {
        // Arm a new tear flash at a random vertical position.
        tearY = Math.floor(Math.random() * h);
        tearActiveUntil = now + TEAR_HOLD_MS;
        nextTearAt = now + randomTearDelay();
      }
      if (now < tearActiveUntil) {
        // Draw the tear: 1px ORANGE_DARK line. Caller's color mode is HSB so
        // we render directly without an offscreen buffer.
        p.noStroke();
        p.fill(TEAR_HUE, TEAR_SAT, TEAR_BRI, TEAR_ALPHA);
        p.rect(0, tearY, w, 1);
      }
      p.pop();
    },

    dispose(): void {
      if (buf) {
        buf.remove();
        buf = null;
      }
    },
  };
}

function randomTearDelay(): number {
  return TEAR_INTERVAL_MIN_MS + Math.random() * (TEAR_INTERVAL_MAX_MS - TEAR_INTERVAL_MIN_MS);
}
