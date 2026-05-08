// Owner: hand-tracker
//
// Higher-level discrete-gesture detector that sits ON TOP of the HandTracker's
// continuous scalar stream. The HandTracker already smooths landmarks and
// derives openness / pinch / depth / roll / pitch; this class consumes those
// per-hand snapshots and emits:
//
//   - shape_enter / shape_exit — rising / falling edges of the static
//     classifier in `gesture-classifier.ts`, gated by a 3-frame consensus
//     and a per-shape cooldown.
//   - snap, swipe_left, swipe_right, fist_pump — velocity-driven one-shots
//     with their own cooldowns.
//   - wave_level — continuous controller (0..1), no cooldown.
//
// The interpreter is conservative on purpose. The user has had repeated
// problems with gestures triggering accidentally; every threshold here
// errs toward "miss the deliberate gesture rather than fire a spurious
// one" (see CONTRIBUTING.md: "Don't break the audio").
//
// Threading: pure JS, no timers. The owner (InteractionMapper / main.ts)
// drives the interpreter by calling `ingestHands(state)` once per
// HandTracker emit. `Date.now()`-style clocks are pluggable via the
// constructor for testability — pass a `nowMs` function to inject a
// fake timer.

import type {
  Hand,
  HandLandmark,
  HandShape,
  HandsState,
  GestureEvent,
} from '@contracts/contracts';
import { classifyHandShape } from './gesture-classifier';

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

/** Frames of identical classification required before `shape_enter` fires.
 * Three frames at 24 Hz ≈ 125 ms — long enough to suppress single-frame
 * MediaPipe glitches, short enough that the user-perceived latency is OK. */
const SHAPE_CONSENSUS_FRAMES = 3;

/** Per-shape cooldown — re-fires of the same shape are gated by this window
 * even after a clean exit + re-enter. Stops the same gesture from spamming
 * during slight positional drift. */
const SHAPE_COOLDOWN_MS = 350;

/** Snap detection — index-tip vertical velocity threshold (frame-units / s,
 * where one frame-unit = handSize). Higher than swipe because a snap is a
 * fast, deliberate flick. */
const SNAP_VELOCITY_THRESHOLD = 6.0;
/** Cooldown between snap fires. */
const SNAP_COOLDOWN_MS = 250;

/** Swipe detection — palm-center horizontal velocity threshold (handSize/s).
 * Sustained for SWIPE_SUSTAIN_MS to fire. */
const SWIPE_VELOCITY_THRESHOLD = 2.0;
/** Required sustained-velocity duration. 150 ms gives the user time to
 * actually mean a swipe vs. an incidental hand reposition. */
const SWIPE_SUSTAIN_MS = 150;
/** Cooldown between swipe fires (any direction). 600 ms also gives the
 * user time to bring the hand back without accidentally firing a swipe
 * in the opposite direction. */
const SWIPE_COOLDOWN_MS = 600;

/** Fist-pump — downward palm-center velocity (handSize/s) while the shape
 * is `fist`. */
const FIST_PUMP_VELOCITY_THRESHOLD = 3.0;
const FIST_PUMP_COOLDOWN_MS = 800;

/** Wave detection — count of horizontal-velocity sign-flips inside a
 * rolling window. ≥3 flips in 1.2s reads as a genuine wave. */
const WAVE_FLIPS_REQUIRED = 3;
const WAVE_WINDOW_MS = 1200;
/** Velocity below this magnitude is considered "still" — sign flips that
 * happen at sub-still velocities don't count. */
const WAVE_DEAD_ZONE = 0.4;

/** Position history depth (frames). Enough to compute velocity over a
 * sliding ~80 ms window. */
const POS_HISTORY_FRAMES = 6;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PositionSample {
  t: number;
  /** Palm center (image-plane). */
  cx: number;
  cy: number;
  /** Index tip (image-plane). */
  ix: number;
  iy: number;
  /** Reference hand size, used to normalize velocities. */
  size: number;
}

interface HandHistory {
  /** Ring buffer of recent shape classifications (newest at end). */
  shapeBuffer: HandShape[];
  /** The shape that was last *committed* (i.e. fired as shape_enter). */
  emittedShape: HandShape;
  /** When the current emittedShape was committed. */
  emittedAtMs: number;
  /** Last cooldown-fire time per shape. */
  lastFireMsByShape: Map<HandShape, number>;
  /** Position samples for velocity. */
  positions: PositionSample[];
  /** Sustained-velocity bookkeeping for swipes. Sign-coded:
   *  -1 = currently sustaining a leftward swipe, +1 = rightward, 0 = none. */
  swipeDirection: -1 | 0 | 1;
  swipeStartMs: number;
  /** Last fire times for velocity events. */
  lastSnapMs: number;
  lastSwipeMs: number;
  lastFistPumpMs: number;
  /** Most recent wave_level emission to throttle continuous output to a
   *  perceptible delta. */
  lastWaveLevel: number;
  /** Index curl history for snap (curled→extended transition). */
  indexCurlBuffer: number[];
  /** Wave: rolling list of (t, signOfVx) for sign-flip counting. */
  waveSigns: Array<{ t: number; sign: -1 | 0 | 1 }>;
}

