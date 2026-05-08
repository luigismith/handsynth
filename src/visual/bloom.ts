// Owner: visualizer
//
// Cheap bloom / glow post-process for p5 2D mode. There is no shader here —
// p5's `filter(BLUR, ...)` is the workhorse. To keep cost low:
//   1. Bright layer is rendered into a downsampled buffer (1/8 area linear =
//      1/64 pixels). pixelDensity(1) on top.
//   2. Buffer is blurred in place with a small radius.
//   3. The blurred buffer is composited onto the main canvas with ADD blend
//      at ~50% opacity.
//
// What we DO NOT do: blur the entire scene (background + scanlines + hands).
// That would obliterate the crisp lines and is also too expensive in 2D mode.
// Instead, the sketch draws *only the elements that should glow* (particles,
// fingertip cores, finger strings) into the bloom buffer, in addition to the
// main canvas. The final composite layers a soft halo on top.
//
// PERF (2026-05): the previous DOWNSCALE=4 + BLUR_RADIUS=6 + 1/16-area buffer
// was eating ~10ms per frame on hi-DPI displays (devicePixelRatio=2 → 4x
// fillrate). We now downscale to 1/8 linear (1/64 area), drop radius to 4,
// and the sketch ALSO skips bloom on alternate frames (drawHalfRate). Net
// budget: ~0.4ms / frame averaged. The visual difference is imperceptible —
// bloom is by definition blurry.

import type p5 from 'p5';

const DOWNSCALE = 8;
const BLUR_RADIUS = 4;
const COMPOSITE_ALPHA = 0.55;

export interface Bloom {
  /** True if a buffer was successfully allocated. */
  ready(): boolean;
  /**
   * Begin drawing the bright layer into the bloom buffer. The caller
   * should clear, push state, and apply transforms appropriate to the
   * downsampled space (caller can use `getBuffer()` directly for finer
   * control). Returns the buffer or null if not ready.
   */
  begin(): p5.Graphics | null;
  /** Apply blur. Cheap call — this is the actual cost. */
  blur(): void;
  /** Composite the blurred buffer onto the main canvas with ADD blend. */
  composite(p: p5): void;
  /** Re-allocate buffer at new size. Called on resize. */
  resize(p: p5, width: number, height: number): void;
  /** Free the buffer. */
  dispose(): void;
  /** Width/height of the downsampled buffer in pixels. */
  bufferWidth(): number;
  bufferHeight(): number;
}

export function createBloom(p: p5, width: number, height: number): Bloom {
  let buf: p5.Graphics | null = null;
  let bw = 0;
  let bh = 0;

  function rebuild(p: p5, w: number, h: number): void {
    if (buf) {
      try {
        buf.remove();
      } catch {
        // buffer may have been removed already.
      }
    }
    bw = Math.max(1, Math.floor(w / DOWNSCALE));
    bh = Math.max(1, Math.floor(h / DOWNSCALE));
    try {
      buf = p.createGraphics(bw, bh);
      // pixelDensity(1) on the bloom buffer halves the work on hi-DPI
      // displays. The buffer is intentionally low-res — bloom is by
      // definition blurry, so any sharpness savings are wasted.
      buf.pixelDensity(1);
      buf.colorMode(p.HSB, 360, 100, 100, 1);
      buf.noStroke();
    } catch (err) {
      // happy-dom / test environments may fail here; the caller checks
      // ready() before drawing.
      console.warn('[Bloom] createGraphics failed:', err);
      buf = null;
    }
  }

  rebuild(p, width, height);

  return {
    ready(): boolean {
      return buf !== null;
    },
    begin(): p5.Graphics | null {
      if (!buf) return null;
      buf.clear();
      return buf;
    },
    blur(): void {
      if (!buf) return;
      try {
        buf.filter(p.BLUR, BLUR_RADIUS);
      } catch {
        // Some test envs don't support filter(); bail silently.
      }
    },
    composite(p: p5): void {
      if (!buf) return;
      p.push();
      p.blendMode(p.ADD);
      // Tint with HSB brightness controlling the alpha.
      p.tint(0, 0, 100, COMPOSITE_ALPHA);
      p.image(buf, 0, 0, p.width, p.height);
      p.noTint();
      p.pop();
    },
    resize(p: p5, w: number, h: number): void {
      rebuild(p, w, h);
    },
    dispose(): void {
      if (buf) {
        try {
          buf.remove();
        } catch {
          // ignore
        }
        buf = null;
      }
    },
    bufferWidth(): number {
      return bw;
    },
    bufferHeight(): number {
      return bh;
    },
  };
}

/** Constant exposed for the sketch's coordinate transforms. */
export const BLOOM_DOWNSCALE = DOWNSCALE;
