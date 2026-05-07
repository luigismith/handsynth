// Owner: visualizer
//
// Pre-rendered CRT scanlines, blitted to the main canvas each frame. Drawing
// hundreds of horizontal lines per frame is wasteful; instead we render once
// into an offscreen `p5.Graphics`, then `image()` it tiled. A slow vertical
// drift is achieved by shifting the source-rect Y offset each frame (the
// pattern repeats every PATTERN_HEIGHT pixels).

import type p5 from 'p5';

const PATTERN_HEIGHT = 4; // 1px line + 3px gap, repeats vertically

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

  function rebuild(p: p5, w: number, _h: number): void {
    if (buf) buf.remove();
    // Buffer is exactly one pattern tall — we tile vertically at draw time.
    buf = p.createGraphics(w, PATTERN_HEIGHT);
    buf.noStroke();
    buf.clear();
    // 1px dark scanline at y=0.
    buf.fill(0, 0, 0, 38); // ~15% alpha
    buf.rect(0, 0, w, 1);
  }

  rebuild(p, width, height);

  return {
    resize(p: p5, w: number, h: number): void {
      rebuild(p, w, h);
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
