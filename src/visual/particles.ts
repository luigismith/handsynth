// Owner: visualizer
//
// FFT-reactive particle field. Reuses object pools — no per-frame allocation.
//
// The pool size is fixed at construction (`MAX_PARTICLES`). Each particle has
// position, velocity, hue, life, and size. High-frequency FFT energy emits
// new particles by re-incarnating dead slots from the pool; mid-frequency
// energy displaces them outward; low-frequency energy pulses their size.
//
// POLISH (round 2):
// - Explicit palette stops so particles aren't a single hue blur. Each
//   particle picks a base color at spawn and keeps it for its full life
//   (no per-frame jittering). Colors are tied to which FFT band emitted
//   the particle: low → blue, mid → cyan, high → warm accent (rare).
// - Alpha follows a life curve (fade-in 100ms, hold, fade-out) instead of
//   a flat linear ramp. Feels more like actual emissive sparks.
// - Reduced-motion mode: half count, slower velocities, no warm accents.

import type p5 from 'p5';

export interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0..1, multiplied by base size at draw time. */
  size: number;
  /** Hue in 0..360 (we use HSB color mode in the sketch wrapper). */
  hue: number;
  /** Saturation 0..100, fixed at spawn. */
  sat: number;
  /** 0..1, decays each frame. */
  life: number;
  /** Initial life so we can fade alpha from full. */
  life0: number;
}

export interface ParticleField {
  /** Step the simulation forward one frame. */
  update(args: {
    fft: Uint8Array;
    width: number;
    height: number;
    dt: number;
  }): void;
  /** Draw the field. Caller is responsible for blend modes. */
  draw(p: p5): void;
  /** Reset the field — useful on resize so particles don't get stranded. */
  reset(width: number, height: number): void;
  /** Toggle reduced-motion. Must be cheap; called rarely. */
  setReducedMotion(reduced: boolean): void;
}

const MAX_PARTICLES = 120;
const BASE_SIZE = 4;

// Explicit palette stops as HSB triples so particles have a distinct identity.
//   - cool blue   (#3a82c8 ≈ HSB 210, 71, 78)
//   - cyan glow   (#6cf0ff ≈ HSB 188, 58, 100)
//   - warm accent (#ffd47e ≈ HSB 40,  51, 100) — rare, only on high energy
//   - violet      (#aa5cff ≈ HSB 268, 64, 100)
const PALETTE_LOW = { hue: 210, sat: 70 } as const;
const PALETTE_MID = { hue: 188, sat: 58 } as const;
const PALETTE_HIGH_WARM = { hue: 40, sat: 55 } as const;
const PALETTE_HIGH_VIOLET = { hue: 268, sat: 60 } as const;

// FFT band ranges — analyser is 1024 bins by AudioEngine spec, but we read
// whatever buffer length we're given. Assume a standard 1024-bin layout.
const LOW_BAND_START = 0;
const LOW_BAND_END = 20;
const MID_BAND_START = 20;
const MID_BAND_END = 80;
const HIGH_BAND_START = 80;
const HIGH_BAND_END = 160;

function bandEnergy(fft: Uint8Array, start: number, end: number): number {
  const lo = Math.min(start, fft.length);
  const hi = Math.min(end, fft.length);
  if (hi <= lo) return 0;
  let sum = 0;
  for (let i = lo; i < hi; i += 1) sum += fft[i] ?? 0;
  return sum / ((hi - lo) * 255); // 0..1
}

/**
 * Life-curve envelope: 100ms fade-in, hold, 200ms fade-out.
 * Returns alpha multiplier in 0..1.
 *
 * `lifeFrac` is age/life0 inverted — i.e. it goes 0 → 1 over life.
 *   - First 8% of life: ramp 0 → 1 (fade-in)
 *   - Middle: 1 (hold)
 *   - Last 25% of life: ramp 1 → 0 (fade-out)
 */
function lifeEnvelope(lifeFrac: number): number {
  // lifeFrac is "fraction of life remaining" — convert to "age" for clarity.
  const age = 1 - lifeFrac;
  const fadeIn = 0.08;
  const fadeOut = 0.25;
  if (age < fadeIn) return age / fadeIn;
  if (age > 1 - fadeOut) return (1 - age) / fadeOut;
  return 1;
}

