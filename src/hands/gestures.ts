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
const OPEN_MIN = 0.4;
/** Above this raw normalized openness ratio → fully open (1). */
const OPEN_MAX = 1.4;
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
  if (raw <= OPEN_MIN) return 0;
  if (raw >= OPEN_MAX) return 1;
  return (raw - OPEN_MIN) / (OPEN_MAX - OPEN_MIN);
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
  };
}
