// Owner: hand-tracker
//
// Pure gesture-detection helpers. Given raw landmarks, derive openness, pinch,
// finger count, etc. No I/O. No timers. Easy to unit test.
//
// MediaPipe HandLandmarker returns 21 landmarks per hand in normalized image
// coordinates (0..1):
//   0:  wrist
//   1-4: thumb (CMC, MCP, IP, TIP)
//   5-8: index (MCP, PIP, DIP, TIP)
//   9-12: middle
//   13-16: ring
//   17-20: pinky

import type { Hand, HandLandmark, GestureState } from '@contracts/contracts';

// ---------------------------------------------------------------------------
// Landmark indices
// ---------------------------------------------------------------------------

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

const PALM_INDICES = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];
const FINGERTIP_INDICES = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];

// ---------------------------------------------------------------------------
// Tunable thresholds (calibration constants)
// ---------------------------------------------------------------------------

/** Below this raw normalized openness ratio → fully closed (0). */
// PROGRESSION FIX: widened window so closing/opening the fist feels
// continuous all the way to the physical extremes. Previously OPEN_MIN=0.4
// meant raw values below 0.4 pegged openness at 0 — and a typical natural
// fist sits around raw≈0.30..0.35, so the last ~30% of the closing motion
// produced no audible change. The wider 0.30..1.55 envelope keeps every
// finger position inside the active range so the gesture stays expressive
// edge-to-edge.
const OPEN_MIN = 0.3;
/** Above this raw normalized openness ratio → fully open (1). */
const OPEN_MAX = 1.55;
/** Pinch ratio below this is considered an active pinch trigger. */
const PINCH_TRIGGER = 0.04;
/** Fist threshold: all 4 fingertips inside this fraction of hand size. */
const FIST_RATIO = 0.4;

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function distance3D(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceXY(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function safeLandmark(
  landmarks: HandLandmark[],
  idx: number,
): HandLandmark | undefined {
  return landmarks[idx];
}

/**
 * Hand size reference: distance from wrist (0) to middle MCP (9). This is
 * a stable proxy for hand scale that's depth- and rotation-invariant enough
 * for our purposes.
 */
function handSize(landmarks: HandLandmark[]): number {
  const a = safeLandmark(landmarks, WRIST);
  const b = safeLandmark(landmarks, MIDDLE_MCP);
  if (!a || !b) return 1;
  const d = distance3D(a, b);
  return d > 1e-6 ? d : 1;
}

// ---------------------------------------------------------------------------
// Public derivations
// ---------------------------------------------------------------------------

/** Centroid of palm landmarks ({0, 5, 9, 13, 17}). */
export function computePalmCenter(landmarks: HandLandmark[]): HandLandmark {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const i of PALM_INDICES) {
    const p = safeLandmark(landmarks, i);
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    sz += p.z;
    n += 1;
  }
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: sx / n, y: sy / n, z: sz / n };
}

/** Backwards-compat: pure version operating on landmarks only. */
export function palmCenter(landmarks: HandLandmark[]): HandLandmark {
  return computePalmCenter(landmarks);
}

/**
 * Mean fingertip→palmCenter distance, normalized by hand size, then mapped
 * via a calibration window [OPEN_MIN, OPEN_MAX] → [0, 1].
 */
export function computeOpenness(hand: Hand): number {
  return opennessFromLandmarks(hand.landmarks, hand.palmCenter);
}

