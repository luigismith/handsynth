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
// Eye openness (geometric eye-aspect ratio, EAR)
//
// The MediaPipe FaceMesh canonical landmark indices for the eye contours
// give us a vertical / horizontal ratio that maps cleanly to "openness":
//
//   Left eye:  top (159, 158), bottom (145, 153), corners 33 (outer), 133 (inner)
//   Right eye: top (386, 385), bottom (374, 380), corners 263 (outer), 362 (inner)
//
// EAR = mean(vertical1, vertical2) / horizontalWidth.
// Typical resting ~0.30, fully open ~0.45+, blink/closed ~0.15.
//
// We expose helpers for each side plus a `normalizeEyeOpenness` that
// re-centres the signal around 0.5 at rest, peaks near 1 at wide-open,
// and dips to 0 on a blink.
// ---------------------------------------------------------------------------

const LM_LEFT_EYE_TOP_OUTER = 159;
const LM_LEFT_EYE_TOP_INNER = 158;
const LM_LEFT_EYE_BOTTOM_OUTER = 145;
const LM_LEFT_EYE_BOTTOM_INNER = 153;
const LM_LEFT_EYE_OUTER_CORNER = 33;
const LM_LEFT_EYE_INNER_CORNER = 133;

const LM_RIGHT_EYE_TOP_OUTER = 386;
const LM_RIGHT_EYE_TOP_INNER = 385;
const LM_RIGHT_EYE_BOTTOM_OUTER = 374;
const LM_RIGHT_EYE_BOTTOM_INNER = 380;
const LM_RIGHT_EYE_OUTER_CORNER = 263;
const LM_RIGHT_EYE_INNER_CORNER = 362;

/** EAR calibration: resting eye sits around this raw value. */
const EAR_REST = 0.3;
/** Fully open (deliberate wide-eye stare). Maps to normalized 1.0. */
const EAR_FULL = 0.45;
/** Blink / closed. Maps to normalized 0. */
const EAR_CLOSED = 0.15;

/**
 * Geometric eye-aspect ratio for the LEFT eye. Returns 0 if any required
 * landmark is missing or the horizontal width is zero.
 */
export function eyeAspectRatioLeft(landmarks: FaceLandmark[]): number {
  const t1 = landmarks[LM_LEFT_EYE_TOP_OUTER];
  const t2 = landmarks[LM_LEFT_EYE_TOP_INNER];
  const b1 = landmarks[LM_LEFT_EYE_BOTTOM_OUTER];
  const b2 = landmarks[LM_LEFT_EYE_BOTTOM_INNER];
  const c1 = landmarks[LM_LEFT_EYE_OUTER_CORNER];
  const c2 = landmarks[LM_LEFT_EYE_INNER_CORNER];
  if (!t1 || !t2 || !b1 || !b2 || !c1 || !c2) return 0;
  const v1 = dist2D(t1, b1);
  const v2 = dist2D(t2, b2);
  const w = dist2D(c1, c2);
  if (w <= 0) return 0;
  return (v1 + v2) / 2 / w;
}

/** Geometric EAR for the RIGHT eye. See `eyeAspectRatioLeft`. */
export function eyeAspectRatioRight(landmarks: FaceLandmark[]): number {
  const t1 = landmarks[LM_RIGHT_EYE_TOP_OUTER];
  const t2 = landmarks[LM_RIGHT_EYE_TOP_INNER];
  const b1 = landmarks[LM_RIGHT_EYE_BOTTOM_OUTER];
  const b2 = landmarks[LM_RIGHT_EYE_BOTTOM_INNER];
  const c1 = landmarks[LM_RIGHT_EYE_OUTER_CORNER];
  const c2 = landmarks[LM_RIGHT_EYE_INNER_CORNER];
  if (!t1 || !t2 || !b1 || !b2 || !c1 || !c2) return 0;
  const v1 = dist2D(t1, b1);
  const v2 = dist2D(t2, b2);
  const w = dist2D(c1, c2);
  if (w <= 0) return 0;
  return (v1 + v2) / 2 / w;
}

/**
 * Map raw EAR (or 1 - eyeBlink blendshape, which has the same useful range)
 * onto a 0..1 normalized openness signal:
 *   - At EAR_REST (~0.30) -> 0.5  (eyes at neutral, half-lit)
 *   - At EAR_FULL (~0.45) -> 1.0  (deliberately wide)
 *   - At EAR_CLOSED (~0.15) -> 0  (blink / closed)
 *
 * Two-segment linear ramp through the rest point so the upper and lower
 * halves of the curve are independently calibrated.
 */
