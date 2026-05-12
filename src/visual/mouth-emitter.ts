// Owner: visualizer
//
// Mouth-particle emitter — focused, single-purpose successor to the deleted
// generic ParticleField. Only emits when the user's mouth is open, only
// from the lip region, and the visual identity is "vocal sparkle / aurora":
// upward-curling glints rising from the mouth, hue gradient amber→pale, with
// a brighter accent burst when the rising-edge stab fires.
//
// Why a fresh module (not revive the old one):
//   - Old field had a global FFT-reactive swarm + ambient top-ups + edge wrap
//     etc. The user wanted ONE focused thing: mouth particles, gorgeous.
//   - Slim pool (32 instead of 48..120). The single emitter never needs more
//     than 4-5 spawns/frame at the widest mouth + flourish burst combined.
//   - Per-frame cost target: <0.4ms on mid-tier laptops (was 1.5..2.2ms for
//     the old field with the 48-particle pool). Keeps the LITE MODE win.
//   - Frame-rate-independent quota accumulator (kept from the old module —
//     it solved dropped-frame burst issues).
//
// Visual identity:
//   - Particles spawn at the lip line and rise UPWARD (negative-y) with a
//     gentle sinusoidal horizontal wobble — "vocal aurora" not "smoke".
//   - Palette gradient over particle age:
//       young  → ORANGE_PALE (bright, near-white center)
//       middle → ORANGE_HOT  (saturated warmth)
//       old    → ORANGE_DARK (smouldering ember)
//   - Size proportional to mouthOpen at spawn time (0.6× to 2.4×).
//   - Tiny diamonds (rotated squares) — matches existing fingertip-core
//     shape so the entire visualizer reads as one coherent low-poly system.
//   - On flourish (rising-edge stab) the caller invokes emitBurst() which
//     spawns 8 radial sparks with elevated brightness + size + speed.
//
// Audio coupling:
//   - This module is purely visual. The audio-side enhancement (harmony-aware
//     mouth flourish — 3-tone cluster on rising edge) lives in
//     InteractionMapper.handleFaceUpdate; both share the same trigger semantic
//     (mouthOpen crossing FACE_MOUTH_STAB_THRESHOLD) so the user perceives
//     them as one synchronized event. Sketch.ts calls emitBurst() in response
//     to a parallel rising-edge detection on the SketchState.face.mouthOpen
//     value — the visualizer doesn't subscribe to InteractionMapper.

import type p5 from 'p5';

// Pool size. Each particle = 1 quad draw + 1 cheap update step. Combined
// max load = continuous-stream (~3-4 spawns/frame at wide mouth) + flourish
// burst (8 in one frame). 32 is safe ceiling. Going larger gives nothing
// because life is short (≤1.4s) so density tops out well below 32.
const MAX_PARTICLES = 32;
const BASE_SIZE = 3.2;

// Per-life-fraction palette stops (HSB triples). The interpolation happens
// at draw time so we don't allocate per-particle. All within warm orange
// family — pale (almost white) → hot → dark-ember.
const PALETTE_YOUNG = { h: 30, s: 35, b: 100 } as const;   // ORANGE_PALE-ish
const PALETTE_MID = { h: 22, s: 92, b: 100 } as const;     // ORANGE_HOT
const PALETTE_OLD = { h: 18, s: 95, b: 78 } as const;      // ORANGE_DARK / ember

export interface MouthParticle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0..1 size multiplier, modulated by phase + low-freq pulse if wanted. */
  size: number;
  /** 0..1 life remaining. */
  life: number;
  /** Initial life so we can compute age fraction at draw time. */
  life0: number;
  /** Per-particle horizontal wobble phase 0..2π. */
  wobble: number;
  /** Per-particle wobble amplitude in px. */
  wobbleAmp: number;
  /** Burst particles use a brighter color ramp and larger render scale. */
  burst: boolean;
}

