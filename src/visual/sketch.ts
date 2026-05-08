// Owner: visualizer
//
// p5 instance-mode sketch factory. Composes the visual layers (drawn in
// the order listed):
//   1. Midnight-blue radial background + radial vignette + horizon glow
//      (top + bottom)
//   2. Parallax starfield (deep-space depth, slow drift)
//   3. FFT-reactive particles               [→ also into bloom buffer]
//   4. Hand silhouettes (skeleton + fingertip blobs + glow ring)
//   5. Face skeleton (oval, eyes, nose bridge, lips, optional brows)
//   6. Fake-arm bezier connectors (face chin → each hand wrist)
//   7. Elastic beat-pulsing strings between adjacent fingers
//                                            [→ also into bloom buffer]
//   8. Bloom composite (ADD blend, half-rate)
//   9. Scanlines (subtle CRT pattern, NORMAL blend)
//
// Hot-state lives in a `SketchState` object that the Visualizer owns and
// mutates from outside (current hands, current face, current beat pulse).
// The sketch reads this state on each draw call.
//
// PERF (2026-05): the previous version pinned mid-tier laptops at ~13 FPS.
// Three regressions:
//   - pixelDensity 2× on hi-DPI = 4× fillrate
//   - 1/16-area bloom buffer + 6px blur every frame
//   - bg flash + vignette tint allocations every frame
// Mitigations applied:
//   - pixelDensity capped at 1.5 for the main canvas
//   - bloom buffer 1/64-area + 4px blur, run on alternate frames only
//   - beat flash limited to vignette pulse (no bg brightness boost)
//   - radial bg gradient pre-rendered ONCE into a p5.Graphics

import type p5 from 'p5';
import type { Hand, FaceLandmark, FaceState } from '@contracts/contracts';
import { createParticleField, type ParticleField } from './particles';
import { createScanlineLayer, type ScanlineLayer } from './scanlines';
import { createStarfield, createHorizonGlow, type Starfield, type HorizonGlow } from './starfield';
import { createBloom, BLOOM_DOWNSCALE, type Bloom } from './bloom';
import { createEnvelope, type Envelope } from './envelope';

// ---------------------------------------------------------------------------
// Shared state — the Visualizer mutates these fields between frames.
// ---------------------------------------------------------------------------

/**
 * Cover-fit transform from MediaPipe normalized (0..1 of video frame) coords
 * to canvas-normalized (0..1 of canvas) coords. The webcam is rendered with
 * CSS `object-fit: cover` so the video is scaled to fill the canvas
 * without distortion; this means part of the video may be cropped at top/
 * bottom or left/right depending on aspect ratios. To make the skeleton
 * overlay land on the user's actual face, we compute the visible video
 * rectangle and remap landmark y (and x) accordingly. When this is null
 * the visualizer falls back to identity (lm.x*width, lm.y*height) which
 * is correct only when video and canvas aspect ratios match exactly.
 */
