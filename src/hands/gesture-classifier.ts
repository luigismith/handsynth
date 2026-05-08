// Owner: hand-tracker
//
// Pure helpers for the **discrete hand-shape classifier**. Given the 21
// MediaPipe HandLandmarks for a single hand, derive a per-finger curl scalar
// (0=extended, 1=curled), classify each finger as `extended | partial |
// curled` with hysteresis-friendly thresholds, then pattern-match the 5-tuple
// against the named static shapes in the contract (`HandShape`).
//
// No I/O, no timers, no class state. Tests in `gesture-classifier.test.ts`.
//
// MediaPipe HandLandmarker landmark indices (recap):
//   0 wrist
//   1-4 thumb (CMC, MCP, IP, TIP)
//   5-8 index (MCP, PIP, DIP, TIP)
//   9-12 middle
//   13-16 ring
//   17-20 pinky
//
// Calibration philosophy
// ----------------------
// The user has had repeated issues with gestures triggering accidentally.
// Every threshold here biases toward "miss the deliberate gesture rather
// than fire a spurious one". The thresholds are documented inline so a
// future tuner can shift them with full context.
//
//   EXTENDED_MAX = 0.30  — a finger has to look obviously extended
//   CURLED_MIN   = 0.75  — and obviously curled, separately
// The wide "partial" band in the middle absorbs near-but-not-deliberate
// poses without firing them as either extreme.

import type { HandLandmark, HandShape } from '@contracts/contracts';

// ---------------------------------------------------------------------------
// Landmark indices (re-declared locally so this file is self-contained)
// ---------------------------------------------------------------------------

const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_DIP = 7;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_DIP = 11;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_DIP = 15;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_DIP = 19;
const PINKY_TIP = 20;

const PALM_INDICES = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

/** Curl ≤ this → finger is `extended`. Wide enough that a slight bend still
 * counts as extended; tight enough that a half-curl never sneaks through. */
const EXTENDED_MAX = 0.3;
/** Curl ≥ this → finger is `curled`. */
const CURLED_MIN = 0.75;

/**
 * OK-shape thumb/index proximity threshold, normalized to palm width.
 * The thumb tip needs to land within ~25% of the index tip for the ring to
 * register.
 */
const OK_TOUCH_RATIO = 0.25;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type FingerState = 'extended' | 'partial' | 'curled';

export interface FingerCurls {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  pinky: number;
}

