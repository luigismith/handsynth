// Owner: visualizer
//
// p5 instance-mode sketch factory. Composes the visual layers (drawn in
// the order listed):
//   1. Midnight-blue background + radial vignette + horizon glow
//   2. Parallax starfield (deep-space depth, slow drift)
//   3. CRT scanlines (pre-rendered)        [drawn LAST, on top, for grain]
//   4. FFT-reactive particles               [→ also into bloom buffer]
//   5. Hand silhouettes (skeleton + fingertip blobs + glow ring)
//   6. Elastic beat-pulsing strings between adjacent fingers
//                                            [→ also into bloom buffer]
//   7. Bloom composite (ADD blend, on top of layers 1-6)
//   8. Scanlines (subtle CRT pattern, NORMAL blend)
//
// Hot-state lives in a `SketchState` object that the Visualizer owns and
// mutates from outside (current hands, current beat pulse). The sketch reads
// this state on each draw call.

import type p5 from 'p5';
import type { Hand } from '@contracts/contracts';
import { createParticleField, type ParticleField } from './particles';
import { createScanlineLayer, type ScanlineLayer } from './scanlines';
import { createStarfield, createHorizonGlow, type Starfield, type HorizonGlow } from './starfield';
import { createBloom, BLOOM_DOWNSCALE, type Bloom } from './bloom';
import { createEnvelope, type Envelope } from './envelope';

// ---------------------------------------------------------------------------
// Shared state — the Visualizer mutates these fields between frames.
// ---------------------------------------------------------------------------

export interface SketchState {
  /** Current frame's detected hands (already smoothed by HandTracker). */
  hands: Hand[];
  /**
   * Beat pulse, set to 1.0 on each beat by the Visualizer. The sketch
   * forwards this into the beat envelope and resets it back to 0 each frame
   * once consumed (so the same value isn't replayed). Acts as a "trigger
   * intent" rather than a continuous value.
   */
  pulse: number;
  /** FFT bins (Uint8, 0..255). Visualizer fills this once per draw. */
  fftBins: Uint8Array;
  /** True when the analyser tap is wired up. */
  hasAnalyser: boolean;
  /**
   * If true, dial back motion: skip bloom, halve particle activity, no
   * background flash on beat. Set by the Visualizer based on
   * `prefers-reduced-motion`.
   */
  reducedMotion: boolean;
}

// MediaPipe hand-landmark topology. Each pair = a connection to draw.
//   0 wrist; 1-4 thumb; 5-8 index; 9-12 middle; 13-16 ring; 17-20 pinky.
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Palm
  [0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17],
  // Thumb
  [1, 2], [2, 3], [3, 4],
  // Index
  [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [17, 18], [18, 19], [19, 20],
];

// Adjacent fingertip pairs for elastic strings.
//   index tip (8), middle tip (12), ring tip (16), pinky tip (20)
const FINGER_STRING_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [8, 12],
  [12, 16],
  [16, 20],
];

const FINGERTIP_INDICES = [4, 8, 12, 16, 20] as const;
// Palm landmarks used to compute hand center / radius.
const PALM_INDICES = [0, 5, 9, 13, 17] as const;

// MediaPipe x is in [0,1] from the camera POV (mirrored by webcam CSS). The
// HandTracker comments note "x as already mirrored" because handedness has
// been remapped, but the *coordinates* themselves come straight from
// MediaPipe (camera POV). Since the on-screen webcam preview is flipped via
// CSS `transform: scaleX(-1)`, the visualizer should mirror x as well so
// the silhouette aligns with the user's actual hand position.
function landmarkToScreen(
  lx: number,
  ly: number,
  width: number,
  height: number,
): [number, number] {
  return [(1 - lx) * width, ly * height];
}

export interface SketchHandle {
  /** The underlying p5 instance — call `.remove()` from outside on teardown. */
  instance: p5;
  /** Resize hook. */
  resize(width: number, height: number): void;
}

