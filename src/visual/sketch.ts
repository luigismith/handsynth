// Owner: visualizer
//
// p5 instance-mode sketch factory. Composes the visual layers (drawn in
// the order listed):
//   1. Charcoal background + static hex grid + horizon glow (warm)
//   2. Vignette (warm-on-beat)
//   3. Parallax starfield (dim grey, subtle drift)
//   4. FFT-reactive triangle particles      [→ also into bloom buffer]
//   5. Hand silhouettes (skeleton + diamond fingertips + hex glow ring)
//   6. Face skeleton (oval, eyes, nose bridge, lips)
//   7. Fake-arm bezier connectors (face chin → each hand wrist)
//   8. Elastic beat-pulsing strings between adjacent fingers
//                                            [→ also into bloom buffer]
//   9. Bloom composite (ADD blend, half-rate)
//   10. Scanlines (subtle CRT pattern + occasional tear flash)
//
// AESTHETIC: cyberpunk low-poly, orange / black / grey palette.
// All colors live in the HSB triples below — no hardcoded magic numbers in
// the draw helpers (so a future palette tweak is a one-line change).
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
//   - pixelDensity capped at 0.5 for the main canvas
//   - bloom buffer 1/64-area + 4px blur, run on alternate frames only
//   - beat flash limited to vignette pulse (no bg brightness boost)
//   - hex grid pre-rendered ONCE into a p5.Graphics (static, no animation)
//   - hand glow ring is now a hex outline (1 stroke) instead of three
//     concentric strokes — saves two stroke()+circle() calls per hand

import type p5 from 'p5';
import type { Hand, FaceLandmark, FaceState } from '@contracts/contracts';
// FOCUSED MOUTH EMITTER: replaces the deleted generic ParticleField. Only
// emits from the lip line, only when the user opens their mouth. The audio
// side of the same feature lives in InteractionMapper.handleFaceUpdate
// (delay-wet sweep, brightness lift, harmony-aware flourish on rising edge).
// User asked: "rimetti le particelle che escono dalla bocca proporzionalmente
// a quanto la apro, rendi questa feature stupenda".
import { createMouthEmitter, type MouthEmitter } from './mouth-emitter';
import { createScanlineLayer, type ScanlineLayer } from './scanlines';
import { createStarfield, createHorizonGlow, type Starfield, type HorizonGlow } from './starfield';
// `createBloom` is intentionally imported but currently unused at runtime
// — bloom is OFF by default for performance (~3 fps cost on 2560×1215
// Canvas2D). The import is preserved so the SettingsPanel re-enable path
// can flip it on without an import-edit cycle. See the `bloom = null`
// comment in `setup` below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { createBloom, BLOOM_DOWNSCALE, type Bloom } from './bloom';
import { createEnvelope, type Envelope } from './envelope';

// ---------------------------------------------------------------------------
// Cyberpunk palette — HSB triples. The sketch uses HSB color mode.
// ---------------------------------------------------------------------------

// Backgrounds & lines
const BG_DEEP = { h: 240, s: 12, b: 5 } as const;       // near-black, faint cool tint
const BG_PANEL = { h: 240, s: 18, b: 9 } as const;      // charcoal
const GREY_LINE = { h: 240, s: 12, b: 22 } as const;    // neutral grey for line work
// GREY_DIM kept for reference; consumed inline by starfield/scanlines.
// const GREY_DIM = { h: 240, s: 10, b: 42 } as const;