function opennessFromLandmarks(
  landmarks: HandLandmark[],
  palm?: HandLandmark,
): number {
  const center = palm ?? computePalmCenter(landmarks);
  const size = handSize(landmarks);
  let sum = 0;
  let n = 0;
  for (const i of FINGERTIP_INDICES) {
    const p = safeLandmark(landmarks, i);
    if (!p) continue;
    sum += distance3D(p, center);
    n += 1;
  }
  if (n === 0) return 0;
  const raw = sum / n / size;
  // PROGRESSION FIX: linear-inside-window with soft clamp via clamp01.
  // The hard `if (raw <= OPEN_MIN) return 0` cutoff that used to live here
  // was redundant with this clamp but read as "any tighter and nothing
  // happens" — the wider OPEN_MIN/OPEN_MAX (0.30..1.55) plus this single
  // expression gives a smooth ramp across the whole physical motion.
  const t = (raw - OPEN_MIN) / (OPEN_MAX - OPEN_MIN);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Backwards-compat: openness from raw landmarks. */
export function openness(landmarks: HandLandmark[]): number {
  return opennessFromLandmarks(landmarks);
}

/**
 * Pinch readout: distance(thumb tip, index tip) / handSize, mapped to [0, 1]
 * where 0 means "pinched" (very close) and 1 means "fully open". A value
 * below `PINCH_TRIGGER` is considered an actively pinching gesture.
 */
export function computePinch(hand: Hand): number {
  return pinchFromLandmarks(hand.landmarks);
}

function pinchFromLandmarks(landmarks: HandLandmark[]): number {
  const t = safeLandmark(landmarks, THUMB_TIP);
  const i = safeLandmark(landmarks, INDEX_TIP);
  if (!t || !i) return 1;
  const ratio = distance3D(t, i) / handSize(landmarks);
  // Map roughly: 0..0.4 → 0..1 in our scale.
  return clamp01(ratio / 0.4);
}

/** Backwards-compat. */
export function pinch(landmarks: HandLandmark[]): number {
  return pinchFromLandmarks(landmarks);
}

// ---------------------------------------------------------------------------
// 3D palm pose: depth, roll, pitch
// ---------------------------------------------------------------------------

/**
 * Mean Z of the five palm landmarks {0, 5, 9, 13, 17}. MediaPipe returns
 * Z relative to the wrist (origin); typical hand poses span roughly ±0.1.
 * Output is the raw mean — caller normalizes to a useful range.
 */
export function computePalmDepth(landmarks: HandLandmark[]): number {
  let s = 0;
  let n = 0;
  for (const i of PALM_INDICES) {
    const p = safeLandmark(landmarks, i);
    if (!p) continue;
    s += p.z;
    n += 1;
  }
  if (n === 0) return 0;
  return s / n;
}

/**
 * Palm roll in the image plane, computed from the line
 * index_MCP (5) → pinky_MCP (17). Returns an angle in radians wrapped to
 * [-π/2, π/2] — the palm-orientation axis only carries 180° of meaning, so
 * a hand rotated by π is the same orientation as 0 from this signal's POV.
 *
 * 0 ≈ palm aligned with x-axis (horizontal); +π/2 ≈ vertical (palm rotated
 * such that pinky_MCP sits above index_MCP in image space).
 */
export function computePalmRoll(landmarks: HandLandmark[]): number {
  const a = safeLandmark(landmarks, INDEX_MCP);
  const b = safeLandmark(landmarks, PINKY_MCP);
  if (!a || !b) return 0;
  let theta = Math.atan2(b.y - a.y, b.x - a.x);
  // Wrap into [-π/2, π/2]: roll is direction-agnostic.
  if (theta > Math.PI / 2) theta -= Math.PI;
  else if (theta < -Math.PI / 2) theta += Math.PI;
  return theta;
}

/**
 * Palm pitch (forward/back tilt) approximated from the Z separation
 * between the wrist (lm 0) and the middle MCP (lm 9):
 *   asin(clamp((lm9.z − lm0.z) / handSize3D, −1, 1))
 *
 * Positive when fingers point AWAY from camera (palm up / facing camera
 * with fingers extended forward — middle MCP further from camera than
 * wrist). Negative when fingers point toward the camera. Radians.
 */
export function computePalmPitch(landmarks: HandLandmark[]): number {
  const wrist = safeLandmark(landmarks, WRIST);
  const mid = safeLandmark(landmarks, MIDDLE_MCP);
  if (!wrist || !mid) return 0;
  const size = handSize(landmarks);
  if (size <= 1e-6) return 0;
  const ratio = clamp((mid.z - wrist.z) / size, -1, 1);
  return Math.asin(ratio);
}

/**
 * A fist = no extended fingers. We delegate to `extendedFingerCount`, which
 * uses the tip-vs-PIP relation (independent of fingertip clustering around
 * the palm center) and is robust to natural fist geometry where curled
 * fingertips remain spread across the metacarpals' x range.
 */
export function isFist(hand: Hand): boolean {
  // FIST_RATIO retained for callers that may want the geometric form.
  void FIST_RATIO;
  return extendedFingerCount(hand) === 0;
}

/** Alias for `isFist` (matches the boolean we expose downstream). */
export function isClosed(hand: Hand): boolean {
  return isFist(hand);
}

/**
 * Number of extended fingers on a single hand, 0..5.
 *
 * Heuristic:
 * - For index/middle/ring/pinky: the fingertip's normalized Y is *above*
 *   (smaller Y, since MediaPipe Y origin is the top of the frame) the PIP
 *   joint by a noticeable margin.
 * - For thumb: thumb-tip XY distance from palmCenter is greater than a
 *   fraction of handSize (the thumb extends sideways, not up).
 */
export function extendedFingerCount(hand: Hand): number {
  const lm = hand.landmarks;
  const size = handSize(lm);
  const margin = 0.02; // small Y gap to avoid edge flicker

  let count = 0;

  const fingers: Array<[number, number]> = [
    [INDEX_TIP, INDEX_PIP],
    [MIDDLE_TIP, MIDDLE_PIP],
    [RING_TIP, RING_PIP],
    [PINKY_TIP, PINKY_PIP],
  ];

  for (const [tipIdx, pipIdx] of fingers) {
    const tip = safeLandmark(lm, tipIdx);
    const pip = safeLandmark(lm, pipIdx);
    if (!tip || !pip) continue;
    if (tip.y + margin < pip.y) count += 1;
  }

  // Thumb: distance from palmCenter in XY plane > 0.55 * handSize ⇒ extended.
  const thumbTip = safeLandmark(lm, THUMB_TIP);
  if (thumbTip) {
    const d = distanceXY(thumbTip, hand.palmCenter);
    if (d > 0.55 * size) count += 1;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Aggregate frame state
// ---------------------------------------------------------------------------

/**
 * Build a GestureState from this frame's hands plus the prior state for
 * edge-trigger / accumulator computations.
 *
 * - rightPinchActive / leftPinchActive: edge-detect "pinching now".
 *   We pass through the boolean each frame; consumers may treat the
 *   transition false→true as the rising edge.
 * - noHandsDuration: accumulated seconds with no hands; resets to 0 when
 *   any hand is present.
 */
export function buildGestureState(
  hands: Hand[],
  dt: number,
  prevState: GestureState | null,
): GestureState {
  const right = hands.find((h) => h.side === 'right');
  const left = hands.find((h) => h.side === 'left');

  // Hands distance (palm-to-palm, in normalized coords; clamped to 0..1).
  let handsDistance = 0;
  if (right && left) {
    handsDistance = clamp01(distanceXY(right.palmCenter, left.palmCenter));
  }

  // Mean height — invert Y because MediaPipe Y origin is top.
  let meanHeight = 0;
  if (hands.length > 0) {
    let s = 0;
    for (const h of hands) s += 1 - h.palmCenter.y;
    meanHeight = clamp01(s / hands.length);
  } else {
    meanHeight = prevState?.meanHeight ?? 0;
  }

  const rightOpenness = right?.openness ?? 0;
  const leftOpenness = left?.openness ?? 0;

  // Pinch active = pinch ratio below trigger threshold.
  const rightPinchActive = right ? right.pinch < PINCH_TRIGGER : false;
  const leftPinchActive = left ? left.pinch < PINCH_TRIGGER : false;

  const bothFists =
    hands.length === 2 && isFist(hands[0]!) && isFist(hands[1]!);

  const bothAboveHead =
    hands.length === 2 &&
    hands.every((h) => h.palmCenter.y < 0.15);

  let fingerCount = 0;
  for (const h of hands) fingerCount += extendedFingerCount(h);

  const noHandsDuration =
    hands.length === 0
      ? Math.max(0, (prevState?.noHandsDuration ?? 0) + dt)
      : 0;

  // ---- 3D additions --------------------------------------------------------
  // Depth normalization — MediaPipe z values for typical hand poses span
  // roughly ±0.1 around the wrist. Map [-DEPTH_RANGE, +DEPTH_RANGE] →
  // [1 (close), 0 (far)].
  const rightDepth = right ? normDepth(right.depth) : 0;
  const leftDepth = left ? normDepth(left.depth) : 0;
  const meanDepth =
    hands.length === 2
      ? (rightDepth + leftDepth) / 2
      : hands.length === 1
        ? rightDepth + leftDepth // exactly one of these is nonzero
        : 0;

  const rollLimit = Math.PI / 2;
  const rightRoll = right ? clamp(right.roll, -rollLimit, rollLimit) / rollLimit : 0;
  const leftRoll = left ? clamp(left.roll, -rollLimit, rollLimit) / rollLimit : 0;

  const pitchLimit = Math.PI / 3;
  let meanPitchRaw = 0;
  if (hands.length > 0) {
    let s = 0;
    for (const h of hands) s += h.pitch;
    meanPitchRaw = s / hands.length;
  }
  const meanPitch = clamp(meanPitchRaw, -pitchLimit, pitchLimit) / pitchLimit;

  const handsDistance3D =
    right && left
      ? clamp01(distance3D(right.palmCenter, left.palmCenter))
      : 0;

  return {
    hands,
    bothHandsDetected: hands.length === 2,
    handsDistance,
    meanHeight,
    rightOpenness,
    leftOpenness,
    rightPinchActive,
    leftPinchActive,
    bothFists,
    bothAboveHead,
    fingerCount,
    noHandsDuration,
    meanDepth,
    rightRoll,
    leftRoll,
    handsDistance3D,
    meanPitch,
  };
}

/** Empirically — MediaPipe z values for typical hand poses span ~±0.1. */
const DEPTH_RANGE = 0.1;

/**
 * Map raw MediaPipe palm-Z (relative to wrist; small/negative when closer)
 * to a 0..1 depth signal where 1 = close to camera, 0 = far. The simple
 * linear remap clamps to the useful empirical range.
 */
function normDepth(z: number): number {
  return clamp01((DEPTH_RANGE - z) / (2 * DEPTH_RANGE));
}
