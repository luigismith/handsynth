// Owner: visualizer
//
// p5 instance-mode sketch factory. Composes the four visual layers:
//   1. Midnight-blue background + radial vignette
//   2. CRT scanlines (pre-rendered)
//   3. FFT-reactive particles
//   4. Hand silhouettes (skeleton + fingertip blobs)
//   5. Elastic beat-pulsing strings between adjacent fingers
//
// Hot-state lives in a `SketchState` object that the Visualizer owns and
// mutates from outside (current hands, current beat pulse). The sketch reads
// this state on each draw call.

import type p5 from 'p5';
import type { Hand } from '@contracts/contracts';
import { createParticleField, type ParticleField } from './particles';
import { createScanlineLayer, type ScanlineLayer } from './scanlines';

// ---------------------------------------------------------------------------
// Shared state — the Visualizer mutates these fields between frames.
// ---------------------------------------------------------------------------

export interface SketchState {
  /** Current frame's detected hands (already smoothed by HandTracker). */
  hands: Hand[];
  /** Beat pulse, set to 1.0 on each beat, decays exponentially per frame. */
  pulse: number;
  /** FFT bins (Uint8, 0..255). Visualizer fills this once per draw. */
  fftBins: Uint8Array;
  /** True when the analyser tap is wired up. */
  hasAnalyser: boolean;
}

// MediaPipe hand-landmark topology. Each pair = a connection to draw.
// Indices follow MediaPipe HandLandmarker ordering:
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
  let lastFrameMs = performance.now();

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
      scanlines = createScanlineLayer(s, w, h);
      vignette = buildVignette(s, w, h);
    };

    s.draw = (): void => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;

      // Layer 1 — background.
      // Midnight blue: HSB(230, 70, 17) ≈ #0a0e2c
      s.background(230, 70, 17);
      if (vignette) {
        s.push();
        s.blendMode(s.BLEND);
        s.image(vignette, 0, 0, s.width, s.height);
        s.pop();
      }

      // Layer 3 — particles. Update first, then draw with additive blend.
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

      // Layer 4 — hand silhouettes.
      if (state.hands.length > 0) {
        s.push();
        s.blendMode(s.ADD);
        drawHands(s, state.hands, state.pulse);
        s.pop();
      }

      // Layer 5 — elastic strings. Drawn between fingertips on each hand.
      if (state.hands.length > 0) {
        s.push();
        s.blendMode(s.ADD);
        drawFingerStrings(s, state.hands, state.pulse);
        s.pop();
      }

      // Layer 2 — scanlines on top, in normal blend mode for subtle darkening.
      if (scanlines) {
        scanlines.draw(s, s.frameCount * 0.5);
      }

      // Decay pulse.
      state.pulse *= 0.92;
      if (state.pulse < 0.001) state.pulse = 0;
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
      if (particles) particles.reset(width, height);
    },
  };
}

// ---------------------------------------------------------------------------
// Hand drawing
// ---------------------------------------------------------------------------

function drawHands(s: p5, hands: Hand[], pulse: number): void {
  const w = s.width;
  const h = s.height;

  for (const hand of hands) {
    const sideHue = hand.side === 'right' ? 200 : 280; // cyan for right, violet for left

    // Skeleton lines.
    s.noFill();
    s.strokeWeight(2.5 + pulse * 1.0);
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand.landmarks[a];
      const lb = hand.landmarks[b];
      if (!la || !lb) continue;
      const [ax, ay] = landmarkToScreen(la.x, la.y, w, h);
      const [bx, by] = landmarkToScreen(lb.x, lb.y, w, h);
      // Outer glow.
      s.stroke(sideHue, 50, 100, 0.25);
      s.strokeWeight(6 + pulse * 2);
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
      const baseR = 8 + pulse * 6;
      s.fill(sideHue, 40, 100, 0.5);
      s.circle(x, y, baseR * 1.0);
      s.fill(sideHue, 20, 100, 0.25);
      s.circle(x, y, baseR * 2.2);
      s.fill(sideHue, 10, 100, 0.12);
      s.circle(x, y, baseR * 4.0);
    }
  }
}

// ---------------------------------------------------------------------------
// Elastic strings — pulse on the beat
// ---------------------------------------------------------------------------

function drawFingerStrings(s: p5, hands: Hand[], pulse: number): void {
  const w = s.width;
  const h = s.height;

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

    const brightness = 0.6 + 0.4 * pulse;
    const thickness = 1.4 + pulse * 1.6;

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