// Accents
const ORANGE_HOT = { h: 22, s: 92, b: 100 } as const;   // primary accent
const ORANGE_GLOW = { h: 28, s: 75, b: 100 } as const;  // outer glow / softer warm
const AMBER_BEAT = { h: 35, s: 75, b: 100 } as const;   // beat pulse / focus
const ORANGE_DARK = { h: 18, s: 95, b: 78 } as const;   // pressed / shadow accent

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
  /**
   * One-shot trigger for beat-1 only (downbeats — first beat of each bar).
   * Visualizer sets this to 1.0 when the incoming `onBeat` index is a
   * multiple of 4; the sketch consumes it for a quick 60ms hex-grid
   * brightness burst, then clears the flag. Reduced-motion safe (sketch
   * skips the burst when reducedMotion is set).
   */
  downbeatPulse: number;
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
  /**
   * Idle fade-in factor 0..1 — 1 = hands present (full alpha grid +
   * full-speed particles), 0 = no hands seen for >2s (grid alpha drops
   * to ~30%, particles drift slower). The Visualizer lerps this over
   * ~800ms on state change so the transition reads as "sleep / wake"
   * rather than a hard snap.
   */
  presence: number;
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
//   thumb tip (4), index tip (8), middle tip (12), ring tip (16), pinky tip (20)
// User feedback: "perché il pollice non è legato come le altre dita?" — the
// thumb (4) was originally excluded because the thumb→index segment crosses
// the palm at a steep angle, but visually the user expects it connected to
// the rest of the hand's spider-web. Added.
const FINGER_STRING_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [4, 8],
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
  // Mouth particle emitter — created in setup(), lives across resizes (no
  // buffer to leak; just a JS object holding a 32-slot pool).
  let mouth: MouthEmitter | null = null;
  // Rising-edge tracker for mouth-burst. Mirrors the audio-side hysteresis
  // (FACE_MOUTH_STAB_THRESHOLD=0.6 / FACE_MOUTH_STAB_RELEASE=0.4) so the
  // visual flourish lands in lock-step with the harmonic flourish.
  let mouthOpenHigh = false;
  const MOUTH_BURST_ENTER = 0.6;
  const MOUTH_BURST_EXIT = 0.4;
  let scanlines: ScanlineLayer | null = null;
  let vignette: p5.Graphics | null = null;
  let hexGrid: p5.Graphics | null = null;
  let starfield: Starfield | null = null;
  let horizon: HorizonGlow | null = null;
  let bloom: Bloom | null = null;
  let lastFrameMs = performance.now();
  let elapsed = 0;
  let bloomTick = 0;
  // Smoothed mean hand-x (canvas-relative, -1..1) for hex-grid parallax.
  // Lerped each frame toward the actual position so the world panning
  // motion stays gentle — no jitter when hands stutter.
  let smoothedHandX = 0;
  // Downbeat (beat-1) flash timer. Counts down ~60ms after each downbeat;
  // while >0 the hex grid renders with a brightness boost.
  let downbeatFlashMs = 0;
  // Hand openness hysteresis tracker. Per-hand sticky flag for the
  // chromatic-aberration halo: enters on >0.7, exits on <0.5.
  const haloActive = new Map<string, boolean>();
  // PERF (v0.3.0 freeze fix): frame counter for sub-rate visuals. Three
  // visual elements added in the v0.3.0 aesthetics wave compound the
  // per-frame work to the point that audio scheduling stalls. We throttle
  // each to a lower update rate where it's visually indistinguishable:
  //   - parallax mean-X lerp updated every PARALLAX_THROTTLE frames
  //     (~7.5 Hz at frameRate 30). Hands rarely move >50 px/frame.
  //   - chromatic halo rendered every HALO_THROTTLE frames (~15 Hz). The
  //     halo is a soft chromatic edge — at 15 Hz the eye reads it as a
  //     continuous accent.
  //   - face oval OUTER-GLOW pass rendered every OVAL_GLOW_THROTTLE frames
  //     (~15 Hz). The crisp inner stroke remains per-frame so the face
  //     skeleton itself never lags; the halo is the slow visual element.
  let frameTick = 0;
  const PARALLAX_THROTTLE = 4;
  const HALO_THROTTLE = 2;
  const OVAL_GLOW_THROTTLE = 2;

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
      // visually indistinguishable.
      s.pixelDensity(0.5);
      s.colorMode(s.HSB, 360, 100, 100, 1);
      // PERF: cap visualizer draw at 30 fps (was 60). The visualizer
      // mostly shows slow soft-glow content and a hand/face skeleton that
      // moves at human speed; 30 fps reads as "smooth enough" for this
      // material. Halving the draw rate halves the main-thread time spent
      // in p5's hot loop, leaving the audio scheduler enough headroom to
      // post sample-accurate triggers without underruns.
      // LITE MODE: 30 → 24 fps. p5 redraw cycle is the second biggest
      // main-thread consumer after MediaPipe. 24 fps reads as cinematic
      // and is still smooth for the visualizer; gives MediaPipe + audio
      // a ~20% headroom boost.
      s.frameRate(24);

      mouth = createMouthEmitter();
      mouth.setReducedMotion(state.reducedMotion);
      scanlines = createScanlineLayer(s, w, h);
      hexGrid = buildHexGrid(s, w, h);
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
      frameTick = (frameTick + 1) | 0;

      // Forward "trigger intent" from state.pulse into the beat envelope,
      // then clear state.pulse so the same beat isn't re-triggered.
      if (state.pulse > 0.5) {
        beat.trigger(1.0);
        state.pulse = 0;
      }
      // Downbeat (beat-1) burst — 60ms hex-grid brightness pulse. Skipped
      // under reduced-motion. We arm the flash timer here and decrement it
      // in the integration step below so the burst is frame-rate agnostic.
      if (state.downbeatPulse > 0.5) {
        if (!state.reducedMotion) downbeatFlashMs = 60;
        state.downbeatPulse = 0;
      }
      if (downbeatFlashMs > 0) downbeatFlashMs = Math.max(0, downbeatFlashMs - dt * 1000);
      beat.step(dt);
      const beatV = beat.value;

      // Forward reduced-motion to the mouth emitter so emission rates drop.
      // Cheap (just a boolean assign) — fine to call every frame.
      if (mouth) mouth.setReducedMotion(state.reducedMotion);
      // Step the mouth simulation each frame regardless of detection state
      // so already-spawned particles continue to drift/fade out smoothly
      // even when the user turns away from the camera mid-syllable.
      if (mouth) mouth.update(dt);

      // Smooth the mean hand X for parallax. We compute *canvas-relative*
      // -1..1 so it doesn't depend on canvas size: 0 = center, ±1 = far
      // side.
      //
      // PERF (v0.3.0 freeze fix): updated every PARALLAX_THROTTLE frames
      // (~7.5 Hz at 30 fps). Hand wrist position rarely moves more than
      // 50 px/frame at the smoothed output of the HandTracker, so the
      // discrete 4-frame steps are perceptually indistinguishable from
      // the per-frame lerp. We compensate by using a larger effective dt
      // in the exponential so the visible follow speed stays the same.
      if (frameTick % PARALLAX_THROTTLE === 0) {
        let targetHandX = 0;
        if (state.hands.length > 0) {
          let sum = 0;
          let n = 0;
          for (const h of state.hands) {
            const lm = h.landmarks[0]; // wrist
            if (!lm) continue;
            sum += lm.x; // already 0..1
            n += 1;
          }
          if (n > 0) targetHandX = (sum / n) * 2 - 1;
        }
        // Disable parallax under reduced-motion.
        if (state.reducedMotion) targetHandX = 0;
        // Use the accumulated dt-since-last-throttle, capped to the same
        // 0.05 s ceiling as the main step; PARALLAX_THROTTLE * dt is a
        // close approximation, and the exponential lerp self-corrects.
        const lerpK = 1 - Math.exp(-dt * PARALLAX_THROTTLE * 6);
        smoothedHandX += (targetHandX - smoothedHandX) * lerpK;
      }

      // ---------------------------------------------------------------
      // Layer 1 — charcoal background + static hex grid backdrop.
      // ---------------------------------------------------------------
      // BG_DEEP — near-black with a faint cool tint. A flat clear is the
      // cheapest possible "background"; depth comes from the hex grid +
      // horizon glow + vignette layered on top.
      s.background(BG_DEEP.h, BG_DEEP.s, BG_DEEP.b);

      // Hex grid backdrop — pre-rendered once. Single image() blit per
      // frame, with cheap modifications layered on:
      //   - parallax offset: ±6px X based on smoothed mean hand position.
      //     Very subtle (no motion sickness). Disabled if reducedMotion.
      //   - presence (idle) alpha: full at 1.0, ~30% when no hands seen
      //     for >2s. Lerped externally by the Visualizer.
      //   - downbeat burst: 60ms +15% brightness right after a downbeat.
      //     The tint() pushes the image() output brighter. Reduced-motion
      //     safe (the flash timer is never armed under reduced-motion).
      if (hexGrid) {
        s.push();
        s.blendMode(s.BLEND);
        // Parallax offset in pixels. 6px reads as a gentle shift at most
        // viewport sizes; clamp under reduced-motion is enforced upstream
        // (smoothedHandX stays 0).
        const px = smoothedHandX * -6;
        // Presence/idle alpha: maps 0..1 → 0.3..1.0.
        const presenceAlpha = 0.3 + 0.7 * state.presence;
        // Downbeat boost — only when timer is active.
        const burstFactor = downbeatFlashMs > 0 ? 1.15 : 1.0;
        const finalAlpha = Math.min(1, presenceAlpha * burstFactor);
        if (finalAlpha >= 0.999) {
          // No tint() needed — single fast blit.
          s.image(hexGrid, px, 0, s.width, s.height);
        } else {
          // Apply alpha via tint(). HSB tint with full brightness — we
          // only modulate the alpha channel.
          s.tint(0, 0, 100, finalAlpha);
          s.image(hexGrid, px, 0, s.width, s.height);
          s.noTint();
        }
        s.pop();
      }

      // Horizon glow at the bottom — warm city-floor cue. Intensity rises
      // slightly on beat, capped at 1.2.
      if (horizon) {
        horizon.draw(s, s.width, s.height, 1 + beatV * 0.2);
      }

      // ---------------------------------------------------------------
      // Layer 2 — parallax starfield (BLEND, low alpha, dim grey)
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
          // ORANGE_DARK warm vignette pulse on beat — alpha caps at 0.15.
          // It's a tactile pulse, not a flash.
          const pulseAlpha = Math.min(0.15, beatV * 0.15);
          s.tint(ORANGE_DARK.h, ORANGE_DARK.s, ORANGE_DARK.b, 1 + pulseAlpha);
          s.image(vignette, 0, 0, s.width, s.height);
          s.noTint();
          s.pop();
        } else {
          s.image(vignette, 0, 0, s.width, s.height);
        }
      }

      // (removed: particles layer)

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

            // (removed: particles in bloom buffer)

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
        // Yaw influences hex ring rotation when face is detected.
        const yaw = state.face?.detected ? (state.face.pose.yaw ?? 0) : 0;
        s.push();
        s.blendMode(s.ADD);
        drawHandRings(s, state.hands, beatV, elapsed, yaw);
        drawHands(s, state.hands, beatV);
        // Chromatic-aberration halo on wide-open fingertips. Hysteresis:
        // halo engages on openness > 0.7, releases under 0.5. Tracked per
        // hand by `side` (left/right) — stable across frames.
        // Skipped entirely under reduced-motion.
        //
        // PERF (v0.3.0 freeze fix): the halo draws 2 stroke circles per
        // fingertip × 5 fingertips × up-to-2 hands = up to 20 strokes per
        // frame. Cut to every-other-frame for ~15 Hz halo refresh — the
        // chromatic edge reads as continuous accent at that rate. We
        // still update the hysteresis state every frame so the halo
        // engages/releases without a 1-frame stagger.
        if (!state.reducedMotion) {
          const renderHalo = frameTick % HALO_THROTTLE === 0;
          for (const hand of state.hands) {
            const prev = haloActive.get(hand.side) ?? false;
            const next = prev ? hand.openness > 0.5 : hand.openness > 0.7;
            haloActive.set(hand.side, next);
            if (next && renderHalo) drawHandHalo(s, hand);
          }
        }
        s.pop();
      } else {
        // Drop any stale halo flags when both hands disappear so the
        // next time a hand returns it re-evaluates from scratch.
        if (haloActive.size > 0) haloActive.clear();
      }

      // ---------------------------------------------------------------
      // Layer 6 — face skeleton (oval, eyes, nose bridge, lips). Drawn
      // *before* fake-arm connectors so the connectors land on top of
      // the chin. The face renderer no-ops if no face is detected.
      // ---------------------------------------------------------------
      if (state.face?.detected && state.face.landmarks) {
        s.push();
        s.blendMode(s.ADD);
        // PERF: render the face-oval outer-glow pass at half rate. The
        // crisp inner stroke (and all other face features) still draw
        // every frame; only the wide 2.1-weight oval glow halves.
        const renderOvalGlow = frameTick % OVAL_GLOW_THROTTLE === 0;
        drawFaceSkeleton(
          s,
          state.face,
          s.width,
          s.height,
          beatV,
          state.videoCover,
          renderOvalGlow,
        );
        s.pop();

        // -------------------------------------------------------------
        // Mouth particle emission. We compute the lip-line center from
        // the inner-lip landmarks (which form a tight ring around the
        // mouth aperture) instead of relying on the chin or the lip
        // centroid — inner-lip gives us the exact pixel where the user's
        // breath would visually originate.
        // -------------------------------------------------------------
        if (mouth) {
          const mo = state.face.mouthOpen;
          let mcx = 0;
          let mcy = 0;
          let mn = 0;
          const lms = state.face.landmarks;
          if (lms) {
            for (const idx of FACE_LIPS_INNER) {
              const lm = lms[idx];
              if (!lm) continue;
              const [px, py] = landmarkToScreen(
                lm.x,
                lm.y,
                s.width,
                s.height,
                state.videoCover,
              );
              mcx += px;
              mcy += py;
              mn += 1;
            }
          }
          if (mn > 0) {
            mcx /= mn;
            mcy /= mn;
            // Rising-edge burst — mirrors InteractionMapper's audio
            // flourish trigger. Hysteresis identical to keep visual/audio
            // synced (enter at 0.6, exit at 0.4).
            if (!mouthOpenHigh && mo >= MOUTH_BURST_ENTER) {
              mouthOpenHigh = true;
              if (!state.reducedMotion) mouth.emitBurst(mcx, mcy, mo);
            } else if (mouthOpenHigh && mo <= MOUTH_BURST_EXIT) {
              mouthOpenHigh = false;
            }
            // Continuous stream proportional to mouthOpen.
            mouth.emit(mcx, mcy, mo);
          }
        }
        // NB: mouth.draw() happens AFTER the face block so already-alive
        // particles keep drifting + fading even if the user briefly turns
        // their head and the FaceTracker drops detection.

        // Fake arms — face chin → each hand wrist.
        if (state.hands.length > 0) {
          s.push();
          s.blendMode(s.ADD);
          drawFakeArms(s, state.face, state.hands, s.width, s.height);
          s.pop();
        }

      }

      // Mouth particles — draw after the face block so live particles
      // continue rendering even while face detection is momentarily lost.
      // ADD blend so the sparkles stack into a warm bloom over the lip.
      if (mouth) {
        s.push();
        s.blendMode(s.ADD);
        mouth.draw(s);
        s.pop();
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
      // Also handles the occasional ORANGE_DARK tear-line glitch flash.
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
      // BUG FIX v2 (live capture: "rallenta sempre di più"):
      // The earlier try/catch fix on .remove() prevented the crash but
      // the OLD buffer stayed in p5's internal element tracker because
      // .remove() threw before completing — so each resize tick leaked
      // a vignette + a hexGrid p5.Graphics (2 buffers). Browsers fire
      // resize spontaneously every 20-30 s on this layout (font load,
      // devicePixelRatio jitter, video-stream dimension settling), so
      // over 5 minutes that's ~15 leaked buffers = 50-100 MB canvas
      // memory. Progressive slowdown + audio glitches inevitable.
      //
      // Fix: REUSE the existing buffer. resizeCanvas() on the
      // p5.Graphics then re-paint via the paintVignette / paintHexGrid
      // helpers (extracted from build* so they can run against an
      // existing canvas). Zero allocations on resize tick. The .remove()
      // call path is gone entirely.
      if (vignette) {
        try {
          vignette.resizeCanvas(width, height);
          paintVignette(vignette, width, height);
        } catch (e) {
          console.warn('[sketch] vignette repaint failed', e);
        }
      }
      if (hexGrid) {
        try {
          hexGrid.resizeCanvas(width, height);
          paintHexGrid(hexGrid, width, height);
        } catch (e) {
          console.warn('[sketch] hexGrid repaint failed', e);
        }
      }
      if (starfield) starfield.reset(width, height);
      if (horizon) horizon.resize(instance, width, height);
      if (bloom) bloom.resize(instance, width, height);
      // Clear live mouth particles so they don't land at the wrong
      // pixel coords after the lip-line shifts under the new canvas size.
      if (mouth) mouth.reset();
    },
  };
}