export interface FingerStates {
  thumb: FingerState;
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function dist3D(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function distXY(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function safe(landmarks: HandLandmark[], idx: number): HandLandmark | undefined {
  return landmarks[idx];
}

/**
 * Hand size reference: distance from wrist (0) to middle MCP (9). Stable
 * across depth and rotation; used to normalize fingertip distances so the
 * classifier works regardless of hand size in the frame.
 */
function handSize(landmarks: HandLandmark[]): number {
  const a = safe(landmarks, WRIST);
  const b = safe(landmarks, MIDDLE_MCP);
  if (!a || !b) return 1;
  const d = dist3D(a, b);
  return d > 1e-6 ? d : 1;
}

function palmCenter(landmarks: HandLandmark[]): HandLandmark {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const i of PALM_INDICES) {
    const p = safe(landmarks, i);
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    sz += p.z;
    n += 1;
  }
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: sx / n, y: sy / n, z: sz / n };
}

// ---------------------------------------------------------------------------
// Per-finger curl
// ---------------------------------------------------------------------------

/**
 * Per-finger curl 0..1.
 *
 * For index/middle/ring/pinky: we measure how much the finger has folded
 * back toward the palm. The signal is the ratio of the fingertip→MCP
 * distance to the canonical "fully extended" reference (PIP→MCP × 2.4).
 * When the tip is far past the PIP joint the ratio sits near 1.0 → curl 0
 * (extended); when the tip has folded back past the MCP the ratio collapses
 * to ~0.4 → curl ~1 (curled).
 *
 * For the thumb: the index landmarks line up sideways rather than forward,
 * so we instead measure tip→palmCenter distance against `handSize`. Beyond
 * 0.55× handSize the thumb is extended; below 0.35× it's tucked in.
 */
export function fingerCurl(
  landmarks: HandLandmark[],
  finger: Finger,
): number {
  if (finger === 'thumb') return thumbCurl(landmarks);

  const ids = FOUR_FINGER_IDS[finger];
  const tip = safe(landmarks, ids.tip);
  const pip = safe(landmarks, ids.pip);
  const mcp = safe(landmarks, ids.mcp);
  if (!tip || !pip || !mcp) return 0.5;

  const refLen = distXY(pip, mcp);
  if (refLen <= 1e-6) return 0.5;

  // Fully extended: the tip-to-MCP distance is roughly 2.4× the PIP-to-MCP
  // distance for a typical adult hand (empirical — measured across the test
  // fixtures). When the finger curls, the tip migrates back toward / behind
  // the MCP and that ratio shrinks.
  const tipMcp = distXY(tip, mcp);
  const ratio = tipMcp / refLen;
  // Map ratio∈[~1.0, ~2.4] to curl∈[1, 0]. Outside that band, clamp.
  // chosen empirically from the test fixtures so a clear extended hand
  // produces curl < 0.2 and a clear fist produces curl > 0.85.
  const RATIO_EXTENDED = 2.2;
  const RATIO_CURLED = 1.0;
  if (ratio >= RATIO_EXTENDED) return 0;
  if (ratio <= RATIO_CURLED) return 1;
  return 1 - (ratio - RATIO_CURLED) / (RATIO_EXTENDED - RATIO_CURLED);
}

const FOUR_FINGER_IDS: Record<Exclude<Finger, 'thumb'>, {
  tip: number;
  dip: number;
  pip: number;
  mcp: number;
}> = {
  index: { tip: INDEX_TIP, dip: INDEX_DIP, pip: INDEX_PIP, mcp: INDEX_MCP },
  middle: { tip: MIDDLE_TIP, dip: MIDDLE_DIP, pip: MIDDLE_PIP, mcp: MIDDLE_MCP },
  ring: { tip: RING_TIP, dip: RING_DIP, pip: RING_PIP, mcp: RING_MCP },
  pinky: { tip: PINKY_TIP, dip: PINKY_DIP, pip: PINKY_PIP, mcp: PINKY_MCP },
};

function thumbCurl(landmarks: HandLandmark[]): number {
  const tip = safe(landmarks, THUMB_TIP);
  if (!tip) return 0.5;
  const center = palmCenter(landmarks);
  const size = handSize(landmarks);
  const d = distXY(tip, center) / size;
  // d ∈ ~[0.2 (tucked) .. 0.9 (extended sideways)]
  // Map [0.35, 0.55] → [curled=1 .. extended=0]. The extended threshold of
  // 0.55 matches `gestures.ts` extendedFingerCount(); the curled threshold
  // of 0.35 is wide enough that a thumb wrapped across the palm reads as
  // curled even with imperfect MediaPipe landmarks.
  if (d >= 0.55) return 0;
  if (d <= 0.35) return 1;
  return 1 - (d - 0.35) / (0.55 - 0.35);
}

// ---------------------------------------------------------------------------
// Per-finger state classification (with the wide partial band)
// ---------------------------------------------------------------------------

export function fingerStateFromCurl(curl: number): FingerState {
  if (curl <= EXTENDED_MAX) return 'extended';
  if (curl >= CURLED_MIN) return 'curled';
  return 'partial';
}

export function classifyFingers(landmarks: HandLandmark[]): FingerStates {
  return {
    thumb: fingerStateFromCurl(fingerCurl(landmarks, 'thumb')),
    index: fingerStateFromCurl(fingerCurl(landmarks, 'index')),
    middle: fingerStateFromCurl(fingerCurl(landmarks, 'middle')),
    ring: fingerStateFromCurl(fingerCurl(landmarks, 'ring')),
    pinky: fingerStateFromCurl(fingerCurl(landmarks, 'pinky')),
  };
}

export function fingerCurls(landmarks: HandLandmark[]): FingerCurls {
  return {
    thumb: fingerCurl(landmarks, 'thumb'),
    index: fingerCurl(landmarks, 'index'),
    middle: fingerCurl(landmarks, 'middle'),
    ring: fingerCurl(landmarks, 'ring'),
    pinky: fingerCurl(landmarks, 'pinky'),
  };
}

// ---------------------------------------------------------------------------
// Auxiliary geometry queries used by specific shapes
// ---------------------------------------------------------------------------

/**
 * Distance between the thumb tip and the index tip, normalized to the
 * `handSize` reference (wrist → middle MCP). Used by the `ok` shape to
 * detect when thumb and index form a ring.
 *
 * Output range: 0 (touching) to ~3 (fully splayed) on a typical hand.
 */
export function thumbIndexDistance(landmarks: HandLandmark[]): number {
  const t = safe(landmarks, THUMB_TIP);
  const i = safe(landmarks, INDEX_TIP);
  if (!t || !i) return 1;
  const size = handSize(landmarks);
  if (size <= 1e-6) return 1;
  return dist3D(t, i) / size;
}

/**
 * World-space thumb direction in image coords: positive y = thumb pointing
 * UP (toward the top of the frame, since MediaPipe Y origin is the top —
 * a thumb pointing up has tip.y < cmc.y, i.e. dy < 0). We negate so the
 * sign convention matches the user-facing intuition: +1 ≈ thumbs-up,
 * -1 ≈ thumbs-down.
 */
export function thumbVerticality(landmarks: HandLandmark[]): number {
  const tip = safe(landmarks, THUMB_TIP);
  const cmc = safe(landmarks, THUMB_CMC);
  if (!tip || !cmc) return 0;
  const dx = tip.x - cmc.x;
  const dy = tip.y - cmc.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 1e-6) return 0;
  // dy<0 (tip above CMC in image space) → thumb points UP → return +
  return -dy / len;
}

