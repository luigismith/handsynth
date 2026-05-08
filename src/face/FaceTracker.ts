// Owner: hand-tracker (sibling module under src/face/)
//
// MediaPipe Tasks Vision FaceLandmarker wrapper — WORKER EDITION.
//
// The previous implementation ran FaceLandmarker.detectForVideo on the main
// thread alongside HandLandmarker. Two simultaneous MediaPipe inferences plus
// the p5 visualizer plus Tone.js were enough to starve the audio scheduler
// (chrome's "page-is-unresponsive" watchdog had fired). This version moves
// the FaceLandmarker into a dedicated Web Worker:
//
//   main thread:
//     - rVFC (or rAF fallback) at ≤MAX_UPDATE_HZ
//     - createImageBitmap(videoEl) → postMessage(transfer) → worker
//     - on result: rebuild FaceLandmark[], mirror, One-Euro filter, derive
//       FaceState, emit events
//
//   worker (face-worker.ts):
//     - owns FaceLandmarker
//     - runs detectForVideo on the ImageBitmap
//     - posts back lean payload (Float32Array landmarks + matrix + blends)
//
// The choice to keep One-Euro / mirror / state derivation on main is
// deliberate (strategy "A" — inference-only worker): those steps are cheap,
// the visualizer needs the landmark array anyway, and synchronous post-
// processing is much easier to debug. See face-worker.ts header for the full
// rationale.
//
// Public API (FaceTracker contract from contracts.ts) is unchanged.

import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
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
  faceCenter,
  mouthOpenFromLandmarks,
} from './face-gestures';
import FaceWorker from './face-worker.ts?worker';
import type {
  ResultMessage,
  WorkerInbound,
  WorkerOutbound,
} from './face-worker';

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
 * Defensive update throttle (Hz). Even with the worker absorbing inference
 * cost, we still cap the rate at which we ship ImageBitmaps across the wire.
 * Head poses are slow signals; 12 Hz with One-Euro smoothing is plenty.
 */
const MAX_UPDATE_HZ = 12;
const MIN_UPDATE_INTERVAL_MS = 1000 / MAX_UPDATE_HZ;

/** Filter resets after this re-entry gap. */
const FACE_GAP_RESET_MS = 700;

/**
 * Cap the number of frames in flight at once. If the worker is slow we'd
 * otherwise queue up bitmaps faster than it can drain them. The cap also
 * protects against runaway memory if the worker stalls.
 */
const MAX_INFLIGHT_FRAMES = 2;

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
  lastSeenMs: number;
}