// ---------------------------------------------------------------------------
// Hand glow ring — a single rotating hex outline around each palm.
// Cheap: 1 polygon (6 line segments) per hand. Total: 12 segments / frame
// for two hands. Massively cheaper than the previous three-layer wash.
// ---------------------------------------------------------------------------

function drawHandRings(
  s: p5,
  hands: Hand[],
  beatV: number,
  elapsed: number,
  yaw: number,
): void {
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
    const openR = baseR * (1 + hand.openness * 0.6);
    const ringR = openR * (1 + beatV * 0.15);

    // Rotation: slow ambient drift, biased by face yaw if available.
    // 1 full rotation every ~12s at rest.
    const rot = elapsed * 0.5 + yaw * 0.6;

    s.push();
    s.translate(cx, cy);
    s.rotate(rot);
    s.noFill();
    s.stroke(ORANGE_GLOW.h, ORANGE_GLOW.s, ORANGE_GLOW.b, 0.45 + beatV * 0.25);
    s.strokeWeight(1);
    // 6-sided polygon (hexagon).
    s.beginShape();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      s.vertex(Math.cos(a) * ringR, Math.sin(a) * ringR);
    }
    s.endShape(s.CLOSE);
    s.pop();
  }
}

// ---------------------------------------------------------------------------
// Hand drawing
// ---------------------------------------------------------------------------

