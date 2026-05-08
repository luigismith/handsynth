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
  /**
   * Emit particles from the mouth at (mx, my) screen coords. `intensity` is
   * the mouthOpen value 0..1 — drives both the rate and the average particle
   * size. The visualizer calls this from drawFaceSkeleton each frame; we
   * cap our own emission rate internally so very-open mouths don't drain
   * the pool in one frame.
   */
  emitFromMouth(mx: number, my: number, intensity: number): void;
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
    sizeBoost = 1,
    angleBias?: { angle: number; spread: number },
  ): void {
    const slot = pool.find((p) => !p.alive);
    if (!slot) return;
    slot.alive = true;
    slot.x = cx;
    slot.y = cy;
    let angle: number;
    if (angleBias) {
      angle = angleBias.angle + (Math.random() - 0.5) * angleBias.spread;
    } else {
      angle = Math.random() * Math.PI * 2;
    }
    const speed = (20 + Math.random() * 60) * speedScale;
    slot.vx = Math.cos(angle) * speed;
    slot.vy = Math.sin(angle) * speed;
    slot.size = (0.6 + Math.random() * 0.8) * sizeBoost;
    // Slight per-particle hue jitter so the palette feels organic, not banded.
    slot.hue = palette.hue + (Math.random() - 0.5) * 12;
    slot.sat = palette.sat + (Math.random() - 0.5) * 10;
    slot.life = life;
    slot.life0 = life;
  }

  // Frame-rate-independent emission accumulator. Each call adds to a
  // running quota; we spawn floor(quota) particles and keep the fractional
  // remainder for the next frame. Prevents bursts on dropped frames.
  let mouthQuota = 0;
  let mouthLastFrameMs = performance.now();

  return {
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },

    emitFromMouth(mx: number, my: number, intensity: number): void {
      const i = Math.max(0, Math.min(1, intensity));
      if (i < 0.05) {
        mouthQuota = 0;
        mouthLastFrameMs = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - mouthLastFrameMs) / 1000);
      mouthLastFrameMs = now;

      // Spawn rate scales as intensity^1.5: a small mouth open gives a
      // gentle stream, a wide-open mouth a fountain. Cap at 60/sec so we
      // can't drain the pool.
      const baseRate = reducedMotion ? 12 : 28;
      const rate = baseRate * Math.pow(i, 1.4);
      mouthQuota += rate * dt;
      let toSpawn = Math.floor(mouthQuota);
      if (toSpawn <= 0) return;
      mouthQuota -= toSpawn;

      // Cap to remaining live-slot capacity so we don't loop forever.
      let aliveCount = 0;
      for (const p of pool) if (p.alive) aliveCount += 1;
      const room = MAX_PARTICLES - aliveCount;
      if (toSpawn > room) toSpawn = room;
      if (toSpawn <= 0) return;

      // Emit roughly downward (mouth → chin) with a wide spread, so the
      // particles fall like vocal "smoke". The angle 90° is straight down
      // in p5/canvas coords (y grows downward).
      const angle = Math.PI / 2;
      const spread = Math.PI * 0.8; // ±72°
      // Bigger mouths → bigger particles. Map intensity to size boost
      // 0.8..2.4 and life 1.2..2.4s.
      const sizeBoost = 0.8 + i * 1.6;
      const life = 1.2 + i * 1.2;
      // Warm palette tied to mouth — feels vocal/breath-like.
      const palette = { hue: 28 + (Math.random() - 0.5) * 20, sat: 60 };
      // Mouth emits from a small jittered region (lip span).
      for (let k = 0; k < toSpawn; k += 1) {
        const jx = mx + (Math.random() - 0.5) * 18;
        const jy = my + (Math.random() - 0.5) * 6;
        spawn(jx, jy, palette, life, 1 + i * 0.8, sizeBoost, { angle, spread });
      }
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

      const speedScale = reducedMotion ? 0.5 : 1;
      const cx = width * 0.5;
      const cy = height * 0.5;
      // Live count check used for ambient top-up below.
      let aliveCount = 0;
      for (const p of pool) if (p.alive) aliveCount += 1;

      // The center "high-band sparkle" emission was removed — the only
      // *new* particle emitter is now `emitFromMouth` (called from the
      // sketch when the user's mouth opens). The previous spawning from
      // (width/2, height/2) felt arbitrary visually. The FFT bands
      // (low/mid/high) still drive the per-particle size pulse + outward
      // push below.

      // Update each live particle.
      const lowPulse = 1 + low * 1.5; // size multiplier
      const drag = Math.exp(-dt * 0.6); // velocity drag
      // mid-band radial push removed — it was making particles fountain
      // outward from the canvas center on every drum hit, reading as
      // "particles spawning from the middle of the screen". The low-band
      // size pulse stays.
      void mid;

      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i]!;
        if (!p.alive) continue;

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

      // Top up to keep ambient density alive (slow trickle). Color picked
      // from dominant band so ambient particles feel reactive. Spawn at
      // RANDOM canvas positions (not concentrated near center) so the
      // field feels like a starfield, not an emitter.
      void cx; void cy;
      if (aliveCount < MAX_PARTICLES * 0.4 && Math.random() < 0.2) {
        const sx = Math.random() * cw;
        const sy = Math.random() * ch;
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
