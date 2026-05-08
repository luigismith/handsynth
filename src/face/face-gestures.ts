// Owner: hand-tracker (sibling module under src/face/)
//
// Pure helpers for deriving FaceState scalars from the MediaPipe FaceLandmarker
// outputs. Exposed as standalone functions so they can be tested with synthetic
// landmark fixtures (no MediaPipe runtime needed).
//
// Coordinate convention: input landmarks are in MediaPipe's UN-mirrored image
// space (x increases to the right of the camera). The FaceTracker mirrors x at
// emit time; these helpers do not mirror — they operate on either space since
// they only use distances and intra-face ratios.

import type { FaceLandmark } from '@contracts/contracts';

// ---------------------------------------------------------------------------
// MediaPipe FaceLandmarker landmark indices (canonical mesh, 478 points).
// We only name the few we use. See:
//   https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
// ---------------------------------------------------------------------------

/** Left tragus (camera POV — appears on left side of un-mirrored image). */
export const LM_LEFT_TRAGUS = 234;
/** Right tragus. */
export const LM_RIGHT_TRAGUS = 454;
/** Forehead-top (top of face bounding box). */
export const LM_FOREHEAD_TOP = 10;
/** Chin-bottom. */
export const LM_CHIN_BOTTOM = 152;
/** Inner upper lip (mouth-open lower bound). */
export const LM_UPPER_INNER_LIP = 13;
/** Inner lower lip. */
export const LM_LOWER_INNER_LIP = 14;
/** Brow centre. */
export const LM_BROW_CENTRE = 9;
/** Upper eyelid centre (used as the "rest" reference point for browRaise). */
export const LM_UPPER_EYELID = 8;

// ---------------------------------------------------------------------------
// Maths helpers (kept private — face-gestures.test.ts exercises them via the
// public API).
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

function dist2D(a: FaceLandmark, b: FaceLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------
// Pose extraction
// ---------------------------------------------------------------------------

/**
 * Extract Euler angles (yaw, pitch, roll) from a 4x4 row-major facial
 * transformation matrix. The 16-element array layout is:
 *
 *     [ m00  m01  m02  m03 ]   row 0
 *     [ m10  m11  m12  m13 ]   row 1
 *     [ m20  m21  m22  m23 ]   row 2
 *     [ m30  m31  m32  m33 ]   row 3 (translation in m03/m13/m23 of cols)
 *
 * Index map for row-major:
 *     0  1  2  3
 *     4  5  6  7
 *     8  9 10 11
 *    12 13 14 15
 *
 * The upper-left 3x3 is the rotation matrix R. We use the standard
 * Tait-Bryan extraction with the convention:
 *
 *     R = Ry(yaw) * Rx(pitch) * Rz(roll)
 *
 *     pitch = asin(-R[1][2])         // = -m06
 *     yaw   = atan2(R[0][2], R[2][2]) // = atan2(m02, m10) -- see code
 *     roll  = atan2(R[1][0], R[1][1]) // = atan2(m04, m05)
 *
 * `depth` returns the z translation (m11 in zero-indexed = m[11]) — useful as a
 * fallback distance proxy when apparent face width is unreliable.
 */
export function extractEulerFromMatrix(m: number[]): {
  yaw: number;
  pitch: number;
  roll: number;
  depth: number;
} {
  if (m.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0, depth: 0 };
  }
  // Row-major indexing. Only the rotation entries we actually use:
  //   m00, m02, m10, m11, m12, m20, m22 — plus the z-translation tz at idx 11.
  const m00 = m[0]!;
  const m02 = m[2]!;
  const m10 = m[4]!;
  const m11 = m[5]!;
  const m12 = m[6]!;
  const m20 = m[8]!;
  const m22 = m[10]!;
  const tz = m[11]!;

  // Clamp the asin argument to avoid NaN at the gimbal-lock boundary.
  const sinPitch = clamp(-m12, -1, 1);
  const pitch = Math.asin(sinPitch);

  // Near gimbal lock (|cos(pitch)| ≈ 0), yaw and roll degenerate. Fall back to
  // the simpler decomposition using m00/m02.
  const cosPitch = Math.cos(pitch);
  let yaw: number;
  let roll: number;
  if (Math.abs(cosPitch) < 1e-6) {
    yaw = Math.atan2(-m20, m00);
    roll = 0;
  } else {
    yaw = Math.atan2(m02, m22);
    roll = Math.atan2(m10, m11);
  }

  return { yaw, pitch, roll, depth: tz };
}