function drawHands(s: p5, hands: Hand[], beatV: number): void {
  const w = s.width;
  const h = s.height;

  for (const hand of hands) {
    // Right hand → ORANGE_HOT, left hand → AMBER_BEAT. Tonal split keeps
    // the user able to tell hands apart without fighting the overall
    // orange-on-charcoal palette.
    const sidePalette = hand.side === 'right' ? ORANGE_HOT : AMBER_BEAT;
    const sideHue = sidePalette.h;
    const sideSat = sidePalette.s;

    // Skeleton lines. Single crisp pass — no glow underlay (saves perf,
    // looks sharper). Vertical-gradient brightness is preserved: the wrist
    // (lower-y) end is slightly darker than the fingertip end.
    s.noFill();
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = hand.landmarks[a];
      const lb = hand.landmarks[b];
      if (!la || !lb) continue;
      const [ax, ay] = landmarkToScreen(la.x, la.y, w, h);
      const [bx, by] = landmarkToScreen(lb.x, lb.y, w, h);
      const meanY = (ay + by) / (h * 2);
      const brightness = 100 - meanY * 12; // 100 at top → 88 at bottom
      s.stroke(sideHue, sideSat, brightness, 0.85);
      s.strokeWeight(1.4);
      s.line(ax, ay, bx, by);
    }

    // Fingertip cores: 1px-stroked diamonds (rotated squares). Diamond
    // size scales with the beat envelope. The diamond shape reads as
    // sharp/sharp-edged — fits the low-poly aesthetic better than
    // soft-glow blobs.
    const baseR = 6 + beatV * 4;
    s.noFill();
    s.stroke(sideHue, sideSat, 100, 0.95);
    s.strokeWeight(1);
    for (const idx of FINGERTIP_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      // Diamond = rotated square. Manually draw 4 edges as a closed shape.
      s.beginShape();
      s.vertex(x, y - baseR);
      s.vertex(x + baseR, y);
      s.vertex(x, y + baseR);
      s.vertex(x - baseR, y);
      s.endShape(s.CLOSE);
    }
  }
}

