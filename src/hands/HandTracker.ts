// Owner: hand-tracker
//
// MediaPipe Tasks Vision wrapper. Runs hand-landmark inference per video frame,
// maintains One-Euro smoothing state, derives `GestureState`, and emits events.
//
// Threading: Per ARCHITECTURE.md §8 the default is the main thread, with
// `videoEl.requestVideoFrameCallback` driving inference. MediaPipe Web's
// recommended path is exactly this — rVFC keeps inference in lockstep with
// real video frames and avoids redundant work. We only fall back to a worker
// if profiling shows MediaPipe stealing > 6 ms from the main thread, which
// is the architect's call. Stick with rVFC.

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type {
  GestureState,
  Hand,
  HandLandmark,
  HandTracker,
  HandTrackerEvents,
} from '@contracts/contracts';
import { OneEuroFilter, OneEuroVec3 } from './one-euro-filter';
import {
  buildGestureState,
  computeOpenness,
  computePalmCenter,
  computePinch,
  isFist,
} from './gestures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDIAPIPE_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const HAND_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const NUM_LANDMARKS = 21;
const MAX_HANDS = 2;

/** Filters reset if a hand reappears after this gap. */
const HAND_GAP_RESET_MS = 500;

/** Edge transition for no-hands fallback. */
const NO_HANDS_EDGE_SECONDS = 2.0;

/** Defensive update throttle (Hz) — rVFC already caps at refresh rate. */
const MAX_UPDATE_HZ = 60;
const MIN_UPDATE_INTERVAL_MS = 1000 / MAX_UPDATE_HZ;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SmoothingSlot {
  /** Per-landmark x/y/z filters (21 of them). */
  landmarks: OneEuroVec3[];
  /** Filter for derived openness scalar. */
  opennessF: OneEuroFilter;
  /** Filter for derived pinch scalar. */
  pinchF: OneEuroFilter;
  /** Last time (ms) this slot was updated — used to detect re-entry gaps. */
  lastSeenMs: number;
}

function makeSlot(): SmoothingSlot {
  const landmarks: OneEuroVec3[] = [];
  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    landmarks.push(new OneEuroVec3({ mincutoff: 1.0, beta: 0.007 }));
  }
  return {
    landmarks,
    opennessF: new OneEuroFilter({ mincutoff: 2.0, beta: 0.02 }),
    pinchF: new OneEuroFilter({ mincutoff: 2.0, beta: 0.02 }),
    lastSeenMs: 0,
  };
}

function resetSlot(slot: SmoothingSlot): void {
  for (const f of slot.landmarks) f.reset();
  slot.opennessF.reset();
  slot.pinchF.reset();
}

function makeHandsDistanceFilter(): OneEuroFilter {
  return new OneEuroFilter({ mincutoff: 2.0, beta: 0.02 });
}

function makeMeanHeightFilter(): OneEuroFilter {
  return new OneEuroFilter({ mincutoff: 2.0, beta: 0.02 });
}

// ---------------------------------------------------------------------------
// Tiny typed event emitter
// ---------------------------------------------------------------------------

type Listener<K extends keyof HandTrackerEvents> = HandTrackerEvents[K];

class HandTrackerEmitter {
  private listeners = new Map<keyof HandTrackerEvents, Set<unknown>>();

  on<K extends keyof HandTrackerEvents>(evt: K, cb: Listener<K>): void {
    let set = this.listeners.get(evt);
    if (!set) {
      set = new Set();
      this.listeners.set(evt, set);
    }
    set.add(cb);
  }

  off<K extends keyof HandTrackerEvents>(evt: K, cb: Listener<K>): void {
    this.listeners.get(evt)?.delete(cb);
  }

  emit<K extends keyof HandTrackerEvents>(
    evt: K,
    ...args: Parameters<Listener<K>>
  ): void {
    const set = this.listeners.get(evt);
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // A listener throwing must not kill the loop. Log it; if the
        // listener was the `error` handler itself, we have nothing to do.
        if (evt !== 'error') {
          // eslint-disable-next-line no-console
          console.warn('[HandTracker] listener threw:', err);
        }
      }
    }
  }
}

// HTMLVideoElement in the DOM lib already declares requestVideoFrameCallback /
// cancelVideoFrameCallback. Alias purely for readability — runtime feature-
// detect via `typeof === 'function'` for browsers without rVFC (rAF fallback).
type VideoElementWithRVFC = HTMLVideoElement;

// ---------------------------------------------------------------------------
// HandTracker implementation
// ---------------------------------------------------------------------------

export class HandTrackerImpl implements HandTracker {
  private emitter = new HandTrackerEmitter();
  private landmarker: HandLandmarker | null = null;
  private videoEl: VideoElementWithRVFC | null = null;
  private mediaStream: MediaStream | null = null;

  private running = false;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;

  // Smoothing slots, keyed by handedness so left/right map to consistent state.
  private slotByHand = new Map<'left' | 'right', SmoothingSlot>();
  private handsDistanceF = makeHandsDistanceFilter();
  private meanHeightF = makeMeanHeightFilter();

