// Owner: hand-tracker (sibling module under src/face/)
//
// MediaPipe Tasks Vision FaceLandmarker wrapper. Runs face-landmark inference
// per video frame, maintains One-Euro smoothing state, derives `FaceState`,
// and emits events. Mirrors the structure of HandTracker — same threading
// model (rVFC + rAF fallback), same emitter pattern, same lifecycle. Shares
// the `<video>` element with HandTracker; we do not call getUserMedia here.

import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type {
  FaceLandmark,
  FaceState,
  FaceTracker,
  FaceTrackerEvents,
  HeadPose,
} from '@contracts/contracts';
import { OneEuroFilter } from '@hands/one-euro-filter';
import {
  apparentFaceWidth,
  apparentSizeToCloseness,
  browRaiseFromLandmarks,
  extractEulerFromMatrix,
  eyeAspectRatioLeft,
  eyeAspectRatioRight,
  faceCenter,
  mouthOpenFromLandmarks,
  normalizeEyeOpenness,
} from './face-gestures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDIAPIPE_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const NUM_FACE_LANDMARKS = 478;

/** Edge transition for face-lost. */
const FACE_LOST_EDGE_SECONDS = 1.5;

/**
 * Defensive update throttle (Hz). Face inference is expensive and runs on
 * the main thread alongside HandLandmarker. After a Web Worker offload
 * attempt failed (Vite + MediaPipe incompatibility), we accept main-
 * thread face inference but cap it at 8 Hz. Head poses move slowly, the
 * mouth-open value smooths through One Euro, and the visualizer renders
 * at the same rate as before — it just sees fresh landmarks every 125 ms
 * instead of every 80 ms. Inaudibly slower; main-thread freed considerably.
 */
const MAX_UPDATE_HZ = 8;
const MIN_UPDATE_INTERVAL_MS = 1000 / MAX_UPDATE_HZ;

/** Filter resets after this re-entry gap. */
const FACE_GAP_RESET_MS = 700;

// ---------------------------------------------------------------------------
// Tiny typed event emitter (mirrors HandTrackerEmitter shape).
// ---------------------------------------------------------------------------

type Listener<K extends keyof FaceTrackerEvents> = FaceTrackerEvents[K];

class FaceTrackerEmitter {
  private listeners = new Map<keyof FaceTrackerEvents, Set<unknown>>();

  on<K extends keyof FaceTrackerEvents>(evt: K, cb: Listener<K>): void {
    let set = this.listeners.get(evt);
    if (!set) {
      set = new Set();
      this.listeners.set(evt, set);
    }
    set.add(cb);
  }

  off<K extends keyof FaceTrackerEvents>(evt: K, cb: Listener<K>): void {
    this.listeners.get(evt)?.delete(cb);
  }