/**
 * Just the bright cores of fingertips — used in the bloom pass so we
 * don't double-blur the already-glowing outer halos. Renders the diamond
 * shape so the bloom blur pass sees the same silhouette as the main
 * canvas (rather than a circular halo, which would smear over the corners
 * of the diamond).
 */
function drawFingertipCores(
  s: p5 | p5.Graphics,
  hands: Hand[],
  beatV: number,
  w: number,
  h: number,
): void {
  for (const hand of hands) {
    const sidePalette = hand.side === 'right' ? ORANGE_HOT : AMBER_BEAT;
    const sideHue = sidePalette.h;
    const sideSat = sidePalette.s;
    s.noStroke();
    for (const idx of FINGERTIP_INDICES) {
      const lm = hand.landmarks[idx];
      if (!lm) continue;
      const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
      const baseR = 6 + beatV * 4;
      s.fill(sideHue, sideSat, 100, 0.7);
      s.beginShape();
      s.vertex(x, y - baseR);
      s.vertex(x + baseR, y);
      s.vertex(x, y + baseR);
      s.vertex(x - baseR, y);
      s.endShape(s.CLOSE);
    }
  }
}

// ---------------------------------------------------------------------------
// Chromatic-aberration halo for wide-open hands.
//
// Cheap R/B split: draw a small red-shifted ring at (+offset, 0) and a
// blue-shifted ring at (-offset, 0) around each fingertip. The result reads
// as a soft "scanline tear" focus effect — the eye sees the doubled edges
// rather than a true RGB split (we're in HSB color mode), but the offset
// alone sells the look.
//
// Hysteresis is owned by the caller (sketch draw loop): this function just
// renders unconditionally and assumes openness has already passed the
// threshold. Always blendMode ADD via the enclosing push().
// ---------------------------------------------------------------------------