function makeFaceFilterSlot(): FaceFilterSlot {
  // mincutoff=2.0, beta=0.02 for the centroid; mincutoff=1.5, beta=0.01 for
  // pose & expression scalars (per spec).
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Pull the named blendshape score from a result, or null. */
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
// Build a synthetic FaceLandmarkerResult from a worker ResultMessage. The
// downstream `deriveState` was originally written against the MediaPipe type;
// rebuilding the same shape is the cheapest way to keep the post-processing
// code unchanged. Allocates ~478 landmark objects per detected frame at 12
// Hz — ~5700 objects/sec, well within budget.
// ---------------------------------------------------------------------------

function resultFromWorker(msg: ResultMessage): FaceLandmarkerResult {
  if (!msg.landmarks || msg.numLandmarks <= 0) {
    return {
      faceLandmarks: [],
      faceBlendshapes: [],
      facialTransformationMatrixes: [],
    } as unknown as FaceLandmarkerResult;
  }
  const lms = new Array(msg.numLandmarks);
  for (let i = 0; i < msg.numLandmarks; i += 1) {
    const o = i * 3;
    lms[i] = {
      x: msg.landmarks[o] ?? 0,
      y: msg.landmarks[o + 1] ?? 0,
      z: msg.landmarks[o + 2] ?? 0,
      visibility: 1,
    };
  }
  const blends =
    msg.blendshapes.length > 0
      ? [
          {
            categories: msg.blendshapes.map((b, i) => ({
              score: b.score,
              index: i,
              categoryName: b.name,
              displayName: b.name,
            })),
            headIndex: 0,
            headName: 'face',
          },
        ]
      : [];
  const matrixes =
    msg.matrixData && msg.matrixData.length >= 16
      ? [
          {
            rows: 4,
            columns: 4,
            // MediaPipe consumers iterate by index; either Float32Array or
            // number[] works. Convert to a regular array so existing helpers
            // (extractEulerFromMatrix expects number[]) don't trip.
            data: Array.from(msg.matrixData),
          },
        ]
      : [];
  return {
    faceLandmarks: [lms],
    faceBlendshapes: blends,
    facialTransformationMatrixes: matrixes,
  } as unknown as FaceLandmarkerResult;
}

// ---------------------------------------------------------------------------
// FaceTrackerImpl
// ---------------------------------------------------------------------------

export class FaceTrackerImpl implements FaceTracker {
  private emitter = new FaceTrackerEmitter();
  private videoEl: VideoElementWithRVFC | null = null;

  private worker: Worker | null = null;
  private workerReady = false;
  private workerFailed = false;
  private nextFrameId = 1;
  /** Highest result-id we've already consumed — newer ids only. */
  private lastConsumedId = 0;
  private inflight = 0;

  private running = false;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;

  private slot: FaceFilterSlot = makeFaceFilterSlot();

  private lastFrameMs: number | null = null;
  /** Timestamp (ms) of the most recent ImageBitmap we sent to the worker. */
  private lastSentMs = 0;

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

    // Construct the worker. If the env can't construct one (e.g. tests, or a
    // browser with workers disabled), we don't crash — we surface an error
    // and stay faceless. The architectural decision is intentional: there is
    // no main-thread fallback (that's what was overrunning the audio
    // scheduler in the first place).
    let worker: Worker;
    try {
      worker = new FaceWorker();
    } catch (err) {
      this.workerFailed = true;
      const e =
        err instanceof Error
          ? err
          : new Error('FaceTracker: failed to construct face worker');
      this.emitter.emit('error', e);
      throw e;
    }
    this.worker = worker;

    worker.addEventListener('message', (ev: MessageEvent<WorkerOutbound>) =>
      this.onWorkerMessage(ev),
    );
    worker.addEventListener('error', (ev: ErrorEvent) => {
      this.workerFailed = true;
      const e = new Error(
        `FaceTracker worker error: ${ev.message || 'unknown'}`,
      );
      this.emitter.emit('error', e);
    });
    worker.addEventListener('messageerror', () => {
      this.emitter.emit(
        'error',
        new Error('FaceTracker worker received an unstructurable message'),
      );
    });

    // Send the init message, await `ready` (or `error`).
    await new Promise<void>((resolve, reject) => {
      const onReady = (ev: MessageEvent<WorkerOutbound>) => {
        const msg = ev.data;
        if (msg.type === 'ready') {
          worker.removeEventListener('message', onReady as EventListener);
          this.workerReady = true;
          resolve();
        } else if (msg.type === 'error') {
          worker.removeEventListener('message', onReady as EventListener);
          this.workerFailed = true;
          reject(new Error(`FaceTracker worker init: ${msg.message}`));
        }
        // Ignore other message types until we get ready/error.
      };
      worker.addEventListener('message', onReady as EventListener);
      const initMsg: WorkerInbound = {
        type: 'init',
        wasmBase: MEDIAPIPE_WASM_BASE,
        modelUrl: FACE_LANDMARKER_MODEL_URL,
        delegate: 'GPU',
      };
      worker.postMessage(initMsg);
    });

    // We deliberately do NOT call getUserMedia here — the HandTracker owns
    // the webcam stream and the same <video> element is reused.
  }

  start(): void {
    if (this.running) return;
    if (!this.videoEl || !this.worker || !this.workerReady) {
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

    if (this.worker) {
      try {
        const closeMsg: WorkerInbound = { type: 'close' };
        this.worker.postMessage(closeMsg);
      } catch {
        // Worker may already be terminated.
      }
      try {
        this.worker.terminate();
      } catch {
        // Same.
      }
      this.worker = null;
      this.workerReady = false;
    }

    this.lastFrameMs = null;
    this.noFaceAccumSec = 0;
    this.faceLostEmitted = false;
    this.inflight = 0;
    this.nextFrameId = 1;
    this.lastConsumedId = 0;
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

  /** Last raw FaceLandmarker-shaped result (rebuilt from the worker payload).
   *  May be null. Kept for visualizer overlay compatibility. */
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
      this.rvfcHandle = v.requestVideoFrameCallback((now) =>
        void this.tick(now),
      );
    } else {
      this.rafHandle = requestAnimationFrame((now) => void this.tick(now));
    }
  }

  private async tick(nowMs: number): Promise<void> {
    if (!this.running) return;
    try {
      await this.dispatchFrame(nowMs);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emitter.emit('error', e);
    } finally {
      if (this.running) this.scheduleNextFrame();
    }
  }

  /** Capture the current video frame as an ImageBitmap and ship it to the
   *  worker. Throttled by MIN_UPDATE_INTERVAL_MS and by the inflight cap. */
  private async dispatchFrame(nowMs: number): Promise<void> {
    const v = this.videoEl;
    const w = this.worker;
    if (!v || !w || !this.workerReady || this.workerFailed) return;
    if (v.readyState < 2 || v.paused || v.ended) return;
    if (nowMs - this.lastSentMs < MIN_UPDATE_INTERVAL_MS) return;
    if (this.inflight >= MAX_INFLIGHT_FRAMES) return;

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(v);
    } catch (err) {
      const e =
        err instanceof Error
          ? err
          : new Error('FaceTracker: createImageBitmap failed');
      this.emitter.emit('error', e);
      return;
    }

    const id = this.nextFrameId;
    this.nextFrameId += 1;
    this.lastSentMs = nowMs;
    this.inflight += 1;

    const msg: WorkerInbound = {
      type: 'frame',
      id,
      bitmap,
      timestamp: nowMs,
    };
    try {
      w.postMessage(msg, [bitmap]);
    } catch (err) {
      this.inflight -= 1;
      try {
        bitmap.close();
      } catch {
        // ignore
      }
      const e =
        err instanceof Error
          ? err
          : new Error('FaceTracker: failed to post frame to worker');
      this.emitter.emit('error', e);
    }
  }

  // -------------------------------------------------------------------------
  // Worker → main thread handler
  // -------------------------------------------------------------------------

  private onWorkerMessage(ev: MessageEvent<WorkerOutbound>): void {
    const msg = ev.data;
    if (msg.type === 'error') {
      this.emitter.emit('error', new Error(msg.message));
      return;
    }
    if (msg.type !== 'result') return;

    // Result accounting — drop stale results (out-of-order is rare since
    // postMessage preserves order, but if MAX_INFLIGHT > 1 a slow first
    // frame could overlap a faster second).
    this.inflight = Math.max(0, this.inflight - 1);
    if (msg.id <= this.lastConsumedId) return;
    this.lastConsumedId = msg.id;

    if (!this.running) return;

    const result = resultFromWorker(msg);
    this.lastDetection = result;

    const nowMs = msg.timestamp;
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

  }

  // -------------------------------------------------------------------------
  // Derivation: result -> FaceState
  // -------------------------------------------------------------------------

  /**
   * Build the smoothed FaceState. Public on the class so tests can drive it
   * directly with a synthetic FaceLandmarkerResult without spinning up the
   * MediaPipe runtime (or the worker).
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
    // mirrorEnabled is true.
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
      const data = Array.isArray(matrix.data)
        ? matrix.data
        : Array.from(matrix.data as Iterable<number>);
      const e = extractEulerFromMatrix(data);
      yaw = e.yaw;
      pitch = e.pitch;
      roll = e.roll;
      depth = e.depth;
    }

    // Face center is computed from the (already-mirrored when applicable)
    // lms, so pass through.
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

    const state: FaceState = {
      detected: true,
      center: { x: cx, y: cy },
      apparentSize: sz,
      pose: { yaw: yawF, pitch: pitchF, roll: rollF, depth },
      mouthOpen: mo,
      browRaise: br,
      noFaceDuration: 0,
      landmarks: lms,
    };
    return state;
  }
}

