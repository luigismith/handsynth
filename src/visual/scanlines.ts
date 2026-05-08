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

  function rebuild(p: p5, w: number, _h: number): void {
    if (buf) {
      try {
        buf.remove();
      } catch {
        // p5 v1 sometimes throws TypeError during Element.remove() when the
        // element has been detached from its parent's _elements array via
        // an HMR/resize race. The orphaned buffer will be GC'd; swallowing
        // the throw prevents the draw loop from being interrupted on every
        // frame (catastrophic FPS regression: 0.7 fps until silenced).
      }
    }
    // Buffer is exactly one pattern tall — we tile vertically at draw time.
    buf = p.createGraphics(w, PATTERN_HEIGHT);
    buf.noStroke();
    buf.clear();
    // 1px scanline at y=0. We use a neutral grey (GREY_DIM) at low alpha so
    // the scanlines darken without tinting the underlying image cyan or blue.
    // GREY_DIM in HSB is (240, 10, 42); rgba ≈ rgba(98, 100, 107, 0.18).
    // Using a HSB-to-RGB approx: at 18% alpha the line reads as a faint
    // graphite stripe.
    buf.fill(0, 0, 0, 46); // ~18% alpha black tint = GREY_DIM at low alpha
    buf.rect(0, 0, w, 1);
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