export function drawHandHalo(s: p5 | p5.Graphics, hand: Hand): void {
  const w = (s as p5).width;
  const h = (s as p5).height;
  const HALO_R = 9;
  const OFFSET = 1.6; // px chromatic offset
  s.noFill();
  s.strokeWeight(1);
  for (const idx of FINGERTIP_INDICES) {
    const lm = hand.landmarks[idx];
    if (!lm) continue;
    const [x, y] = landmarkToScreen(lm.x, lm.y, w, h);
    // Red-shift ring (hue ~5, low sat, high bri) at +x offset.
    s.stroke(5, 80, 100, 0.35);
    s.circle(x + OFFSET, y, HALO_R * 2);
    // Blue-shift ring (hue ~210) at -x offset. Sits on a cooler register
    // than the rest of the palette — used very sparingly so it reads as
    // "scanline tear", not "wrong palette".
    s.stroke(210, 60, 100, 0.30);
    s.circle(x - OFFSET, y, HALO_R * 2);
  }
}

// ---------------------------------------------------------------------------
// Face skeleton — oval, eyes, nose bridge, lips, optional brows.
//
// Cyberpunk recolor: outer oval and eye iris use ORANGE_HOT; eye outlines
// use AMBER_BEAT (eyes pop hardest because they're the most expressive
// landmark); brows / nose / philtrum / jaw use ORANGE_DARK or GREY_LINE.
// Lips outer = ORANGE_HOT; lips inner = ORANGE_GLOW soft fill on speak.
//
// No rotation — that was a perf killer per the prior commit. Head tilt is
// already conveyed by the landmark positions themselves.
// ---------------------------------------------------------------------------

