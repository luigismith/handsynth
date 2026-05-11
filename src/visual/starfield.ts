// Owner: visualizer
//
// Parallax starfield + horizon glow. A handful of static-position stars at
// very low opacity, with a slow drift so the eye reads "deep space" instead
// of "static dots". The drift is driven by elapsed time, NOT by hands —
// hand-driven parallax adds vestibular fatigue.
//
// AESTHETIC (cyberpunk redesign):
// - Stars use GREY_DIM rather than blue-tinted near-white. They read as
//   ambient data points on a charcoal panel.
// - Horizon glow shifts from cool blue/violet to warm orange (ORANGE_DARK
//   at the bottom edge), forming a faint "city horizon" line beneath the
//   visualizer.
//
// Cost target: <0.1ms per frame. We keep this absurdly cheap by:
//   - Pre-allocating star positions once.
//   - Drawing them as plain circles (no glow stacking).
//   - Reading time from a passed-in `t` rather than computing wall-clock.

import type p5 from 'p5';

interface Star {
  /** Base position (without drift), in 0..1 normalized space. */
  x: number;
  y: number;
  /** Per-star radius in pixels (small — 0.5..1.8). */
  r: number;
  /** Per-star alpha (0..1). */
  alpha: number;
  /** Per-star drift speed multiplier (so they don't move uniformly). */
  speed: number;
}

export interface Starfield {
  draw(p: p5, t: number, width: number, height: number): void;
  /** Re-seed the field — useful on resize so density stays consistent. */
  reset(width: number, height: number): void;
}

const STAR_COUNT = 50;

export function createStarfield(_width: number, _height: number): Starfield {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.5 + Math.random() * 1.3,
      alpha: 0.08 + Math.random() * 0.18,
      speed: 0.3 + Math.random() * 0.7,
    });
  }

  return {
    reset(): void {
      // Stars don't really need re-seeding; their positions are normalized.
      // We could randomize again, but stability across resize feels nicer.
    },

    draw(p: p5, t: number, width: number, height: number): void {
      // HSB color mode set by sketch. Stars render as GREY_DIM (240, 10, 42)
      // so they fit the charcoal cyberpunk palette without competing with
      // the foreground orange skeleton.
      p.noStroke();
      for (const s of stars) {
        // Slow horizontal drift, wraps on screen width. Vertical position
        // stays fixed so we don't get vertical motion sickness.
        const driftX = ((t * s.speed * 8) % width + width) % width;
        const x = ((s.x * width + driftX) % width + width) % width;
        const y = s.y * height;
        p.fill(240, 10, 42, s.alpha);
        p.circle(x, y, s.r * 2);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Horizon glow — separate render path. Faint warm glow at the bottom of the
// screen. Pre-rendered into a p5.Graphics on construction; redrawn on resize.
// ---------------------------------------------------------------------------

export interface HorizonGlow {
  draw(p: p5, width: number, height: number, intensity: number): void;
  resize(p: p5, width: number, height: number): void;
  dispose(): void;
}

export function createHorizonGlow(p: p5, width: number, height: number): HorizonGlow {
  let buf: p5.Graphics | null = null;

  // BUG FIX (live capture v0.3.x): the previous `if (buf) buf.remove();
  // buf = p.createGraphics(...)` pattern leaked a p5.Graphics every
  // resize tick. p5.Element.remove() throws on stale parent ref →
  // old buffer stays in p5's internal tracker → unbounded canvas
  // memory growth → user's reported "rallenta sempre di più".
  //
  // Fix mirror of vignette/hexGrid in sketch.ts: paint the contents
  // separately and reuse the buffer on resize via resizeCanvas + repaint.
  function paint(w: number, h: number): void {
    if (!buf) return;
    buf.clear();
    buf.colorMode(p.HSB, 360, 100, 100, 1);
    buf.noStroke();
    const startY = h * 0.72;
    const steps = 32;
    const stepH = (h - startY) / steps;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const hue = 22 - t * 4;
      const sat = 90 - t * 10;
      const bri = 6 + t * 16;
      const alpha = Math.pow(t, 1.6) * 0.55;
      buf.fill(hue, sat, bri, alpha);
      buf.rect(0, startY + i * stepH, w, stepH + 1);
    }
  }

  buf = p.createGraphics(width, height);
  paint(width, height);

  return {
    resize(_p: p5, w: number, h: number): void {
      if (!buf) return;
      try {
        buf.resizeCanvas(w, h);
        paint(w, h);
      } catch (e) {
        console.warn('[horizon] resize failed', e);
      }
    },
    draw(p: p5, w: number, h: number, intensity: number): void {
      if (!buf) return;
      // intensity is 0..1; allow up to 1.2 for beat-driven boost. Tint via
      // p5's image tint if intensity != 1.
      p.push();
      p.blendMode(p.BLEND);
      if (intensity >= 0.99 && intensity <= 1.01) {
        p.image(buf, 0, 0, w, h);
      } else {
        // tint() with HSB color mode; use brightness as the channel.
        p.tint(0, 0, 100, Math.min(1, intensity));
        p.image(buf, 0, 0, w, h);
        p.noTint();
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