function makeHistory(): HandHistory {
  return {
    shapeBuffer: [],
    emittedShape: 'unknown',
    emittedAtMs: -Infinity,
    lastFireMsByShape: new Map(),
    positions: [],
    swipeDirection: 0,
    swipeStartMs: 0,
    lastSnapMs: -Infinity,
    lastSwipeMs: -Infinity,
    lastFistPumpMs: -Infinity,
    lastWaveLevel: 0,
    indexCurlBuffer: [],
    waveSigns: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WRIST = 0;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

function distXY(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function approxHandSize(lm: HandLandmark[]): number {
  const a = lm[WRIST];
  const b = lm[MIDDLE_MCP];
  if (!a || !b) return 1;
  const d = distXY(a, b);
  return d > 1e-6 ? d : 1;
}

/**
 * Estimate index-tip curl from a single Hand snapshot — quick & dirty,
 * just for snap-detection. Uses the Hand's openness as a proxy when the
 * landmarks aren't available; otherwise the ratio (index_tip → wrist) /
 * (index_mcp → wrist) tells us how extended the index is.
 */
function indexCurlProxy(h: Hand): number {
  const lm = h.landmarks;
  if (!lm || lm.length < 21) return 1 - h.openness;
  const wrist = lm[0];
  const tip = lm[INDEX_TIP];
  const mcp = lm[5];
  if (!wrist || !tip || !mcp) return 1 - h.openness;
  const tipD = distXY(tip, wrist);
  const mcpD = distXY(mcp, wrist);
  if (mcpD <= 1e-6) return 1;
  // Fully extended: tipD ≈ 2× mcpD. Curled (tip near MCP): tipD ≈ mcpD.
  const ratio = tipD / mcpD;
  if (ratio >= 2.0) return 0;
  if (ratio <= 1.0) return 1;
  return 1 - (ratio - 1.0) / (2.0 - 1.0);
}

// ---------------------------------------------------------------------------
// GestureInterpreter
// ---------------------------------------------------------------------------

export type GestureCallback = (e: GestureEvent) => void;

export interface GestureInterpreterOptions {
  /** Inject a clock for tests. Defaults to `Date.now`. */
  nowMs?: () => number;
}

export class GestureInterpreter {
  private listeners = new Set<GestureCallback>();
  private historyByHand: Record<'Left' | 'Right', HandHistory> = {
    Left: makeHistory(),
    Right: makeHistory(),
  };
  private nowMs: () => number;

  constructor(opts: GestureInterpreterOptions = {}) {
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  on(event: 'gesture', cb: GestureCallback): void {
    if (event !== 'gesture') return;
    this.listeners.add(cb);
  }

  off(event: 'gesture', cb: GestureCallback): void {
    if (event !== 'gesture') return;
    this.listeners.delete(cb);
  }

  /** Public read of the currently-emitted shape, separate from edge events. */
  getCurrentShape(handedness: 'Left' | 'Right'): HandShape {
    return this.historyByHand[handedness].emittedShape;
  }

  /**
   * Call once per HandTracker emit. State carries the (optional) left/right
   * Hand snapshots; missing hands trigger a graceful exit on whatever shape
   * was last committed.
   */
  ingestHands(state: HandsState): void {
    const t = this.nowMs();
    this.processHand('Left', state.left, t);
    this.processHand('Right', state.right, t);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private emit(e: GestureEvent): void {
    for (const cb of this.listeners) {
      try {
        cb(e);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[GestureInterpreter] listener threw:', err);
      }
    }
  }

  private processHand(
    handedness: 'Left' | 'Right',
    hand: Hand | undefined,
    t: number,
  ): void {
    const hist = this.historyByHand[handedness];

    if (!hand) {
      // Hand left the frame — exit current shape if we had one committed.
      if (hist.emittedShape !== 'unknown') {
        this.emit({ type: 'shape_exit', shape: hist.emittedShape, handedness });
        hist.emittedShape = 'unknown';
      }
      // Reset shape buffer + position history so re-entry starts clean.
      hist.shapeBuffer.length = 0;
      hist.positions.length = 0;
      hist.indexCurlBuffer.length = 0;
      hist.swipeDirection = 0;
      hist.waveSigns.length = 0;
      return;
    }

    // ---- Static-shape consensus + edge events --------------------------
    const shape = hand.shape ?? classifyHandShape(hand.landmarks);
    hist.shapeBuffer.push(shape);
    if (hist.shapeBuffer.length > SHAPE_CONSENSUS_FRAMES) {
      hist.shapeBuffer.shift();
    }

    if (hist.shapeBuffer.length === SHAPE_CONSENSUS_FRAMES) {
      const allSame = hist.shapeBuffer.every((s) => s === shape);
      if (allSame && shape !== hist.emittedShape) {
        const lastFire = hist.lastFireMsByShape.get(shape) ?? -Infinity;
        if (t - lastFire >= SHAPE_COOLDOWN_MS) {
          // Exit previous, then enter new.
          if (hist.emittedShape !== 'unknown') {
            this.emit({
              type: 'shape_exit',
              shape: hist.emittedShape,
              handedness,
            });
          }
          this.emit({ type: 'shape_enter', shape, handedness });
          hist.emittedShape = shape;
          hist.emittedAtMs = t;
          hist.lastFireMsByShape.set(shape, t);
        }
      }
    }

    // ---- Position history for velocity gestures ------------------------
    const lm = hand.landmarks;
    const wrist = lm[WRIST];
    const tipL = lm[INDEX_TIP];
    if (wrist && tipL) {
      const sample: PositionSample = {
        t,
        cx: hand.palmCenter.x,
        cy: hand.palmCenter.y,
        ix: tipL.x,
        iy: tipL.y,
        size: approxHandSize(lm),
      };
      hist.positions.push(sample);
      if (hist.positions.length > POS_HISTORY_FRAMES) hist.positions.shift();
    }

    // Index curl history for snap detection.
    const idxCurl = indexCurlProxy(hand);
    hist.indexCurlBuffer.push(idxCurl);
    if (hist.indexCurlBuffer.length > POS_HISTORY_FRAMES) {
      hist.indexCurlBuffer.shift();
    }

    // Run velocity gestures only when we have at least two samples — one is
    // not enough to estimate dx/dt.
    if (hist.positions.length < 2) return;

    this.detectSnap(hist, handedness, t);
    this.detectSwipe(hist, handedness, t);
    this.detectFistPump(hist, handedness, t, shape);
    this.detectWave(hist, handedness, t);
  }

  // ---- Snap -----------------------------------------------------------

  private detectSnap(
    hist: HandHistory,
    handedness: 'Left' | 'Right',
    t: number,
  ): void {
    if (t - hist.lastSnapMs < SNAP_COOLDOWN_MS) return;

    const samples = hist.positions;
    if (samples.length < 3) return;

    // Vertical velocity of the index tip over the last ~80 ms, normalized
    // to handSize so it scales with how close the user is to the camera.
    const newest = samples[samples.length - 1]!;
    // Find a sample at least ~60ms older.
    let older = samples[0]!;
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      const cand = samples[i]!;
      if (newest.t - cand.t >= 60) {
        older = cand;
        break;
      }
    }
    const dt = (newest.t - older.t) / 1000;
    if (dt <= 1e-6) return;
    const vy = ((newest.iy - older.iy) / dt) / Math.max(newest.size, 1e-6);

    // Snap = strong downward vertical velocity (positive vy in MediaPipe)
    // OR strong upward (-vy) — accept either sign so wrist-snap up and
    // wrist-snap down both register.
    if (Math.abs(vy) < SNAP_VELOCITY_THRESHOLD) return;

    // Curl transition curled→extended within recent buffer. Look at the
    // older 3 frames vs the newer 3 frames.
    const buf = hist.indexCurlBuffer;
    if (buf.length < 4) return;
    const half = Math.floor(buf.length / 2);
    const oldAvg = avg(buf.slice(0, half));
    const newAvg = avg(buf.slice(half));
    const transitioned = oldAvg > 0.5 && newAvg < 0.4;
    if (!transitioned) return;

    hist.lastSnapMs = t;
    this.emit({ type: 'snap', handedness });
  }

  // ---- Swipe ----------------------------------------------------------

  private detectSwipe(
    hist: HandHistory,
    handedness: 'Left' | 'Right',
    t: number,
  ): void {
    if (t - hist.lastSwipeMs < SWIPE_COOLDOWN_MS) return;

    const samples = hist.positions;
    if (samples.length < 2) return;
    const newest = samples[samples.length - 1]!;
    // Look for the oldest sample within a ~120 ms window of `newest`. This
    // keeps velocity reactive (drops to 0 quickly when the hand stops)
    // instead of holding stale estimates from samples way back in the
    // 6-frame buffer.
    let older = samples[samples.length - 2]!;
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      const cand = samples[i]!;
      if (newest.t - cand.t > 120) break;
      older = cand;
    }
    const dt = (newest.t - older.t) / 1000;
    if (dt <= 1e-6) return;
    const vx = ((newest.cx - older.cx) / dt) / Math.max(newest.size, 1e-6);

    const dir: -1 | 0 | 1 =
      vx > SWIPE_VELOCITY_THRESHOLD
        ? 1
        : vx < -SWIPE_VELOCITY_THRESHOLD
          ? -1
          : 0;

    if (dir === 0) {
      // Velocity dropped — reset the sustain timer.
      hist.swipeDirection = 0;
      return;
    }

    if (hist.swipeDirection !== dir) {
      // New direction — start the sustain timer.
      hist.swipeDirection = dir;
      hist.swipeStartMs = t;
      return;
    }

    if (t - hist.swipeStartMs >= SWIPE_SUSTAIN_MS) {
      hist.lastSwipeMs = t;
      // Reset so we need a fresh sustain to fire again.
      hist.swipeDirection = 0;
      // NOTE on the sign convention: vx > 0 in MediaPipe image coords means
      // the hand is moving toward larger x (screen-right) AFTER the
      // HandTracker has applied its mirror. So +vx → swipe_right.
      this.emit({
        type: dir > 0 ? 'swipe_right' : 'swipe_left',
        handedness,
      });
    }
  }

  // ---- Fist pump ------------------------------------------------------

  private detectFistPump(
    hist: HandHistory,
    handedness: 'Left' | 'Right',
    t: number,
    shape: HandShape,
  ): void {
    if (t - hist.lastFistPumpMs < FIST_PUMP_COOLDOWN_MS) return;
    if (shape !== 'fist') return;

    const samples = hist.positions;
    if (samples.length < 2) return;
    const newest = samples[samples.length - 1]!;
    const older = samples[0]!;
    const dt = (newest.t - older.t) / 1000;
    if (dt <= 1e-6) return;
    // Downward in MediaPipe = increasing y → positive vy.
    const vy = ((newest.cy - older.cy) / dt) / Math.max(newest.size, 1e-6);
    if (vy < FIST_PUMP_VELOCITY_THRESHOLD) return;

    hist.lastFistPumpMs = t;
    this.emit({ type: 'fist_pump', handedness });
  }

  // ---- Wave ----------------------------------------------------------

  private detectWave(
    hist: HandHistory,
    handedness: 'Left' | 'Right',
    t: number,
  ): void {
    const samples = hist.positions;
    if (samples.length < 2) return;
    const newest = samples[samples.length - 1]!;
    const older = samples[samples.length - 2]!;
    const dt = (newest.t - older.t) / 1000;
    if (dt <= 1e-6) return;
    const vx = ((newest.cx - older.cx) / dt) / Math.max(newest.size, 1e-6);
    const sign: -1 | 0 | 1 =
      Math.abs(vx) < WAVE_DEAD_ZONE ? 0 : vx > 0 ? 1 : -1;
    hist.waveSigns.push({ t, sign });

    // Drop entries older than the window.
    const cutoff = t - WAVE_WINDOW_MS;
    while (hist.waveSigns.length > 0 && hist.waveSigns[0]!.t < cutoff) {
      hist.waveSigns.shift();
    }

    // Count sign flips (ignore zero-runs).
    let flips = 0;
    let prevNonZero: -1 | 0 | 1 = 0;
    for (const e of hist.waveSigns) {
      if (e.sign === 0) continue;
      if (prevNonZero !== 0 && e.sign !== prevNonZero) flips += 1;
      prevNonZero = e.sign;
    }

    // Map flip count to a 0..1 level. Once we hit WAVE_FLIPS_REQUIRED the
    // wave is "active" at level=1; before that it ramps up linearly.
    const level = Math.min(1, flips / WAVE_FLIPS_REQUIRED);

    // Throttle the continuous emission to perceptible deltas (≥ 0.1) or to
    // transitions across 0 (start/stop the wave). Without this the listener
    // would get a wave_level on every single ingest, which is noise.
    if (
      Math.abs(level - hist.lastWaveLevel) >= 0.1 ||
      (level === 0 && hist.lastWaveLevel > 0) ||
      (level >= 1 && hist.lastWaveLevel < 1)
    ) {
      hist.lastWaveLevel = level;
      this.emit({ type: 'wave_level', level, handedness });
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// Re-export the tunables for tests.
export const __testing = {
  SHAPE_CONSENSUS_FRAMES,
  SHAPE_COOLDOWN_MS,
  SNAP_VELOCITY_THRESHOLD,
  SNAP_COOLDOWN_MS,
  SWIPE_VELOCITY_THRESHOLD,
  SWIPE_SUSTAIN_MS,
  SWIPE_COOLDOWN_MS,
  FIST_PUMP_VELOCITY_THRESHOLD,
  FIST_PUMP_COOLDOWN_MS,
  WAVE_FLIPS_REQUIRED,
  WAVE_WINDOW_MS,
  WAVE_DEAD_ZONE,
};