// ---------------------------------------------------------------------------
// Apparent face width (depth proxy)
// ---------------------------------------------------------------------------

/**
 * Distance between the two tragus landmarks in normalized image coordinates.
 * This is a face-width proxy that is largely independent of mouth/eye motion.
 *
 * Returns 0 if landmarks are missing.
 */
export function apparentFaceWidth(landmarks: FaceLandmark[]): number {
  const a = landmarks[LM_LEFT_TRAGUS];
  const b = landmarks[LM_RIGHT_TRAGUS];
  if (!a || !b) return 0;
  return dist2D(a, b);
}

/**
 * Map the raw apparent face width to a 0..1 closeness score. At a "comfortable
 * viewing distance" the apparent size is ~0.18; closer ~0.30, farther ~0.10.
 */
export function apparentSizeToCloseness(rawWidth: number): number {
  return clamp01((rawWidth - 0.1) / 0.2);
}

// ---------------------------------------------------------------------------
// Face height (used as the denominator for mouthOpen / browRaise)
// ---------------------------------------------------------------------------

/**
 * Distance from forehead-top landmark (10) to chin-bottom (152). Used as the
 * denominator when normalising vertical facial features.
 */
export function faceHeight(landmarks: FaceLandmark[]): number {
  const top = landmarks[LM_FOREHEAD_TOP];
  const bot = landmarks[LM_CHIN_BOTTOM];
  if (!top || !bot) return 0;
  return dist2D(top, bot);
}

// ---------------------------------------------------------------------------
// Mouth open
// ---------------------------------------------------------------------------

const MOUTH_OPEN_REST = 0.012; // ratio mouthGap / faceHeight at relaxed mouth
const MOUTH_OPEN_FULL = 0.18; // ratio at fully open jaw

/**
 * Compute mouth-open ratio from inner-lip landmarks. Returns 0..1 normalized
 * against face height.
 */
export function mouthOpenFromLandmarks(landmarks: FaceLandmark[]): number {
  const upper = landmarks[LM_UPPER_INNER_LIP];
  const lower = landmarks[LM_LOWER_INNER_LIP];
  const fh = faceHeight(landmarks);
  if (!upper || !lower || fh <= 0) return 0;
  const gap = dist2D(upper, lower);
  const ratio = gap / fh;
  return clamp01((ratio - MOUTH_OPEN_REST) / (MOUTH_OPEN_FULL - MOUTH_OPEN_REST));
}

// ---------------------------------------------------------------------------
// Brow raise
// ---------------------------------------------------------------------------

const BROW_REST = 0.04; // brow-to-eyelid ratio at neutral expression
const BROW_FULL = 0.08; // ratio at fully raised brow

/**
 * Compute brow raise from the brow-centre vs upper-eyelid landmarks. Returns
 * 0..1 normalized against face height.
 */
export function browRaiseFromLandmarks(landmarks: FaceLandmark[]): number {
  const brow = landmarks[LM_BROW_CENTRE];
  const eyelid = landmarks[LM_UPPER_EYELID];
  const fh = faceHeight(landmarks);
  if (!brow || !eyelid || fh <= 0) return 0;
  const gap = dist2D(brow, eyelid);
  const ratio = gap / fh;
  return clamp01((ratio - BROW_REST) / (BROW_FULL - BROW_REST));
}

// ---------------------------------------------------------------------------
// Face center (un-mirrored). The FaceTracker x-flips at emit time.
// ---------------------------------------------------------------------------

/**
 * Centroid of a representative subset of landmarks. Cheap and stable: average
 * of forehead, chin, both tragi.
 */
export function faceCenter(landmarks: FaceLandmark[]): { x: number; y: number } {
  const top = landmarks[LM_FOREHEAD_TOP];
  const bot = landmarks[LM_CHIN_BOTTOM];
  const lt = landmarks[LM_LEFT_TRAGUS];
  const rt = landmarks[LM_RIGHT_TRAGUS];
  const pts: FaceLandmark[] = [];
  if (top) pts.push(top);
  if (bot) pts.push(bot);
  if (lt) pts.push(lt);
  if (rt) pts.push(rt);
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}
