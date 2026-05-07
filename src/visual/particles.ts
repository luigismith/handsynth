// Owner: visualizer
//
// FFT-reactive particle field. Reuses object pools — no per-frame allocation.
//
// The pool size is fixed at construction (`MAX_PARTICLES`). Each particle has
// position, velocity, hue, life, and size. High-frequency FFT energy emits
// new particles by re-incarnating dead slots from the pool; mid-frequency
// energy displaces them outward; low-frequency energy pulses their size.

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
}

const MAX_PARTICLES = 120;
const BASE_SIZE = 4;

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
      hue: 200,
      life: 0,
      life0: 1,
    });
  }
  // Seed half the pool so the field is alive immediately even before audio.
  let cw = width;
  let ch = height;
  seedAmbient(pool, cw, ch, MAX_PARTICLES / 2);

  function spawn(cx: number, cy: number, hue: number, life: number): void {
    const slot = pool.find((p) => !p.alive);
    if (!slot) return;
    slot.alive = true;
    slot.x = cx;
    slot.y = cy;
    const angle = Math.random() * Math.PI * 2;
    const speed = 20 + Math.random() * 60;
    slot.vx = Math.cos(angle) * speed;
    slot.vy = Math.sin(angle) * speed;
    slot.size = 0.6 + Math.random() * 0.8;
    slot.hue = hue;
    slot.life = life;
    slot.life0 = life;
  }

  return {
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

      // High-band sparkle: probabilistic emission from center.
      const sparkleP = high * 0.9;
      // 0..3 emits per frame, weighted by high energy.
      const emits = Math.floor(sparkleP * 3 + Math.random() * sparkleP * 2);
      for (let i = 0; i < emits; i += 1) {
        const hue = 180 + Math.random() * 60; // cyan-blue
        spawn(cx, cy, hue, 1.2 + Math.random() * 0.8);
      }

      // Update each live particle.
      const lowPulse = 1 + low * 1.5; // size multiplier
      const midPush = mid * 200; // outward acceleration scale
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

        // Pulse size with low band.
        p.size = (0.6 + Math.random() * 0.4) * lowPulse;
      }

      // Top up to keep ambient density alive (slow trickle).
      let aliveCount = 0;
      for (const p of pool) if (p.alive) aliveCount += 1;
      if (aliveCount < MAX_PARTICLES * 0.4 && Math.random() < 0.3) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.min(cw, ch) * 0.4;
        const sx = cx + Math.cos(angle) * r * Math.random();
        const sy = cy + Math.sin(angle) * r * Math.random();
        spawn(sx, sy, 190 + Math.random() * 40, 1.5);
      }
    },

    draw(p: p5): void {
      // HSB color mode is set up by the sketch.
      p.noStroke();
      for (let i = 0; i < pool.length; i += 1) {
        const part = pool[i]!;
        if (!part.alive) continue;
        const lifeFrac = Math.max(0, part.life / part.life0);
        const alpha = lifeFrac * 0.9;
        const r = BASE_SIZE * part.size;
        // Inner glow + outer halo
        p.fill(part.hue, 60, 100, alpha);
        p.circle(part.x, part.y, r * 2);
        p.fill(part.hue, 30, 100, alpha * 0.4);
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
    p.hue = 195 + Math.random() * 40;
    p.life = 1.5 + Math.random();
    p.life0 = p.life;
    placed += 1;
  }
}