export function normalizeEyeOpenness(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw <= EAR_CLOSED) return 0;
  if (raw >= EAR_FULL) return 1;
  if (raw <= EAR_REST) {
    // Lower half: closed→rest maps to 0..0.5.
    return ((raw - EAR_CLOSED) / (EAR_REST - EAR_CLOSED)) * 0.5;
  }
  // Upper half: rest→full maps to 0.5..1.
  return 0.5 + ((raw - EAR_REST) / (EAR_FULL - EAR_REST)) * 0.5;
}

// ---------------------------------------------------------------------------
// Face center (un-mirrored). The FaceTracker x-flips at emit time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Expression derivation from MediaPipe blendshapes.
//
// MediaPipe FaceLandmarker emits ~52 blendshape categories per frame. We pick
// a curated subset and combine them into four "expression scalars" that map
// cleanly onto musical parameters in InteractionMapper. The helper is pure —
// it takes the raw blendshape array and returns the derived 0..1 scores.
// Caller is responsible for One-Euro filtering downstream.
//
// Calibration notes:
//   - smile: mean of mouthSmileLeft + mouthSmileRight. Both already saturate
//     near 1 on a deliberate grin. Mean keeps asymmetric smiles honest.
//   - frown: mean of mouthFrownLeft + mouthFrownRight. Geometric pull-down.
//   - surprise: mean of jawOpen, browInnerUp, eyeWideLeft, eyeWideRight. The
//     combination is what reads as "surprise" — none alone is enough (jaw
//     drop without raised brows = yawn; raised brows alone = curiosity).
//   - anger: mean of browDownLeft + browDownRight, suppressed by smile so
//     a grin can't trip the anger lamp accidentally.
// ---------------------------------------------------------------------------

interface BlendshapeMap {
  [name: string]: number;
}

function blendMap(
  blendshapes: { name: string; score: number }[],
): BlendshapeMap {
  const out: BlendshapeMap = {};
  for (const b of blendshapes) {
    out[b.name] = b.score;
  }
  return out;
}

function pick(map: BlendshapeMap, name: string): number {
  const v = map[name];
  return typeof v === 'number' ? clamp01(v) : 0;
}

/**
 * Derive expression scalars (smile / frown / surprise / anger) from a
 * MediaPipe blendshape array. Each output is 0..1.
 *
 * The blendshape array can be passed directly from
 * `FaceLandmarkerResult.faceBlendshapes[0].categories` mapped to
 * `{ name: c.categoryName, score: c.score }` — the helper reads only what it
 * needs and tolerates missing entries (returns 0 for absent shapes).
 */
export function deriveExpressions(
  blendshapes: { name: string; score: number }[],
): { smile: number; frown: number; surprise: number; anger: number } {
  if (!blendshapes || blendshapes.length === 0) {
    return { smile: 0, frown: 0, surprise: 0, anger: 0 };
  }
  const m = blendMap(blendshapes);

  const smileL = pick(m, 'mouthSmileLeft');
  const smileR = pick(m, 'mouthSmileRight');
  const smile = (smileL + smileR) * 0.5;

  const frownL = pick(m, 'mouthFrownLeft');
  const frownR = pick(m, 'mouthFrownRight');
  const frown = (frownL + frownR) * 0.5;

  // Surprise: jawOpen + browInnerUp + eyeWide(L|R). Equal-weight mean keeps
  // the signal honest when only some hints fire (e.g. eyes-wide-only is
  // half a surprise; jaw-drop-only is a quarter).
  const jawOpen = pick(m, 'jawOpen');
  const browInner = pick(m, 'browInnerUp');
  const eyeWideL = pick(m, 'eyeWideLeft');
  const eyeWideR = pick(m, 'eyeWideRight');
  const surprise = (jawOpen + browInner + eyeWideL + eyeWideR) * 0.25;

  // Anger: brows pulled down. Suppressed by smile so a grimacing grin
  // doesn't read as anger.
  const browDownL = pick(m, 'browDownLeft');
  const browDownR = pick(m, 'browDownRight');
  const browDown = (browDownL + browDownR) * 0.5;
  const anger = clamp01(browDown * (1 - smile));

  return {
    smile: clamp01(smile),
    frown: clamp01(frown),
    surprise: clamp01(surprise),
    anger,
  };
}

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