export interface MouthEmitter {
  /** Emit a stream proportional to mouthOpen (0..1). Called every draw frame. */
  emit(mx: number, my: number, intensity: number): void;
  /**
   * Emit a one-shot burst at (mx, my). Spawns 8 radial sparks. Used by the
   * sketch when it detects a mouth-rising-edge to mirror the audio flourish.
   */
  emitBurst(mx: number, my: number, intensity: number): void;
  /** Step the simulation. */
  update(dt: number): void;
  /** Draw the field. Caller must set HSB color mode + ADD blend mode. */
  draw(p: p5): void;
  /** Reset on resize/unmount — clears all live particles. */
  reset(): void;
  /** Toggle reduced-motion (cuts emission rates ~60%). */
  setReducedMotion(reduced: boolean): void;
}

export function createMouthEmitter(): MouthEmitter {
  const pool: MouthParticle[] = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      life: 0,
      life0: 1,
      wobble: 0,
      wobbleAmp: 0,
      burst: false,
    });
  }

  let reducedMotion = false;
  let streamQuota = 0;
  let lastEmitMs = performance.now();

  /** Find the oldest dead slot; return -1 if all are alive (pool exhausted). */
  function findSlot(): number {
    for (let i = 0; i < pool.length; i += 1) {
      if (!pool[i]!.alive) return i;
    }
    return -1;
  }

  function spawn(
    mx: number,
    my: number,
    intensity: number,
    /** Speed scale multiplier (burst = 2.5×, stream = 1×). */
    speedScale: number,
    /** Spawn-time size multiplier extra (burst = 1.4×, stream = 1×). */
    sizeBoost: number,
    burst: boolean,
    angleOverride?: number,
  ): void {
    const slot = findSlot();
    if (slot < 0) return;
    const p = pool[slot]!;
    p.alive = true;
    p.burst = burst;

    // Spawn within a small jittered lip-span — wider for burst (radial spark),
    // narrow for stream (rises straight from the lip).
    const jitterX = burst ? 14 : 9;
    const jitterY = burst ? 8 : 4;
    p.x = mx + (Math.random() - 0.5) * jitterX;
    p.y = my + (Math.random() - 0.5) * jitterY;

    // Direction: stream rises with a small left/right spread (mostly upward
    // = negative y). Burst goes radially in any direction.
    let angle: number;
    if (typeof angleOverride === 'number') {
      angle = angleOverride;
    } else if (burst) {
      angle = Math.random() * Math.PI * 2;
    } else {
      // Upward biased: -π/2 ± 60°
      angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 1.5);
    }

    const baseSpeed = burst ? 90 : 35;
    const speed = (baseSpeed + Math.random() * 40) * speedScale * (0.6 + intensity * 0.8);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;

    // Size scales with intensity; burst particles spawn larger.
    p.size = (0.6 + Math.random() * 0.7) * sizeBoost * (0.8 + intensity * 0.8);

    // Life: burst ≈ 0.6s short, stream 0.9..1.8s (wider mouth = longer life,
    // so the aurora trails farther on big openings).
    p.life0 = burst ? 0.6 + Math.random() * 0.3 : 0.9 + intensity * 0.9;
    p.life = p.life0;

    p.wobble = Math.random() * Math.PI * 2;
    // Wobble amplitude: stream particles wobble more than burst sparks (which
    // need to travel decisively outward).
    p.wobbleAmp = burst ? 0.4 : 1.6 + Math.random() * 1.0;
  }

  return {
    setReducedMotion(reduced: boolean): void {
      reducedMotion = reduced;
    },

    emit(mx: number, my: number, intensity: number): void {
      const i = Math.max(0, Math.min(1, intensity));
      if (i < 0.05) {
        streamQuota = 0;
        lastEmitMs = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastEmitMs) / 1000);
      lastEmitMs = now;

      // Spawn rate scales as intensity^1.4: small mouth = gentle wisp,
      // wide-open = "fountain". Cap at 22/s normally; 9/s under reduced motion.
      const baseRate = reducedMotion ? 9 : 22;
      const rate = baseRate * Math.pow(i, 1.4);
      streamQuota += rate * dt;
      let toSpawn = Math.floor(streamQuota);
      if (toSpawn <= 0) return;
      streamQuota -= toSpawn;
      // Defensive cap — never spawn more than 6 in one frame even if the
      // accumulator pathologically overflowed.
      if (toSpawn > 6) toSpawn = 6;

      for (let k = 0; k < toSpawn; k += 1) {
        spawn(mx, my, i, 1, 1, false);
      }
    },

    emitBurst(mx: number, my: number, intensity: number): void {
      const i = Math.max(0.3, Math.min(1, intensity));
      // Burst always spawns 8 sparks evenly distributed around a circle,
      // with small angular jitter so the pattern looks organic. Under
      // reduced motion drop to 4 sparks.
      const n = reducedMotion ? 4 : 8;
      for (let k = 0; k < n; k += 1) {
        const angle = (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
        spawn(mx, my, i, 2.5, 1.4, true, angle);
      }
    },

    update(dt: number): void {
      // Integrate. Wobble is added at draw time (cheaper than per-frame state).
      const drag = Math.exp(-dt * (reducedMotion ? 1.2 : 0.6));
      for (let i = 0; i < pool.length; i += 1) {
        const p = pool[i]!;
        if (!p.alive) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        // Gravity-style upward acceleration on stream particles only — gives
        // the rising "aurora" feel. Burst particles ignore so they fan out
        // evenly.
        if (!p.burst) p.vy -= 12 * dt;
        else p.vy *= drag;
        // Advance wobble phase.
        p.wobble += dt * 6;

        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
        }
      }
    },

    draw(p: p5): void {
      p.noStroke();
      for (let i = 0; i < pool.length; i += 1) {
        const part = pool[i]!;
        if (!part.alive) continue;

        // Age fraction 0..1.
        const age = 1 - Math.max(0, part.life / part.life0);

        // Palette interpolation: young→mid (0..0.5), mid→old (0.5..1).
        let h: number;
        let s: number;
        let b: number;
        if (age < 0.5) {
          const t = age / 0.5;
          h = PALETTE_YOUNG.h + (PALETTE_MID.h - PALETTE_YOUNG.h) * t;
          s = PALETTE_YOUNG.s + (PALETTE_MID.s - PALETTE_YOUNG.s) * t;
          b = PALETTE_YOUNG.b + (PALETTE_MID.b - PALETTE_YOUNG.b) * t;
        } else {
          const t = (age - 0.5) / 0.5;
          h = PALETTE_MID.h + (PALETTE_OLD.h - PALETTE_MID.h) * t;
          s = PALETTE_MID.s + (PALETTE_OLD.s - PALETTE_MID.s) * t;
          b = PALETTE_MID.b + (PALETTE_OLD.b - PALETTE_MID.b) * t;
        }

        // Fade-in (first 12%) and fade-out (last 30%) envelope.
        let alpha: number;
        if (age < 0.12) alpha = age / 0.12;
        else if (age > 0.7) alpha = (1 - age) / 0.3;
        else alpha = 1;
        alpha *= part.burst ? 1.0 : 0.85;

        // Apply horizontal wobble (stream only; burst has wobbleAmp=0.4 small).
        const x = part.x + Math.sin(part.wobble) * part.wobbleAmp;
        const y = part.y;

        const r = BASE_SIZE * part.size * (part.burst ? 1.35 : 1);

        // Diamond: rotated square. Matches fingertip-core aesthetic.
        // Pre-compute the four vertices.
        const x0 = x;
        const y0 = y - r;
        const x1 = x + r;
        const y1 = y;
        const x2 = x;
        const y2 = y + r;
        const x3 = x - r;
        const y3 = y;

        p.fill(h, s, b, alpha);
        p.beginShape();
        p.vertex(x0, y0);
        p.vertex(x1, y1);
        p.vertex(x2, y2);
        p.vertex(x3, y3);
        p.endShape(p.CLOSE);
      }
    },

    reset(): void {
      streamQuota = 0;
      for (const p of pool) p.alive = false;
    },
  };
}
