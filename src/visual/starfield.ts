// Owner: visualizer
//
// Parallax starfield + horizon glow. A handful of static-position stars at
// very low opacity, with a slow drift so the eye reads "deep space" instead
// of "static dots". The drift is driven by elapsed time, NOT by hands —
// hand-driven parallax adds vestibular fatigue.
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
      // HSB color mode set by sketch. Stars are near-white with a faint
      // blue tint so they don't fight the cool palette.
      p.noStroke();
      for (const s of stars) {
        // Slow horizontal drift, wraps on screen width. Vertical position
        // stays fixed so we don't get vertical motion sickness.
        const driftX = ((t * s.speed * 8) % width + width) % width;
        const x = ((s.x * width + driftX) % width + width) % width;
        const y = s.y * height;
        p.fill(220, 8, 100, s.alpha);
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

  function rebuild(p: p5, w: number, h: number): void {
    if (buf) buf.remove();
    buf = p.createGraphics(w, h);
    buf.colorMode(p.HSB, 360, 100, 100, 1);
    buf.noStroke();
    // Gradient via stacked thin rects from y = 70%h to y = h.
    const startY = h * 0.7;
    const steps = 32;
    const stepH = (h - startY) / steps;
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      // Hue 230 (deep blue) → 245 (slight violet at bottom). Brightness ramps
      // from 8% to 22%. Alpha 0 → ~0.6.
      const hue = 230 + t * 15;
      const bri = 8 + t * 14;
      const alpha = Math.pow(t, 1.4) * 0.6;
      buf.fill(hue, 70, bri, alpha);
      buf.rect(0, startY + i * stepH, w, stepH + 1);
    }
  }

  rebuild(p, width, height);

  return {
    resize(p: p5, w: number, h: number): void {
      rebuild(p, w, h);
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