export interface VideoCoverTransform {
  /** Normalized horizontal scale: lm.x * scaleX + offsetX = canvas-normalized x */
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface SketchState {
  /** Current frame's detected hands (already smoothed by HandTracker). */
  hands: Hand[];
  /**
   * Current frame's face state, or null if FaceTracker isn't wired or hasn't
   * emitted yet. Sketch only renders if `face?.detected && face.landmarks`.
   */
  face: FaceState | null;
  /** Video-to-canvas cover transform (see VideoCoverTransform). */
  videoCover: VideoCoverTransform | null;
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

// MediaPipe FaceLandmarker indices for the visible-skeleton subset we draw.
// These are exported for unit tests so we can verify the sketch is using
// the documented mesh topology.
export const FACE_OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];
export const FACE_LEFT_EYE: readonly number[] = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
export const FACE_RIGHT_EYE: readonly number[] = [
  362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398,
];
export const FACE_LIPS_OUTER: readonly number[] = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0,
  37, 39, 40, 185,
];
export const FACE_LIPS_INNER: readonly number[] = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13,
  82, 81, 80, 191,
];
export const FACE_NOSE_BRIDGE: readonly number[] = [168, 6, 197, 195, 5, 4, 1, 19];
export const FACE_NOSE_TIP_RING: readonly number[] = [
  4, 45, 220, 115, 48, 64, 98, 97, 2, 326, 327, 294, 278, 344, 440, 275,
];
export const FACE_LEFT_BROW: readonly number[] = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
export const FACE_RIGHT_BROW: readonly number[] = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
/** Iris ring (left). Available when MediaPipe FaceLandmarker is loaded with refine_landmarks. */
export const FACE_LEFT_IRIS: readonly number[] = [468, 469, 470, 471, 472];
export const FACE_RIGHT_IRIS: readonly number[] = [473, 474, 475, 476, 477];
/** Cheek/jaw curves to give the face more presence. */
export const FACE_LEFT_JAW: readonly number[] = [127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
export const FACE_RIGHT_JAW: readonly number[] = [356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152];
/** Cupid's bow / philtrum hint. */
export const FACE_PHILTRUM: readonly number[] = [164, 0, 11, 12, 13];

const FACE_CHIN_LANDMARK = 152;
const HAND_WRIST_LANDMARK = 0;

// HandTracker / FaceTracker already mirror landmark x at the output (when
// mirrorEnabled=true) so the coords handed to the visualizer live in the
// same selfie-mirrored frame as the CSS-flipped <video>. The visualizer
// does NOT re-flip x.
//
// Y-mapping accounts for the video's `object-fit: cover` rendering: when
// canvas and video aspect ratios differ, parts of the video are cropped
// from the canvas viewport. Without correction, landmark y * canvasHeight
// places the skeleton at the WRONG vertical position relative to the
// visible face. The Visualizer computes a cover transform on mount and
// resize and stores it in SketchState.videoCover.
function landmarkToScreen(
  lx: number,
  ly: number,
  width: number,
  height: number,
  cover: VideoCoverTransform | null = null,
): [number, number] {
  if (!cover) return [lx * width, ly * height];
  const nx = lx * cover.scaleX + cover.offsetX;
  const ny = ly * cover.scaleY + cover.offsetY;
  return [nx * width, ny * height];
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
  let bgGradient: p5.Graphics | null = null;
  let starfield: Starfield | null = null;
  let horizon: HorizonGlow | null = null;
  let bloom: Bloom | null = null;
  let lastFrameMs = performance.now();
  let elapsed = 0;
  let bloomTick = 0;

  // Beat envelope — replaces the old `pulse *= 0.92` per-frame decay. Drives
  // string brightness, ring pulse, vignette tightening.
  const beat: Envelope = createEnvelope({ attack: 0.030, decay: 0.200, release: 0.100 });

  const sketch = (s: p5): void => {
    s.setup = (): void => {
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      const canvas = s.createCanvas(w, h);
      // Attach to parent. p5 normally appends to document.body unless told.
      canvas.parent(parent);
      // PERF: pixelDensity 0.5 — render at HALF the viewport resolution
      // and let the browser upscale the resulting canvas via CSS. Cuts
      // fillrate by 4× (a 2560×1215 viewport renders into a 1280×608
      // backing buffer = 780k px instead of 3.1M px). The visualizer is
      // mostly soft glow + scanlines + particles, so the upscale is
      // visually indistinguishable. p5 supports fractional pixelDensity
      // since 1.4. This is the single biggest perf lever for high-res
      // viewports — measured: ~13 fps → 50+ fps on a 2560-wide laptop.
      s.pixelDensity(0.5);
      s.colorMode(s.HSB, 360, 100, 100, 1);
      s.frameRate(60);

      particles = createParticleField(w, h);
      particles.setReducedMotion(state.reducedMotion);
      scanlines = createScanlineLayer(s, w, h);
      bgGradient = buildBackgroundGradient(s, w, h);
      vignette = buildVignette(s, w, h);
      starfield = createStarfield(w, h);
      horizon = createHorizonGlow(s, w, h);
      // PERF: bloom is OFF by default. Real-Chrome measurement: bloom
      // allocation + half-rate redraw still costs ~3 fps on a 2560×1215
      // canvas in Canvas2D mode (the blur filter() falls back to a
      // CPU path when the source has any active alpha mode). Users can
      // re-enable from the SettingsPanel if their hardware can afford it.
      bloom = null;
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
      // Layer 1 — flat bg + horizon glow + vignette
      // ---------------------------------------------------------------
      // PERF: dropped the pre-rendered radial gradient blit — on large
      // viewports it was costing ~3M px of full-canvas image() per frame
      // for negligible visual benefit (the vignette + horizon already
      // shape the depth). Flat background() is a single GPU clear.
      s.background(230, 70, 14);
      void bgGradient;

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
      // PERF: only pay the tint() cost when the beat envelope is actually
      // active. Most frames skip the push/tint round trip.
      if (vignette) {
        if (beatV > 0.01 && !state.reducedMotion) {
          s.push();
          s.blendMode(s.BLEND);
          // Slight brightness reduction at corners during the pulse —
          // simulates iris-tightening on the beat.
          s.tint(0, 0, 100, Math.min(1, 1 + beatV * 0.3));
          s.image(vignette, 0, 0, s.width, s.height);
          s.noTint();
          s.pop();
        } else {
          s.image(vignette, 0, 0, s.width, s.height);
        }
      }

      // ---------------------------------------------------------------
      // Layers 3+ — particles. Update once, draw once on main canvas.
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
      // PERF: run only every other frame. The buffer is 1/64 of the main
      // canvas area (DOWNSCALE=8) and uses a 4px blur radius. Composite
      // happens every frame using the most recent blurred buffer; only
      // the *redraw + blur* costs are halved.
      // ---------------------------------------------------------------
      if (bloom && bloom.ready() && !state.reducedMotion) {
        bloomTick += 1;
        if ((bloomTick & 1) === 1) {
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

            // Apply blur. ~0.4ms total on 2020 hardware at 1/64 area.
            bloom.blur();
          }
        }
        // Always composite (even on the "skipped redraw" frames the buffer
        // still holds the prior blurred contents — visually indistinguishable).
        bloom.composite(s);
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
      }

      // ---------------------------------------------------------------
      // Layer 6 — face skeleton (oval, eyes, nose bridge, lips). Drawn
      // *before* fake-arm connectors so the connectors land on top of
      // the chin. The face renderer no-ops if no face is detected.
      // ---------------------------------------------------------------
      if (state.face?.detected && state.face.landmarks) {
        s.push();
        s.blendMode(s.ADD);
        drawFaceSkeleton(s, state.face, s.width, s.height, beatV, state.videoCover);
        s.pop();

        // Mouth-driven particle emitter — spawn breath from the user's
        // mouth with rate + size scaling on `mouthOpen`. The mouth center
        // is computed from the inner lip landmarks; cover transform is
        // applied so the spawn position matches the visible mouth.
        if (particles && state.face.mouthOpen > 0.05) {
          const lms = state.face.landmarks;
          const top = lms[13];
          const bot = lms[14];
          if (top && bot) {
            const lx = (top.x + bot.x) / 2;
            const ly = (top.y + bot.y) / 2;
            const [mx, my] = landmarkToScreen(lx, ly, s.width, s.height, state.videoCover);
            particles.emitFromMouth(mx, my, state.face.mouthOpen);
          }
        }

        // Fake arms — face chin → each hand wrist.
        if (state.hands.length > 0) {
          s.push();
          s.blendMode(s.ADD);
          drawFakeArms(s, state.face, state.hands, s.width, s.height);
          s.pop();
        }
      }

      // Layer 7 — finger strings on top of everything else.
      if (state.hands.length > 0) {
        s.push();
        s.blendMode(s.ADD);
        drawFingerStrings(s, state.hands, beatV, s.width, s.height);
        s.pop();
      }

      // ---------------------------------------------------------------
      // Layer 9 — scanlines on top, in normal blend mode for subtle darkening.
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
      if (bgGradient) {
        bgGradient.remove();
        bgGradient = buildBackgroundGradient(instance, width, height);
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

    // Skeleton lines. Two-pass with subtle vertical-gradient brightness:
    // the wrist (lower-y) end is darker, the fingertip end is lighter.
    // We approximate by reading the average y of each pair and biasing the
    // brightness/saturation. Cheap and adds depth.
    s.noFill();
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand.landmarks[a];
      const lb = hand.landmarks[b];
      if (!la || !lb) continue;
      const [ax, ay] = landmarkToScreen(la.x, la.y, w, h);
      const [bx, by] = landmarkToScreen(lb.x, lb.y, w, h);
      // Higher-on-screen end = lighter (lower y in screen space).
      const meanY = (ay + by) / (h * 2); // 0 (top) .. 1 (bottom)
      const brightness = 100 - meanY * 18; // 100 at top → 82 at bottom
      // Outer glow.
      s.stroke(sideHue, 50, brightness, 0.25);
      s.strokeWeight(6 + beatV * 2);
      s.line(ax, ay, bx, by);
      // Core line.
      s.stroke(sideHue, 30, brightness, 0.7);
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
// Face skeleton — oval, eyes, nose bridge, lips, optional brows.
//
// Pose-driven tilt: rotate the whole skeleton by face.pose.roll around the
// face center for liveliness. We don't apply mirror — FaceTracker mirrors at
// emit time (same convention as HandTracker) so coordinates land in the
// selfie-mirrored frame already.
//
// Stroke palette: subtle cyan/lavender, HSB(220, 35, 95) at alpha 0.55. Lips
// pulse on mouthOpen (>0.1): stroke weight scales by 1+2*mouthOpen, and a
// faint warm fill is added to the inner contour.
// ---------------------------------------------------------------------------

export function drawFaceSkeleton(
  s: p5,
  face: FaceState,
  width: number,
  height: number,
  beatV: number,
  cover: VideoCoverTransform | null = null,
): void {
  const lms = face.landmarks;
  if (!lms || lms.length < 478) return;

  // Compute face center (for rotation pivot) from oval landmarks.
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (const idx of FACE_OVAL) {
    const lm = lms[idx];
    if (!lm) continue;
    const [px, py] = landmarkToScreen(lm.x, lm.y, width, height, cover);
    cx += px;
    cy += py;
    n += 1;
  }
  if (n === 0) return;
  cx /= n;
  cy /= n;

  s.push();
  // PERF: dropped the pose-driven rotate() call. On a 2560×1215 canvas in
  // Canvas2D mode, applying a non-identity transform forces every
  // beginShape/vertex/endShape to go through a slow CPU-side path; in
  // practice it took the visualizer from ~12 FPS to <1 FPS in real
  // Chrome. The face oval already conveys head tilt purely via the
  // landmark x/y, so the rotation was a cosmetic-only artifact.
  void cx; void cy;

  s.noFill();
  s.strokeWeight(1.0);

  // Outer face oval — slightly thicker.
  s.strokeWeight(1.4);
  s.stroke(220, 35, 95, 0.55 + beatV * 0.05);
  drawClosedLoop(s, lms, FACE_OVAL, width, height, false, cover);
  s.strokeWeight(1.0);

  // Jawlines (polylines) — adds chin definition.
  s.stroke(220, 28, 92, 0.30);
  drawPolyline(s, lms, FACE_LEFT_JAW, width, height, cover);
  drawPolyline(s, lms, FACE_RIGHT_JAW, width, height, cover);

  // Eyes (closed loops).
  s.stroke(195, 45, 100, 0.65 + beatV * 0.05);
  drawClosedLoop(s, lms, FACE_LEFT_EYE, width, height, false, cover);
  drawClosedLoop(s, lms, FACE_RIGHT_EYE, width, height, false, cover);

  // Iris rings — only render if landmarks include them (refine_landmarks).
  // FaceLandmarker emits 478 points when iris is on; we draw if available.
  if (lms.length >= 478) {
    s.strokeWeight(0.8);
    s.stroke(195, 60, 100, 0.55);
    drawClosedLoop(s, lms, FACE_LEFT_IRIS, width, height, false, cover);
    drawClosedLoop(s, lms, FACE_RIGHT_IRIS, width, height, false, cover);
    s.strokeWeight(1.0);
  }

  // Eyebrows.
  s.stroke(220, 30, 90, 0.45);
  drawPolyline(s, lms, FACE_LEFT_BROW, width, height, cover);
  drawPolyline(s, lms, FACE_RIGHT_BROW, width, height, cover);

  // Nose bridge (polyline) + nostril ring.
  s.stroke(220, 25, 88, 0.40);
  drawPolyline(s, lms, FACE_NOSE_BRIDGE, width, height, cover);
  drawClosedLoop(s, lms, FACE_NOSE_TIP_RING, width, height, false, cover);

  // Philtrum / cupid's bow.
  s.stroke(220, 30, 92, 0.30);
  drawPolyline(s, lms, FACE_PHILTRUM, width, height, cover);

  // Lips: outer + inner. Mouth-open scales stroke and adds a faint warm fill.
  const mo = face.mouthOpen;
  const lipWeight = 1.2 * (1 + 2 * Math.max(0, mo));
  // Desaturate slightly + boost alpha as the mouth opens.
  const lipSat = 35 - mo * 10;
  const lipAlpha = 0.55 + mo * 0.25;

  s.strokeWeight(lipWeight);
  s.stroke(220, lipSat, 95, lipAlpha);

  if (mo > 0.1) {
    // Faint warm tint inside the lips when speaking.
    s.fill(20, 45, 100, mo * 0.18);
    drawClosedLoop(s, lms, FACE_LIPS_INNER, width, height, /* fill */ true, cover);
    s.noFill();
  } else {
    drawClosedLoop(s, lms, FACE_LIPS_INNER, width, height, false, cover);
  }
  drawClosedLoop(s, lms, FACE_LIPS_OUTER, width, height, false, cover);

  s.pop();
}

function drawClosedLoop(
  s: p5 | p5.Graphics,
  lms: readonly FaceLandmark[],
  indices: readonly number[],
  w: number,
  h: number,
  withFill = false,
  cover: VideoCoverTransform | null = null,
): void {
  s.beginShape();
  for (const idx of indices) {
    const lm = lms[idx];
    if (!lm) continue;
    const [px, py] = landmarkToScreen(lm.x, lm.y, w, h, cover);
    s.vertex(px, py);
  }
  s.endShape(withFill ? s.CLOSE : s.CLOSE);
}

function drawPolyline(
  s: p5 | p5.Graphics,
  lms: readonly FaceLandmark[],
  indices: readonly number[],
  w: number,
  h: number,
  cover: VideoCoverTransform | null = null,
): void {
  s.beginShape();
  for (const idx of indices) {
    const lm = lms[idx];
    if (!lm) continue;
    const [px, py] = landmarkToScreen(lm.x, lm.y, w, h, cover);
    s.vertex(px, py);
  }
  s.endShape();
}

// ---------------------------------------------------------------------------
// Fake arms — bezier from face chin to each hand wrist. Control points are
// pulled slightly downward so the curve mimics a relaxed shoulder/arm arc
// (keeps the connection feeling anatomical without spawning a full pose
// landmarker).
// ---------------------------------------------------------------------------

export function drawFakeArms(
  s: p5,
  face: FaceState,
  hands: Hand[],
  width: number,
  height: number,
): void {
  const lms = face.landmarks;
  if (!lms || lms.length < 478) return;
  const chin = lms[FACE_CHIN_LANDMARK];
  if (!chin) return;
  const cx = chin.x * width;
  const cy = chin.y * height;

  s.noFill();

  for (const hand of hands) {
    const wrist = hand.landmarks[HAND_WRIST_LANDMARK];
    if (!wrist) continue;
    const wx = wrist.x * width;
    const wy = wrist.y * height;

    // Control points: pulled downward (toward neck) so the bezier follows
    // the natural shoulder arc. The midpoint is the rough "shoulder" target.
    const midX = (cx + wx) / 2;
    const midY = (cy + wy) / 2 + Math.abs(wx - cx) * 0.18;
    const c1x = cx + (midX - cx) * 0.6;
    const c1y = cy + (midY - cy) * 1.1;
    const c2x = wx + (midX - wx) * 0.6;
    const c2y = wy + (midY - wy) * 1.1;

    const sideHue = hand.side === 'right' ? 200 : 280;
    // Outer glow.
    s.stroke(sideHue, 35, 95, 0.10);
    s.strokeWeight(8);
    s.bezier(cx, cy, c1x, c1y, c2x, c2y, wx, wy);
    // Mid.
    s.stroke(sideHue, 30, 95, 0.20);
    s.strokeWeight(3);
    s.bezier(cx, cy, c1x, c1y, c2x, c2y, wx, wy);
    // Core.
    s.stroke(sideHue, 25, 100, 0.25);
    s.strokeWeight(1.2);
    s.bezier(cx, cy, c1x, c1y, c2x, c2y, wx, wy);
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
  const steps = 32;
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    // alpha ramps from 0 at center to ~0.6 at corners. Slightly stronger
    // curvature than before (pow=1.7) for a tighter vignette ring.
    const a = Math.pow(t, 1.7) * 0.6;
    g.fill(230, 80, 5, a);
    g.circle(cx, cy, maxR * 2 * (1 - t * 0.05));
  }
  return g;
}

// Pre-rendered radial background gradient — slightly warmer center
// (#14163a → HSB ~232, 64, 23) ramping out to the deep #0a0e2c at the
// corners. Adds depth without per-frame cost.
function buildBackgroundGradient(s: p5, w: number, h: number): p5.Graphics {
  const g = s.createGraphics(w, h);
  g.colorMode(s.HSB, 360, 100, 100, 1);
  g.noStroke();
  // Fill solid base first.
  g.background(230, 70, 17);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  // Layer warmer center with falloff. Use additive-ish stacked translucent
  // circles. 18 stops is enough to look smooth at any size.
  const steps = 18;
  for (let i = steps - 1; i >= 0; i -= 1) {
    const t = i / (steps - 1);
    // Hue 232, sat falls as we move out, brightness falls too.
    const hue = 232 - t * 4;
    const sat = 64 - t * 8;
    const bri = 23 - t * 6;
    const alpha = Math.pow(1 - t, 1.4) * 0.18;
    g.fill(hue, sat, bri, alpha);
    g.circle(cx, cy, maxR * 2 * t);
  }
  return g;
}