export function drawFaceSkeleton(
  s: p5,
  face: FaceState,
  width: number,
  height: number,
  beatV: number,
  cover: VideoCoverTransform | null = null,
  /**
   * PERF (v0.3.0 freeze fix): when false, the wide outer-glow pass on the
   * face oval is skipped — only the crisp 1.4-weight inner stroke renders.
   * Default true preserves the legacy two-pass look for unit tests and
   * direct callers; the sketch draw loop toggles this at ~15 Hz so the
   * cheap-but-frequent 36-vertex glow shape runs at half rate while the
   * face skeleton itself stays per-frame.
   */
  renderOuterGlow = true,
): void {
  const lms = face.landmarks;
  if (!lms || lms.length < 478) return;

  // Compute face center for any optional pivot (currently unused).
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
  void cx; void cy;

  s.noFill();

  // Outer face oval — ORANGE_HOT. We render TWO passes:
  //   1. A wider, lower-alpha outer-glow stroke (1.5× weight, ~0.18 alpha)
  //      using ORANGE_GLOW to soften the silhouette. Visually it looks
  //      like the oval has a halo without us having to run the bloom
  //      buffer over it. Gated by `renderOuterGlow` so the sketch can
  //      run it at half rate (~15 Hz) without losing the crisp inner
  //      stroke; at that update rate the glow reads as continuous halo.
  //   2. A crisp inner stroke at 1.4-weight ORANGE_HOT — the actual
  //      readable outline.
  // Other face lines (eyes/lips/nose/brows) stay single-weight so the
  // composition doesn't get mushy.
  if (renderOuterGlow) {
    s.strokeWeight(2.1);
    s.stroke(ORANGE_GLOW.h, ORANGE_GLOW.s, ORANGE_GLOW.b, 0.18 + beatV * 0.05);
    drawClosedLoop(s, lms, FACE_OVAL, width, height, false, cover);
  }
  s.strokeWeight(1.4);
  s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.6 + beatV * 0.05);
  drawClosedLoop(s, lms, FACE_OVAL, width, height, false, cover);

  // Jawlines (polylines) — neutral grey, dim. Adds chin definition without
  // competing with the warm accents.
  s.strokeWeight(1.0);
  s.stroke(GREY_LINE.h, GREY_LINE.s, GREY_LINE.b, 0.45);
  drawPolyline(s, lms, FACE_LEFT_JAW, width, height, cover);
  drawPolyline(s, lms, FACE_RIGHT_JAW, width, height, cover);

  // Eyes (closed loops) — AMBER_BEAT. Eyes pop hardest.
  s.strokeWeight(1.1);
  s.stroke(AMBER_BEAT.h, AMBER_BEAT.s, AMBER_BEAT.b, 0.7 + beatV * 0.05);
  drawClosedLoop(s, lms, FACE_LEFT_EYE, width, height, false, cover);
  drawClosedLoop(s, lms, FACE_RIGHT_EYE, width, height, false, cover);

  // Iris rings — ORANGE_HOT, alpha 0.8. Renders only if landmarks include
  // them (refine_landmarks). Eyes are the most expressive thing — lean in.
  if (lms.length >= 478) {
    s.strokeWeight(0.9);
    s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.8);
    drawClosedLoop(s, lms, FACE_LEFT_IRIS, width, height, false, cover);
    drawClosedLoop(s, lms, FACE_RIGHT_IRIS, width, height, false, cover);
    s.strokeWeight(1.0);
  }

  // Eyebrows — ORANGE_DARK, low alpha.
  s.stroke(ORANGE_DARK.h, ORANGE_DARK.s, ORANGE_DARK.b, 0.5);
  drawPolyline(s, lms, FACE_LEFT_BROW, width, height, cover);
  drawPolyline(s, lms, FACE_RIGHT_BROW, width, height, cover);

  // Nose bridge (polyline) + nostril ring — ORANGE_DARK to match the rest
  // of the face skeleton (oval, brows, philtrum, lips) which all sit on the
  // orange palette. Was GREY_LINE which read as a "missing" stroke against
  // the otherwise-warm face wireframe.
  s.stroke(ORANGE_DARK.h, ORANGE_DARK.s, ORANGE_DARK.b, 0.5);
  drawPolyline(s, lms, FACE_NOSE_BRIDGE, width, height, cover);
  drawClosedLoop(s, lms, FACE_NOSE_TIP_RING, width, height, false, cover);

  // Philtrum / cupid's bow — ORANGE_DARK at low alpha.
  s.stroke(ORANGE_DARK.h, ORANGE_DARK.s, ORANGE_DARK.b, 0.4);
  drawPolyline(s, lms, FACE_PHILTRUM, width, height, cover);

  // Lips: outer ORANGE_HOT, inner soft ORANGE_GLOW fill on speak.
  const mo = face.mouthOpen;
  const lipWeight = 1.2 * (1 + 2 * Math.max(0, mo));
  const lipAlpha = 0.7 + mo * 0.2;

  s.strokeWeight(lipWeight);
  s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, lipAlpha);

  if (mo > 0.1) {
    // Soft ORANGE_GLOW fill inside the lips when speaking. Alpha caps at
    // 0.25 (per brief).
    s.fill(ORANGE_GLOW.h, ORANGE_GLOW.s, ORANGE_GLOW.b, mo * 0.25);
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
// (Removed) Superman laser eyes — feature deleted per user request.
// FaceState.eyesWide remains in the contract for back-compat but is no
// longer consumed by the visualizer or the InteractionMapper.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fake arms — bezier from face chin to each hand wrist. Three layers of
// glow, all in ORANGE_HOT family (no per-side hue split — the fake arms
// share the same warm tone regardless of which hand they connect to).
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

    // All arms use the same ORANGE_HOT family — no per-side split.
    // Outer glow.
    s.stroke(ORANGE_GLOW.h, ORANGE_GLOW.s, ORANGE_GLOW.b, 0.10);
    s.strokeWeight(8);
    s.bezier(cx, cy, c1x, c1y, c2x, c2y, wx, wy);
    // Mid.
    s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.22);
    s.strokeWeight(3);
    s.bezier(cx, cy, c1x, c1y, c2x, c2y, wx, wy);
    // Core.
    s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.4);
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
//
// All strings are ORANGE_HOT — the per-side hue split was removed for
// visual cohesion. Beat brightness modulates alpha.
// ---------------------------------------------------------------------------