  emit<K extends keyof FaceTrackerEvents>(
    evt: K,
    ...args: Parameters<Listener<K>>
  ): void {
    const set = this.listeners.get(evt);
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as (...a: unknown[]) => void)(...args);
      } catch (err) {
        if (evt !== 'error') {
          // eslint-disable-next-line no-console
          console.warn('[FaceTracker] listener threw:', err);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filter slot — one set of One-Euro filters, kept as long as the face is
// continuously detected. Reset on a long gap (FACE_GAP_RESET_MS).
// ---------------------------------------------------------------------------

interface FaceFilterSlot {
  centerX: OneEuroFilter;
  centerY: OneEuroFilter;
  apparentSize: OneEuroFilter;
  yaw: OneEuroFilter;
  pitch: OneEuroFilter;
  roll: OneEuroFilter;
  mouthOpen: OneEuroFilter;
  browRaise: OneEuroFilter;
  /** Per-eye openness — same params as mouthOpen / browRaise. */
  eyeOpenLeft: OneEuroFilter;
  eyeOpenRight: OneEuroFilter;
  /** eyesWide is the value the visualizer reads each frame. Slightly
   * higher mincutoff so the lasers don't shimmer. */
  eyesWide: OneEuroFilter;
  lastSeenMs: number;
}

function makeFaceFilterSlot(): FaceFilterSlot {
  // mincutoff=2.0, beta=0.02 for the centroid; mincutoff=1.5, beta=0.01 for
  // pose & expression scalars (per spec). The visualizer-facing eyesWide
  // gets the heavier-cutoff "centroid" preset so lasers feel steady rather
  // than shimmery.
  const centroid = (): OneEuroFilter =>
    new OneEuroFilter({ mincutoff: 2.0, beta: 0.02 });
  const pose = (): OneEuroFilter =>
    new OneEuroFilter({ mincutoff: 1.5, beta: 0.01 });
  return {
    centerX: centroid(),
    centerY: centroid(),
    apparentSize: pose(),
    yaw: pose(),
    pitch: pose(),
    roll: pose(),
    mouthOpen: pose(),
    browRaise: pose(),
    eyeOpenLeft: pose(),
    eyeOpenRight: pose(),
    eyesWide: centroid(),
    lastSeenMs: 0,
  };
}

function resetSlot(slot: FaceFilterSlot): void {
  slot.centerX.reset();
  slot.centerY.reset();
  slot.apparentSize.reset();
  slot.yaw.reset();
  slot.pitch.reset();
  slot.roll.reset();
  slot.mouthOpen.reset();
  slot.browRaise.reset();
  slot.eyeOpenLeft.reset();
  slot.eyeOpenRight.reset();
  slot.eyesWide.reset();
}

/** Calibration: average eye openness at rest. Above this peg `eyesWide`
 * begins to climb; below this it stays at 0 (so blinks don't fire lasers).
 * User reports normal/relaxed eyes still triggered the lasers; the EAR
 * fallback + blendshape noise can pull mean-eye-openness up to ~0.7 even
 * when the user isn't deliberately widening. Raise the floor so only a
 * deliberate "spalanca" pegs eyesWide. */
const EYE_REST = 0.75;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Pull the named blendshape score from a Classifications result, or null. */
function blendshapeScore(
  result: FaceLandmarkerResult,
  name: string,
): number | null {
  const cls = result.faceBlendshapes?.[0];
  if (!cls) return null;
  for (const cat of cls.categories) {
    if (cat.categoryName === name) return cat.score;
  }
  return null;
}

type VideoElementWithRVFC = HTMLVideoElement;

// ---------------------------------------------------------------------------
// FaceTrackerImpl
// ---------------------------------------------------------------------------

export class FaceTrackerImpl implements FaceTracker {
  private emitter = new FaceTrackerEmitter();
  private landmarker: FaceLandmarker | null = null;
  private videoEl: VideoElementWithRVFC | null = null;

  private running = false;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;

  private slot: FaceFilterSlot = makeFaceFilterSlot();

  private lastFrameMs: number | null = null;
  private lastEmitMs = 0;

  private noFaceAccumSec = 0;
  private faceLostEmitted = false;

  private lastDetection: FaceLandmarkerResult | null = null;

  // Runtime selfie-mirror toggle (matches HandTracker.mirrorEnabled).
  private mirrorEnabled = true;
  setMirror(enabled: boolean): void {
    this.mirrorEnabled = enabled;
  }

  // -------------------------------------------------------------------------
  // FaceTracker interface
  // -------------------------------------------------------------------------

  async init(videoEl: HTMLVideoElement): Promise<void> {
    this.videoEl = videoEl as VideoElementWithRVFC;

    let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
    try {
      vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit('error', e);
      throw e;
    }

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: 'GPU',
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    } catch (err) {
      const e =
        err instanceof Error
          ? err
          : new Error('FaceLandmarker creation failed');
      this.emitter.emit('error', e);
      throw e;
    }
    // We deliberately do NOT call getUserMedia here — the HandTracker owns the
    // webcam stream and the same <video> element is reused. Caller is
    // responsible for ensuring the video has a stream before start().
  }

  start(): void {
    if (this.running) return;
    if (!this.videoEl || !this.landmarker) {
      const e = new Error('FaceTracker.start() called before init()');
      this.emitter.emit('error', e);
      return;
    }
    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    if (
      this.rvfcHandle !== null &&
      this.videoEl &&
      typeof this.videoEl.cancelVideoFrameCallback === 'function'
    ) {
      this.videoEl.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;

    this.lastFrameMs = null;
    this.noFaceAccumSec = 0;
    this.faceLostEmitted = false;
    resetSlot(this.slot);
  }

  on<K extends keyof FaceTrackerEvents>(
    evt: K,
    cb: FaceTrackerEvents[K],
  ): void {
    this.emitter.on(evt, cb);
  }

  off<K extends keyof FaceTrackerEvents>(
    evt: K,
    cb: FaceTrackerEvents[K],
  ): void {
    this.emitter.off(evt, cb);
  }

  // -------------------------------------------------------------------------
  // Public extras
  // -------------------------------------------------------------------------

  /** Last raw FaceLandmarker result, for visualizer overlay. May be null. */
  getLastDetectionResult(): FaceLandmarkerResult | null {
    return this.lastDetection;
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private scheduleNextFrame(): void {
    if (!this.running || !this.videoEl) return;
    const v = this.videoEl;
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = v.requestVideoFrameCallback((now) => this.tick(now));
    } else {
      this.rafHandle = requestAnimationFrame((now) => this.tick(now));
    }
  }

  private tick(nowMs: number): void {
    if (!this.running) return;
    try {
      this.runFrame(nowMs);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit('error', e);
    } finally {
      if (this.running) this.scheduleNextFrame();
    }
  }

  private runFrame(nowMs: number): void {
    const v = this.videoEl;
    const lm = this.landmarker;
    if (!v || !lm) return;
    if (v.readyState < 2 || v.paused || v.ended) return;
    if (nowMs - this.lastEmitMs < MIN_UPDATE_INTERVAL_MS) return;

    let result: FaceLandmarkerResult;
    try {
      result = lm.detectForVideo(v, nowMs);
    } catch (err) {
      const e =
        err instanceof Error ? err : new Error('FaceLandmarker.detectForVideo failed');
      this.emitter.emit('error', e);
      return;
    }
    this.lastDetection = result;

    const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const tSec = nowMs / 1000;

    const state = this.deriveState(result, tSec, nowMs, dt);
    this.emitter.emit('face:update', state);

    // Edge: face-lost / face-back.
    if (
      !state.detected &&
      state.noFaceDuration >= FACE_LOST_EDGE_SECONDS &&
      !this.faceLostEmitted
    ) {
      this.faceLostEmitted = true;
      this.emitter.emit('face:lost');
    } else if (state.detected && this.faceLostEmitted) {
      this.faceLostEmitted = false;
      this.emitter.emit('face:back');
    }

    this.lastEmitMs = nowMs;
  }

  // -------------------------------------------------------------------------
  // Derivation: result -> FaceState
  // -------------------------------------------------------------------------

  /**
   * Build the smoothed FaceState. Public on the class so tests can drive it
   * directly with a synthetic FaceLandmarkerResult without spinning up the
   * MediaPipe runtime.
   */
  deriveStateFromResult(
    result: FaceLandmarkerResult,
    nowMs: number,
    dt: number,
  ): FaceState {
    return this.deriveState(result, nowMs / 1000, nowMs, dt);
  }

  private deriveState(
    result: FaceLandmarkerResult,
    tSec: number,
    nowMs: number,
    dt: number,
  ): FaceState {
    const rawLandmarks = result.faceLandmarks?.[0] ?? null;
    const detected = !!rawLandmarks && rawLandmarks.length >= NUM_FACE_LANDMARKS;

    if (!detected) {
      // Accumulate no-face duration; emit a "not detected" state.
      this.noFaceAccumSec += dt > 0 ? dt : 0;
      const empty: HeadPose = { yaw: 0, pitch: 0, roll: 0, depth: 0 };
      return {
        detected: false,
        center: { x: 0.5, y: 0.5 },
        apparentSize: 0,
        pose: empty,
        mouthOpen: 0,
        browRaise: 0,
        eyeOpenLeft: 0,
        eyeOpenRight: 0,
        eyesWide: 0,
        noFaceDuration: this.noFaceAccumSec,
      };
    }

    // Long gap → reset filter state so we don't blend two distinct sessions.
    if (
      this.slot.lastSeenMs > 0 &&
      nowMs - this.slot.lastSeenMs > FACE_GAP_RESET_MS
    ) {
      resetSlot(this.slot);
    }
    this.slot.lastSeenMs = nowMs;
    this.noFaceAccumSec = 0;

    // Convert NormalizedLandmark[] -> FaceLandmark[] (strip visibility/presence)
    // for downstream helpers. ALSO apply selfie x-mirror in place when
    // mirrorEnabled is true, so the visualizer's face skeleton lives in the
    // same selfie-mirrored frame as the CSS-flipped <video> element. This
    // matches the convention used by HandTracker. Without this flip, the
    // face skeleton tracks the user's actual head movement but appears on
    // the OPPOSITE side of the screen — same kind of bug we fixed for hands.
    const mirror = this.mirrorEnabled;
    const lms: FaceLandmark[] = new Array(rawLandmarks!.length);
    for (let i = 0; i < rawLandmarks!.length; i += 1) {
      const p = rawLandmarks![i]!;
      lms[i] = {
        x: mirror ? 1 - p.x : p.x,
        y: p.y,
        z: p.z,
      };
    }

    // Pose from facialTransformationMatrix (if available).
    const matrix = result.facialTransformationMatrixes?.[0];
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    let depth = 0;
    if (matrix && matrix.data) {
      const e = extractEulerFromMatrix(matrix.data);
      yaw = e.yaw;
      pitch = e.pitch;
      roll = e.roll;
      depth = e.depth;
    }

    // Face center is computed from the (already-mirrored when applicable)
    // lms, so pass through. The earlier double-flip was wrong now that
    // landmarks are mirrored at population.
    const rawCenter = faceCenter(lms);
    const mirroredCenterX = rawCenter.x;

    // Apparent size (depth proxy).
    const rawWidth = apparentFaceWidth(lms);
    const closeness = apparentSizeToCloseness(rawWidth);

    // Mouth open: prefer blendshape, else geometric fallback.
    let mouthOpenRaw: number;
    const blendJaw = blendshapeScore(result, 'jawOpen');
    if (blendJaw !== null) {
      mouthOpenRaw = clamp01(blendJaw);
    } else {
      mouthOpenRaw = mouthOpenFromLandmarks(lms);
    }

    // Brow raise: prefer blendshape, else geometric fallback.
    let browRaiseRaw: number;
    const blendBrow = blendshapeScore(result, 'browInnerUp');
    if (blendBrow !== null) {
      browRaiseRaw = clamp01(blendBrow);
    } else {
      browRaiseRaw = browRaiseFromLandmarks(lms);
    }

    // Eye openness: prefer blendshapes (`eyeBlinkLeft/Right` are HIGH when the
    // eye is CLOSED, so we invert), else fall back to the geometric EAR.
    let eyeOpenLeftRaw: number;
    const blendBlinkL = blendshapeScore(result, 'eyeBlinkLeft');
    if (blendBlinkL !== null) {
      eyeOpenLeftRaw = clamp01(1 - blendBlinkL);
    } else {
      eyeOpenLeftRaw = normalizeEyeOpenness(eyeAspectRatioLeft(lms));
    }
    let eyeOpenRightRaw: number;
    const blendBlinkR = blendshapeScore(result, 'eyeBlinkRight');
    if (blendBlinkR !== null) {
      eyeOpenRightRaw = clamp01(1 - blendBlinkR);
    } else {
      eyeOpenRightRaw = normalizeEyeOpenness(eyeAspectRatioRight(lms));
    }
    // eyesWide: only kicks in when both eyes are pushed beyond rest, so a
    // normal blink stays at zero while a deliberate wide-eye stare pegs the
    // signal toward 1. See FaceState.eyesWide comment in contracts.ts.
    const eyeMean = (eyeOpenLeftRaw + eyeOpenRightRaw) / 2;
    const eyesWideRaw =
      EYE_REST < 1 ? Math.max(0, (eyeMean - EYE_REST) / (1 - EYE_REST)) : 0;

    // Apply One-Euro filtering. Negate yaw/roll for selfie-mirrored
    // coordinates (pitch sign stays).
    const cx = clamp01(this.slot.centerX.filter(mirroredCenterX, tSec));
    const cy = clamp01(this.slot.centerY.filter(rawCenter.y, tSec));
    const sz = clamp01(this.slot.apparentSize.filter(closeness, tSec));
    // Selfie mirror negates yaw and roll (pitch is invariant).
    const yawSign = this.mirrorEnabled ? -1 : 1;
    const rollSign = this.mirrorEnabled ? -1 : 1;
    const yawF = this.slot.yaw.filter(yawSign * yaw, tSec);
    const pitchF = this.slot.pitch.filter(pitch, tSec);
    const rollF = this.slot.roll.filter(rollSign * roll, tSec);
    const mo = clamp01(this.slot.mouthOpen.filter(mouthOpenRaw, tSec));
    const br = clamp01(this.slot.browRaise.filter(browRaiseRaw, tSec));
    const eolF = clamp01(this.slot.eyeOpenLeft.filter(eyeOpenLeftRaw, tSec));
    const eorF = clamp01(this.slot.eyeOpenRight.filter(eyeOpenRightRaw, tSec));
    const ewF = clamp01(this.slot.eyesWide.filter(eyesWideRaw, tSec));

    const state: FaceState = {
      detected: true,
      center: { x: cx, y: cy },
      apparentSize: sz,
      pose: { yaw: yawF, pitch: pitchF, roll: rollF, depth },
      mouthOpen: mo,
      browRaise: br,
      eyeOpenLeft: eolF,
      eyeOpenRight: eorF,
      eyesWide: ewF,
      noFaceDuration: 0,
      landmarks: lms,
    };
    return state;
  }
}