export function createSketch(
  p5Ctor: typeof p5,
  parent: HTMLElement,
  state: SketchState,
): SketchHandle {
  let particles: ParticleField | null = null;
  let scanlines: ScanlineLayer | null = null;
  let vignette: p5.Graphics | null = null;
  let starfield: Starfield | null = null;
  let horizon: HorizonGlow | null = null;
  let bloom: Bloom | null = null;
  let lastFrameMs = performance.now();
  let elapsed = 0;

  // Beat envelope — replaces the old `pulse *= 0.92` per-frame decay. Drives
  // string brightness, ring pulse, vignette tightening, and (subtle) bg flash.
  const beat: Envelope = createEnvelope({ attack: 0.030, decay: 0.200, release: 0.100 });

  const sketch = (s: p5): void => {
    s.setup = (): void => {
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      const canvas = s.createCanvas(w, h);
      // Attach to parent. p5 normally appends to document.body unless told.
      canvas.parent(parent);
      s.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
      s.colorMode(s.HSB, 360, 100, 100, 1);
      s.frameRate(60);

      particles = createParticleField(w, h);
      particles.setReducedMotion(state.reducedMotion);
      scanlines = createScanlineLayer(s, w, h);
      vignette = buildVignette(s, w, h);
      starfield = createStarfield(w, h);
      horizon = createHorizonGlow(s, w, h);
      // Bloom is the heaviest add. Only allocate if we plan to use it.
      if (!state.reducedMotion) {
        bloom = createBloom(s, w, h);
      }
    };

    s.draw = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      elapsed += dt;

      // Forward "trigger intent" from state.pulse into the beat envelope,
      // then clear state.pulse so the same beat isn't re-triggered.
      if (state.pulse > 0.5) {
        beat.trigger(1.0);
        state.pulse = 0;
      }
      beat.step(dt);
      const beatV = beat.value;

      // Reduced-motion may have toggled — keep particles in sync.
      particles?.setReducedMotion(state.reducedMotion);

      // ---------------------------------------------------------------
      // Layer 1 — background (midnight blue) + horizon glow + vignette
      // ---------------------------------------------------------------
      // Midnight blue: HSB(230, 70, 17) ≈ #0a0e2c. Beat adds a SUBTLE
      // bg flash (+5% brightness) — only when motion isn't reduced.
      const bgBoost = state.reducedMotion ? 0 : beatV * 0.05;
      s.background(230, 70, 17 + bgBoost * 100);

      // Horizon glow at the bottom — gentle depth cue. Intensity rises
      // slightly on beat, capped at 1.2.
      if (horizon) {
        horizon.draw(s, s.width, s.height, 1 + beatV * 0.2);
      }

      // ---------------------------------------------------------------
      // Layer 2 — parallax starfield (BLEND, low alpha)
      // ---------------------------------------------------------------
      if (starfield) {
        s.push();
        s.blendMode(s.BLEND);
        starfield.draw(s, elapsed, s.width, s.height);
        s.pop();
      }

      // Vignette — drawn AFTER stars so the corners darken everything.
      // Tighten on beat (vignette intensity *= 1 + beatV * 0.3).
      if (vignette) {
        s.push();
        s.blendMode(s.BLEND);
        if (beatV > 0.01) {
          // Slight brightness reduction at corners during the pulse —
          // simulates iris-tightening on the beat.
          s.tint(0, 0, 100, Math.min(1, 1 + beatV * 0.3));
        }
        s.image(vignette, 0, 0, s.width, s.height);
        if (beatV > 0.01) s.noTint();
        s.pop();
      }

      // ---------------------------------------------------------------
      // Layers 3+4 — particles. Update once, draw twice (once to main,
      // once into bloom buffer for the glow pass).
      // ---------------------------------------------------------------
      if (particles) {
        particles.update({
          fft: state.fftBins,
          width: s.width,
          height: s.height,
          dt,
        });
        s.push();
        s.blendMode(s.ADD);
        particles.draw(s);
        s.pop();
      }

      // ---------------------------------------------------------------
      // Bloom buffer: collect bright elements at downsampled resolution.
      // We render particles + finger strings + fingertip cores into the
      // buffer, then blur it, then composite ADD on top of the canvas.
      //
      // The buffer is in BUFFER coords (canvas/DOWNSCALE), so we wrap
      // the draw calls in a scale() transform.
      // ---------------------------------------------------------------
      if (bloom && bloom.ready() && !state.reducedMotion) {
        const buf = bloom.begin();
        if (buf) {
          // Buffer pixels are 1:1 with itself — we need to scale the
          // world (canvas-space) coords down to fit. Use scale(1/DS).
          buf.push();
          buf.scale(1 / BLOOM_DOWNSCALE);
          buf.blendMode(buf.ADD);

          // Particles (re-draw — they're cheap, ~120 circles).
          if (particles) particles.draw(buf);

          // Finger strings (with pulse). Re-using the same draw fn.
          if (state.hands.length > 0) {
            drawFingerStrings(buf, state.hands, beatV, s.width, s.height);
            drawFingertipCores(buf, state.hands, beatV, s.width, s.height);
          }
          buf.pop();

          // Apply blur and composite. ~1-1.5ms total on 2020 hardware.
          bloom.blur();
          bloom.composite(s);
        }
      }

      // ---------------------------------------------------------------
      // Layer 5 — hand silhouettes (drawn AFTER bloom so the crisp
      // skeleton lines aren't blurred away). Glow ring is drawn first
      // so it sits behind the skeleton.
      // ---------------------------------------------------------------
      if (state.hands.length > 0) {
        s.push();
        s.blendMode(s.ADD);
        drawHandRings(s, state.hands, beatV);
        drawHands(s, state.hands, beatV);
        s.pop();

        // Layer 6 — finger strings on top of the skeleton.
        s.push();
        s.blendMode(s.ADD);
        drawFingerStrings(s, state.hands, beatV, s.width, s.height);
        s.pop();
      }

      // ---------------------------------------------------------------
      // Layer 8 — scanlines on top, in normal blend mode for subtle darkening.
      // ---------------------------------------------------------------
      if (scanlines) {
        scanlines.draw(s, s.frameCount * 0.5);
      }
    };
  };

  const instance = new p5Ctor(sketch, parent);

  return {
    instance,
    resize(width: number, height: number): void {
      instance.resizeCanvas(width, height);
      if (scanlines) scanlines.resize(instance, width, height);
      if (vignette) {
        vignette.remove();
        vignette = buildVignette(instance, width, height);
      }
      if (starfield) starfield.reset(width, height);
      if (horizon) horizon.resize(instance, width, height);
      if (bloom) bloom.resize(instance, width, height);
      if (particles) particles.reset(width, height);
    },
  };
}