/**
 * Angle (radians) between thumb axis and index axis. Used by `finger_gun`:
 * a true L-shape has the two near 90°. Returns the absolute angle in [0, π].
 */
export function thumbIndexAngle(landmarks: HandLandmark[]): number {
  const tIp = safe(landmarks, THUMB_IP);
  const tTip = safe(landmarks, THUMB_TIP);
  const iMcp = safe(landmarks, INDEX_MCP);
  const iTip = safe(landmarks, INDEX_TIP);
  if (!tIp || !tTip || !iMcp || !iTip) return 0;
  const tx = tTip.x - tIp.x;
  const ty = tTip.y - tIp.y;
  const ix = iTip.x - iMcp.x;
  const iy = iTip.y - iMcp.y;
  const tLen = Math.sqrt(tx * tx + ty * ty);
  const iLen = Math.sqrt(ix * ix + iy * iy);
  if (tLen <= 1e-6 || iLen <= 1e-6) return 0;
  const cos = (tx * ix + ty * iy) / (tLen * iLen);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

// ---------------------------------------------------------------------------
// Shape pattern matching
// ---------------------------------------------------------------------------

/**
 * Classify the hand into one of the named static shapes. Returns `unknown`
 * when no pattern matches with full confidence — anti-flicker is the
 * GestureInterpreter's job, not this function's.
 *
 * Pattern matching order is important — the more specific shapes must
 * dominate the more general ones. e.g. `finger_gun` would otherwise be
 * classified as `point` (index + thumb extended, M/R/P curled both ways).
 */
export function classifyHandShape(landmarks: HandLandmark[]): HandShape {
  if (landmarks.length < 21) return 'unknown';

  const states = classifyFingers(landmarks);
  const isExt = (s: FingerState): boolean => s === 'extended';
  const isCurled = (s: FingerState): boolean => s === 'curled';
  const notExt = (s: FingerState): boolean => s !== 'extended';
  const notCurled = (s: FingerState): boolean => s !== 'curled';

  const T = states.thumb;
  const I = states.index;
  const M = states.middle;
  const R = states.ring;
  const P = states.pinky;

  // OK: thumb tip near index tip, M/R/P extended. Order BEFORE the generic
  // "all extended" check because the index curls toward the thumb so the
  // index curl reading rises into the partial band.
  if (
    thumbIndexDistance(landmarks) < OK_TOUCH_RATIO &&
    isExt(M) &&
    isExt(R) &&
    isExt(P)
  ) {
    return 'ok';
  }

  // open_palm: every finger extended. Highly specific, ordered before the
  // shapes that share part of the pattern.
  if (isExt(T) && isExt(I) && isExt(M) && isExt(R) && isExt(P)) {
    return 'open_palm';
  }

  // four: I+M+R+P extended, thumb curled.
  if (isCurled(T) && isExt(I) && isExt(M) && isExt(R) && isExt(P)) {
    return 'four';
  }

  // three: I+M+R extended, thumb + pinky curled.
  if (isCurled(T) && isExt(I) && isExt(M) && isExt(R) && isCurled(P)) {
    return 'three';
  }

  // call_me (shaka): thumb + pinky extended, I/M/R curled.
  if (isExt(T) && isCurled(I) && isCurled(M) && isCurled(R) && isExt(P)) {
    return 'call_me';
  }

  // rock_on: index + pinky extended, middle + ring curled.
  if (isExt(I) && isCurled(M) && isCurled(R) && isExt(P)) {
    // Thumb is "any" — but rule out the call_me case which we already
    // matched above by requiring index extended.
    return 'rock_on';
  }

  // peace: index + middle extended, ring + pinky curled.
  if (isExt(I) && isExt(M) && isCurled(R) && isCurled(P)) {
    return 'peace';
  }

  // finger_gun: thumb extended ~perpendicular, index extended, M/R/P curled.
  // Match BEFORE point — point allows thumb to be "any" so an L-shape with
  // an extended thumb would otherwise read as point.
  if (
    isExt(T) &&
    isExt(I) &&
    isCurled(M) &&
    isCurled(R) &&
    isCurled(P) &&
    Math.abs(thumbIndexAngle(landmarks) - Math.PI / 2) < Math.PI / 4
  ) {
    return 'finger_gun';
  }

  // thumbs_up / thumbs_down: thumb extended pointing up or down, others curled.
  if (isExt(T) && isCurled(I) && isCurled(M) && isCurled(R) && isCurled(P)) {
    const v = thumbVerticality(landmarks);
    if (v > 0.5) return 'thumbs_up';
    if (v < -0.5) return 'thumbs_down';
    // Thumb extended but pointing sideways — probably finger_gun without
    // the index extended; not a named shape.
    return 'unknown';
  }

  // point: index extended, M/R/P curled, thumb any.
  if (notExt(T) === false || isCurled(T) || states.thumb === 'partial') {
    if (
      isExt(I) &&
      isCurled(M) &&
      isCurled(R) &&
      isCurled(P) &&
      // If we got here with the thumb extended we'd have matched
      // finger_gun above (perpendicular) or thumbs_up/down (vertical).
      // This branch handles thumb in any non-finger-gun state including
      // partial / curled.
      !isExt(T)
    ) {
      return 'point';
    }
  }

  // fist: every finger curled. Last resort because partial fingers shouldn't
  // stop a clearly-fist hand from registering — but the strict version is
  // safer per the calibration philosophy. notCurled wins out.
  if (
    !notCurled(T) &&
    !notCurled(I) &&
    !notCurled(M) &&
    !notCurled(R) &&
    !notCurled(P)
  ) {
    return 'fist';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Re-exports for tests
// ---------------------------------------------------------------------------

/** Useful for tests — the raw thresholds. */
export const __testing = {
  EXTENDED_MAX,
  CURLED_MIN,
  OK_TOUCH_RATIO,
  clamp01,
  handSize,
  palmCenter,
};