export function createParticleField(width: number, height: number): ParticleField {
  const pool: Particle[] = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      hue: PALETTE_LOW.hue,
      sat: PALETTE_LOW.sat,
      life: 0,
      life0: 1,
    });
  }
  // Seed half the pool so the field is alive immediately even before audio.
  let cw = width;
  let ch = height;
  let reducedMotion = false;
  seedAmbient(pool, cw, ch, MAX_PARTICLES / 2);

  function spawn(
    cx: number,
    cy: number,
    palette: { hue: number; sat: number },
    life: number,
    speedScale: number,
  ): void {
    const slot = pool.find((p) => !p.alive);
    if (!slot) return;
    slot.alive = true;
    slot.x = cx;
    slot.y = cy;
    const angle = Math.random() * Math.PI * 2;
    const speed = (20 + Math.random() * 60) * speedScale;
    slot.vx = Math.cos(angle) * speed;
    slot.vy = Math.sin(angle) * speed;
    slot.size = 0.6 + Math.random() * 0.8;
    // Slight per-particle hue jitter so the palette feels organic, not banded.
    slot.hue = palette.hue + (Math.random() - 0.5) * 12;
    slot.sat = palette.sat + (Math.random() - 0.5) * 10;
    slot.life = life;
    slot.life0 = life;
  }

  return {
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },

    reset(width: number, height: number): void {
      cw = width;
      ch = height;
      for (const p of pool) p.alive = false;
      seedAmbient(pool, cw, ch, MAX_PARTICLES / 2);
    },

    update({ fft, width, height, dt }): void {
      cw = width;
      ch = height;

      const low = bandEnergy(fft, LOW_BAND_START, LOW_BAND_END);
      const mid = bandEnergy(fft, MID_BAND_START, MID_BAND_END);
      const high = bandEnergy(fft, HIGH_BAND_START, HIGH_BAND_END);

      const cx = width * 0.5;
      const cy = height * 0.5;
      const speedScale = reducedMotion ? 0.5 : 1;
      const emitMax = reducedMotion ? MAX_PARTICLES * 0.4 : MAX_PARTICLES;

      // Live count check used both for cap and for ambient top-up.
      let aliveCount = 0;
      for (const p of pool) if (p.alive) aliveCount += 1;

      // High-band sparkle: probabilistic emission from center. Color depends
      // on which band is loudest — gives the field a "follows the music"
      // texture instead of one constant blue cloud.
      if (aliveCount < emitMax) {
        const sparkleP = high * 0.9;
        const emits = Math.floor(sparkleP * 3 + Math.random() * sparkleP * 2);
        for (let i = 0; i < emits; i += 1) {
          // 80% violet, 20% rare warm accent (skip warm in reduced-motion).
          const palette =
            !reducedMotion && Math.random() < 0.2
              ? PALETTE_HIGH_WARM
              : PALETTE_HIGH_VIOLET;
          spawn(cx, cy, palette, 1.2 + Math.random() * 0.8, speedScale);
        }
      }

      // Update each live particle.
      const lowPulse = 1 + low * 1.5; // size multiplier
      const midPush = mid * (reducedMotion ? 80 : 200); // outward acceleration scale
      const drag = Math.exp(-dt * 0.6); // velocity drag

      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i]!;
        if (!p.alive) continue;

        // Mid-band radial push outward from center.
        if (midPush > 0.1) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          p.vx += (dx / d) * midPush * dt;
          p.vy += (dy / d) * midPush * dt;
        }

        // Integrate.
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        p.vy *= drag;

        // Decay life.
        p.life -= dt * 0.4;
        if (p.life <= 0) {
          p.alive = false;
          continue;
        }

        // Wrap around edges instead of vanishing — keeps the field full.
        if (p.x < -20) p.x = cw + 20;
        if (p.x > cw + 20) p.x = -20;
        if (p.y < -20) p.y = ch + 20;
        if (p.y > ch + 20) p.y = -20;

        // Pulse size with low band. Don't randomize per-frame — that flickers.
        // Instead we modulate the spawn-time size by the current low energy.
        p.size = p.size * 0.9 + (0.7 + lowPulse * 0.3) * 0.1;
      }

      // Top up to keep ambient density alive (slow trickle). Color picked from
      // dominant band so ambient particles also feel reactive.
      if (aliveCount < MAX_PARTICLES * 0.4 && Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.min(cw, ch) * 0.4;
        const sx = cx + Math.cos(angle) * r * Math.random();
        const sy = cy + Math.sin(angle) * r * Math.random();
        // Ambient particles bias toward low/mid (foundation), not high-energy.
        const palette = low > mid ? PALETTE_LOW : PALETTE_MID;
        spawn(sx, sy, palette, 1.5, speedScale);
      }
    },

    draw(p: p5): void {
      // HSB color mode is set up by the sketch.
      p.noStroke();
      for (let i = 0; i < pool.length; i += 1) {
        const part = pool[i]!;
        if (!part.alive) continue;
        const lifeFrac = Math.max(0, part.life / part.life0);
        const alpha = lifeEnvelope(lifeFrac) * 0.9;
        const r = BASE_SIZE * part.size;
        // Inner glow + outer halo. Hue and saturation are now per-particle
        // and consistent across life, so the field feels like distinct
        // sparks rather than a uniform haze.
        p.fill(part.hue, part.sat, 100, alpha);
        p.circle(part.x, part.y, r * 2);
        p.fill(part.hue, part.sat * 0.5, 100, alpha * 0.4);
        p.circle(part.x, part.y, r * 4);
      }
    },
  };
}

function seedAmbient(
  pool: Particle[],
  width: number,
  height: number,
  count: number,
): void {
  let placed = 0;
  for (const p of pool) {
    if (placed >= count) break;
    if (p.alive) continue;
    p.alive = true;
    p.x = Math.random() * width;
    p.y = Math.random() * height;
    p.vx = (Math.random() - 0.5) * 20;
    p.vy = (Math.random() - 0.5) * 20;
    p.size = 0.5 + Math.random() * 0.5;
    // Ambient seed favors the cool blue/cyan palette so the resting-state
    // field reads as deep-space.
    const palette = Math.random() < 0.5 ? PALETTE_LOW : PALETTE_MID;
    p.hue = palette.hue + (Math.random() - 0.5) * 12;
    p.sat = palette.sat + (Math.random() - 0.5) * 10;
    p.life = 1.5 + Math.random();
    p.life0 = p.life;
    placed += 1;
  }
}