// ---------------------------------------------------------------------------
// Hand glow ring — soft pulsing ring around each palm.
// Cheap: 3 circle calls per hand. Total: 6 calls/frame for two hands.
// ---------------------------------------------------------------------------

function drawHandRings(s: p5, hands: Hand[], beatV: number): void {
  const w = s.width;
  const h = s.height;

  for (const hand of hands) {
    // Compute palm center + average radius from palm landmarks.
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const idx of PALM_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      cx += x;
      cy += y;
      count += 1;
    }
    if (count === 0) continue;
    cx /= count;
    cy /= count;

    // Radius from average palm-landmark distance to center, scaled by openness.
    let rSum = 0;
    for (const idx of PALM_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      rSum += Math.hypot(x - cx, y - cy);
    }
    const baseR = (rSum / count) * 1.6;
    // Openness scales the ring outward — closed fist is small, splayed is big.
    const openR = baseR * (1 + hand.openness * 0.6);
    const ringR = openR * (1 + beatV * 0.15);
    const sideHue = hand.side === 'right' ? 200 : 280;

    s.noFill();
    // Outermost wash — very soft.
    s.stroke(sideHue, 30, 100, 0.06 + hand.openness * 0.04 + beatV * 0.05);
    s.strokeWeight(18);
    s.circle(cx, cy, ringR * 2);
    // Mid wash.
    s.stroke(sideHue, 40, 100, 0.10 + hand.openness * 0.06 + beatV * 0.08);
    s.strokeWeight(8);
    s.circle(cx, cy, ringR * 2);
    // Crisp inner edge — very subtle, just enough to read as "hand presence".
    s.stroke(sideHue, 25, 100, 0.18 + beatV * 0.12);
    s.strokeWeight(1.4);
    s.circle(cx, cy, ringR * 2);
  }
}

// ---------------------------------------------------------------------------
// Hand drawing
// ---------------------------------------------------------------------------