  // Edge / state tracking.
  private prevState: GestureState | null = null;
  private prevRightPinch = false;
  private prevLeftPinch = false;
  private noHandsEmitted = false;
  private lastEmitMs = 0;
  private lastFrameMs: number | null = null;

  // Last raw detection result, exposed for the visualizer.
  private lastDetection: HandLandmarkerResult | null = null;

  // Runtime mirror toggle. The default (true) is correct for the typical
  // setup: a Windows/Chrome built-in webcam that returns un-mirrored pixels,
  // a CSS-flipped <video> for the user (selfie-style), and a HandTracker
  // that flips landmark x on output so the skeleton overlays the visible
  // hand. If the user's webcam is ALREADY native-mirrored (some phones,
  // some OBS-virtual-cam setups, some Mac setups) the data flip would
  // double-mirror — flip this to false in that case.
  private mirrorEnabled = true;

  setMirror(enabled: boolean): void {
    this.mirrorEnabled = enabled;
  }
  isMirrored(): boolean {
    return this.mirrorEnabled;
  }

  // ---- HandTracker interface --------------------------------------------

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
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: HAND_LANDMARKER_MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: MAX_HANDS,
      });
    } catch (err) {
      const e =
        err instanceof Error
          ? err
          : new Error('HandLandmarker creation failed');
      this.emitter.emit('error', e);
      throw e;
    }

    // Webcam.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const e =
        err instanceof Error
          ? err
          : new Error('Webcam permission denied');
      this.emitter.emit('error', e);
      // Recoverable: do not leak landmarker, but reject so callers can show fallback UI.
      throw e;
    }

    this.mediaStream = stream;
    videoEl.srcObject = stream;
    // Mirror so user-facing camera matches user's expectation; the consumer
    // (visualizer / interaction-mapper) treats x as already mirrored.
    videoEl.muted = true;
    videoEl.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        videoEl.removeEventListener('loadeddata', onLoaded);
        videoEl.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        videoEl.removeEventListener('loadeddata', onLoaded);
        videoEl.removeEventListener('error', onError);
        reject(new Error('Video element failed to load camera stream'));
      };
      videoEl.addEventListener('loadeddata', onLoaded);
      videoEl.addEventListener('error', onError);
    });

    try {
      await videoEl.play();
    } catch {
      // Some browsers can require an additional user gesture; not fatal.
    }
  }

  start(): void {
    if (this.running) return;
    if (!this.videoEl || !this.landmarker) {
      const e = new Error('HandTracker.start() called before init()');
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

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }

    this.lastFrameMs = null;
    this.prevState = null;
    this.prevRightPinch = false;
    this.prevLeftPinch = false;
    this.noHandsEmitted = false;
    this.slotByHand.clear();
    this.handsDistanceF.reset();
    this.meanHeightF.reset();
  }

  on<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]): void {
    this.emitter.on(evt, cb);
  }

  off<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]): void {
    this.emitter.off(evt, cb);
  }

  // ---- Public-on-class extras (not on the interface) ---------------------

  /**
   * Last raw HandLandmarker result for the most recent detection. The
   * visualizer uses this for overlay rendering. May be null before any
   * detection has run.
   */
  getLastDetectionResult(): HandLandmarkerResult | null {
    return this.lastDetection;
  }

  // ---- Frame loop -------------------------------------------------------

  private scheduleNextFrame(): void {
    if (!this.running || !this.videoEl) return;
    const v = this.videoEl;
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = v.requestVideoFrameCallback((now) =>
        this.tick(now),
      );
    } else {
      // Fallback when rVFC is not supported (older Firefox releases).
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
      // Always reschedule — a single bad frame must not kill the tracker.
      if (this.running) this.scheduleNextFrame();
    }
  }

  private runFrame(nowMs: number): void {
    const v = this.videoEl;
    const lm = this.landmarker;
    if (!v || !lm) return;

    // Skip if the video isn't ready yet.
    if (v.readyState < 2 || v.paused || v.ended) return;

    // Defensive throttle — rVFC already caps at the display refresh rate.
    if (nowMs - this.lastEmitMs < MIN_UPDATE_INTERVAL_MS) return;

    let result: HandLandmarkerResult;
    try {
      result = lm.detectForVideo(v, nowMs);
    } catch (err) {
      const e = err instanceof Error ? err : new Error('detectForVideo failed');
      this.emitter.emit('error', e);
      return;
    }
    this.lastDetection = result;

    const dt = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const tSec = nowMs / 1000;

    const hands = this.buildHands(result, tSec, nowMs);
    const state = buildGestureState(hands, dt, this.prevState);

    // Apply derived-metric smoothing on top of landmark smoothing.
    let smoothedHandsDistance = 0;
    if (hands.length === 2) {
      smoothedHandsDistance = this.handsDistanceF.filter(
        state.handsDistance,
        tSec,
      );
    } else {
      this.handsDistanceF.reset();
    }
    const smoothedMeanHeight =
      hands.length > 0
        ? this.meanHeightF.filter(state.meanHeight, tSec)
        : state.meanHeight;

    const finalState: GestureState = {
      ...state,
      handsDistance: smoothedHandsDistance,
      meanHeight: smoothedMeanHeight,
    };

    this.emitEdges(finalState);
    this.emitter.emit('gesture:update', finalState);
    this.lastEmitMs = nowMs;
    this.prevState = finalState;
  }

  // ---- Hand construction & smoothing ------------------------------------

  private buildHands(
    result: HandLandmarkerResult,
    tSec: number,
    nowMs: number,
  ): Hand[] {
    const out: Hand[] = [];
    const seen = new Set<'left' | 'right'>();

    const rawLandmarks = result.landmarks ?? [];
    const handedness = result.handedness ?? [];

    for (let i = 0; i < rawLandmarks.length; i += 1) {
      const raw = rawLandmarks[i];
      if (!raw || raw.length < NUM_LANDMARKS) continue;

      // MediaPipe handedness assumes a SELFIE-mirrored input. With un-
      // mirrored input (mirrorEnabled=true case), the labels arrive
      // reversed and we swap them to user's POV: 'Left' → user's right.
      // With pre-mirrored input (mirrorEnabled=false), MediaPipe's labels
      // are already correct and we pass them through unchanged.
      const cat = handedness[i]?.[0]?.categoryName ?? 'Right';
      const side: 'left' | 'right' = this.mirrorEnabled
        ? (cat === 'Left' ? 'right' : 'left')
        : (cat === 'Left' ? 'left' : 'right');

      // If two detections claim the same side, keep the first.
      if (seen.has(side)) continue;
      seen.add(side);

      const slot = this.getOrCreateSlot(side, nowMs);

      // Smooth landmarks per axis. Apply selfie x-mirror on output so all
      // consumer coordinates (visualizer skeleton, gesture distance,
      // palmCenter) live in the same frame as the CSS-flipped <video>.
      // The mirror is runtime-toggleable for users whose webcams are
      // already mirrored at the OS / virtual-cam level.
      const mirror = this.mirrorEnabled;
      const smoothed: HandLandmark[] = new Array(NUM_LANDMARKS);
      for (let k = 0; k < NUM_LANDMARKS; k += 1) {
        const p = raw[k];
        if (!p) {
          smoothed[k] = { x: 0, y: 0, z: 0 };
          continue;
        }
        const filterVec = slot.landmarks[k]!;
        const filtered = filterVec.filter(
          { x: p.x, y: p.y, z: p.z },
          tSec,
        );
        smoothed[k] = {
          x: mirror ? 1 - filtered.x : filtered.x,
          y: filtered.y,
          z: filtered.z,
        };
      }

      // Provisional Hand for derivation calls.
      const provisionalCenter = computePalmCenter(smoothed);
      const provisional: Hand = {
        side,
        landmarks: smoothed,
        palmCenter: provisionalCenter,
        openness: 0,
        pinch: 1,
        isClosed: false,
      };

      // Smoothed scalar derivations.
      const opnRaw = computeOpenness(provisional);
      const pinRaw = computePinch(provisional);
      const opn = clamp01(slot.opennessF.filter(opnRaw, tSec));
      const pin = clamp01(slot.pinchF.filter(pinRaw, tSec));

      const hand: Hand = {
        side,
        landmarks: smoothed,
        palmCenter: provisionalCenter,
        openness: opn,
        pinch: pin,
        isClosed: false,
      };
      hand.isClosed = isFist(hand);

      slot.lastSeenMs = nowMs;
      out.push(hand);
    }

    return out;
  }

  private getOrCreateSlot(
    side: 'left' | 'right',
    nowMs: number,
  ): SmoothingSlot {
    let slot = this.slotByHand.get(side);
    if (!slot) {
      slot = makeSlot();
      this.slotByHand.set(side, slot);
      return slot;
    }
    // If the hand has been gone for > HAND_GAP_RESET_MS, reset filter state.
    if (nowMs - slot.lastSeenMs > HAND_GAP_RESET_MS) {
      resetSlot(slot);
    }
    return slot;
  }

  // ---- Edge events ------------------------------------------------------

  private emitEdges(state: GestureState): void {
    // Pinch rising edges.
    if (state.rightPinchActive && !this.prevRightPinch) {
      this.emitter.emit('gesture:pinch-right');
    }
    if (state.leftPinchActive && !this.prevLeftPinch) {
      this.emitter.emit('gesture:pinch-left');
    }
    this.prevRightPinch = state.rightPinchActive;
    this.prevLeftPinch = state.leftPinchActive;

    // No-hands / hands-back transitions.
    if (state.noHandsDuration >= NO_HANDS_EDGE_SECONDS && !this.noHandsEmitted) {
      this.noHandsEmitted = true;
      this.emitter.emit('gesture:no-hands');
    } else if (state.hands.length > 0 && this.noHandsEmitted) {
      this.noHandsEmitted = false;
      this.emitter.emit('gesture:hands-back');
    }
  }
}

// Small local helper to avoid re-importing from gestures.ts.
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