function drawFingerStrings(
  s: p5 | p5.Graphics,
  hands: Hand[],
  beatV: number,
  w: number,
  h: number,
): void {
  for (const hand of hands) {
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

      // Outer halo — ORANGE_GLOW
      s.noFill();
      s.stroke(ORANGE_GLOW.h, ORANGE_GLOW.s, ORANGE_GLOW.b, 0.18 * brightness);
      s.strokeWeight(thickness * 4);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
      // Mid — ORANGE_HOT
      s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.45 * brightness);
      s.strokeWeight(thickness * 2);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
      // Core — bright ORANGE_HOT
      s.stroke(ORANGE_HOT.h, ORANGE_HOT.s, ORANGE_HOT.b, 0.9 * brightness);
      s.strokeWeight(thickness);
      s.bezier(ax, ay, cx1, cy1, cx2, cy2, bx, by);
    }
  }
}

// ---------------------------------------------------------------------------
// Vignette (radial darkening toward edges) — charcoal corners on BG_PANEL.
// ---------------------------------------------------------------------------

/**
 * Paint the vignette gradient into an existing graphics buffer. Separate
 * from `buildVignette` so resize can REUSE the buffer instead of recreating
 * (which leaks: p5.Element.remove() throws internally on resize cycles,
 * leaving the old buffer in p5's internal element tracker → unbounded
 * canvas memory growth → "rallenta sempre di più").
 */
function paintVignette(g: p5.Graphics, w: number, h: number): void {
  g.clear();
  g.colorMode(g.HSB, 360, 100, 100, 1);
  g.noStroke();
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  const steps = 32;
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps;
    const a = Math.pow(t, 1.7) * 0.6;
    g.fill(BG_PANEL.h, BG_PANEL.s, Math.max(2, BG_PANEL.b - 4), a);
    g.circle(cx, cy, maxR * 2 * (1 - t * 0.05));
  }
}

function buildVignette(s: p5, w: number, h: number): p5.Graphics {
  const g = s.createGraphics(w, h);
  paintVignette(g, w, h);
  return g;
}

// ---------------------------------------------------------------------------
// Hex grid backdrop — pre-rendered ONCE into a p5.Graphics. Single image()
// blit per frame thereafter. Static (no animation) — pure decoration that
// sells the cyberpunk console aesthetic without per-frame cost.
//
// Implementation: a tessellation of regular hexagons drawn as polylines.
// We use "pointy-top" hex layout. Each hex has side length HEX_SIDE.
//
// The grid covers a 1.1× margin so cells at the edges aren't visibly cut.
// ---------------------------------------------------------------------------

const HEX_SIDE = 36;

/**
 * Paint the hex-grid tessellation into an existing graphics buffer. Same
 * reuse rationale as `paintVignette` above.
 */
function paintHexGrid(g: p5.Graphics, w: number, h: number): void {
  g.clear();
  g.colorMode(g.HSB, 360, 100, 100, 1);
  g.noFill();
  g.strokeWeight(1);
  g.stroke(GREY_LINE.h, GREY_LINE.s, GREY_LINE.b, 0.08);

  const side = HEX_SIDE;
  const sqrt3 = Math.sqrt(3);
  const hexW = sqrt3 * side;
  const hexH = 2 * side;
  const colStep = hexW;
  const rowStep = (3 / 4) * hexH;

  const corners: Array<[number, number]> = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 180) * (60 * i - 30);
    corners.push([Math.cos(a) * side, Math.sin(a) * side]);
  }

  for (let row = -1; row * rowStep <= h + side; row += 1) {
    for (let col = -1; col * colStep <= w + side; col += 1) {
      const offX = (row & 1) === 0 ? 0 : hexW / 2;
      const cx = col * colStep + offX;
      const cy = row * rowStep;
      g.beginShape();
      for (const [dx, dy] of corners) {
        g.vertex(cx + dx, cy + dy);
      }
      g.endShape(g.CLOSE);
    }
  }
}

function buildHexGrid(s: p5, w: number, h: number): p5.Graphics {
  const g = s.createGraphics(w, h);
  paintHexGrid(g, w, h);
  return g;
}