function drawHands(s: p5, hands: Hand[], beatV: number): void {
  const w = s.width;
  const h = s.height;

  for (const hand of hands) {
    const sideHue = hand.side === 'right' ? 200 : 280; // cyan for right, violet for left

    // Skeleton lines.
    s.noFill();
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand.landmarks[a];
      const lb = hand.landmarks[b];
      if (!la || !lb) continue;
      const [ax, ay] = landmarkToScreen(la.x, la.y, w, h);
      const [bx, by] = landmarkToScreen(lb.x, lb.y, w, h);
      // Outer glow.
      s.stroke(sideHue, 50, 100, 0.25);
      s.strokeWeight(6 + beatV * 2);
      s.line(ax, ay, bx, by);
      // Core line.
      s.stroke(sideHue, 30, 100, 0.7);
      s.strokeWeight(1.6);
      s.line(ax, ay, bx, by);
    }

    // Fingertip blobs (radial-ish glow via stacked circles).
    s.noStroke();
    for (const idx of FINGERTIP_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      const baseR = 8 + beatV * 6;
      s.fill(sideHue, 40, 100, 0.5);
      s.circle(x, y, baseR * 1.0);
      s.fill(sideHue, 20, 100, 0.25);
      s.circle(x, y, baseR * 2.2);
      s.fill(sideHue, 10, 100, 0.12);
      s.circle(x, y, baseR * 4.0);
    }
  }
}

/**
 * Just the bright cores of fingertips — used in the bloom pass so we
 * don't double-blur the already-glowing outer halos.
 */
function drawFingertipCores(
  s: p5 | p5.Graphics,
  hands: Hand[],
  beatV: number,
  w: number,
  h: number,
): void {
  s.noStroke();
  for (const hand of hands) {
    const sideHue = hand.side === 'right' ? 200 : 280;
    for (const idx of FINGERTIP_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      const baseR = 8 + beatV * 6;
      s.fill(sideHue, 40, 100, 0.7);
      s.circle(x, y, baseR);
    }
  }
}

// ---------------------------------------------------------------------------
// Elastic strings — pulse on the beat
//
// Width/height are passed explicitly because in the bloom pass we draw
// into a downsampled buffer where the buffer's `.width`/`.height` would
// be the small dimensions, but we want the strings positioned in the
// main canvas-space coords. The caller scales the buffer accordingly.
// ---------------------------------------------------------------------------

function drawFingerStrings(
  s: p5 | p5.Graphics,
  hands: Hand[],
  beatV: number,
  w: number,
  h: number,
): void {
  for (const hand of hands) {
    const sideHue = hand.side === 'right' ? 195 : 285;

    // Mean Y of fingertips → "high" hand position means taut, "low" means sag.
    let yMean = 0;
    let n = 0;
    for (const idx of [8, 12, 16, 20]) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      yMean += lm.y;
      n += 1;
    }
    if (n === 0) continue;
    yMean /= n;
    // p5 y is screen-space (0 top); MediaPipe y is also 0 top, so a high hand
    // has small y. More sag when y is large (hand is low).
    const sagAmount = Math.min(1, Math.max(0, yMean)) * h * 0.08;

    const brightness = 0.6 + 0.4 * beatV;
    const thickness = 1.4 + beatV * 1.6;

    for (const [a, b] of FINGER_STRING_PAIRS) {
      const la = hand.landmarks[a];
      const lb = hand.landmarks[b];
      if (!la || !lb) continue;
      const [ax, ay] = landmarkToScreen(la.x, la.y, w, h);
      const [bx, by] = landmarkToScreen(lb.x, lb.y, w, h);

      // Bezier control points sag downward in y.
      const cx1 = ax + (bx - ax) * 0.33;
      const cx2 = ax + (bx - ax) * 0.66;
      const cy1 = ay + sagAmount;
      const cy2 = by + sagAmount;

      // Outer halo
      s.noFill();
      s.stroke(sideHue, 35, 100, 0.18 * brightness);
      s.strokeWeight(thickness * 4);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
      // Mid
      s.stroke(sideHue, 25, 100, 0.45 * brightness);
      s.strokeWeight(thickness * 2);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
      // Core
      s.stroke(sideHue, 10, 100, 0.9 * brightness);
      s.strokeWeight(thickness);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
    }
  }
}

// ---------------------------------------------------------------------------
// Vignette (radial darkening toward edges)
// ---------------------------------------------------------------------------

function buildVignette(s: p5, w: number, h: number): p5.Graphics {
  const g = s.createGraphics(w, h);
  g.colorMode(s.HSB, 360, 100, 100, 1);
  g.noStroke();
  // Coarse radial gradient via concentric circles. Cheap and runs once.
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  const steps = 24;
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    // alpha ramps from 0 at center to ~0.55 at corners
    const a = Math.pow(t, 1.6) * 0.55;
    g.fill(230, 80, 5, a);
    g.circle(cx, cy, maxR * 2 * (1 - t * 0.05));
    void (t);
  }
  return g;
}
