// Owner: hand-tracker (sibling module under src/face/)
//
// Unit tests for the face-gesture derivation helpers. Synthetic landmark
// fixtures only — no MediaPipe runtime needed.

import { describe, it, expect } from 'vitest';
import type { FaceLandmark } from '@contracts/contracts';
import {
  apparentFaceWidth,
  apparentSizeToCloseness,
  browRaiseFromLandmarks,
  extractEulerFromMatrix,
  faceCenter,
  faceHeight,
  LM_BROW_CENTRE,
  LM_CHIN_BOTTOM,
  LM_FOREHEAD_TOP,
  LM_LEFT_TRAGUS,
  LM_LOWER_INNER_LIP,
  LM_RIGHT_TRAGUS,
  LM_UPPER_EYELID,
  LM_UPPER_INNER_LIP,
  mouthOpenFromLandmarks,
} from './face-gestures';

// ---------------------------------------------------------------------------
// Synthetic landmark fixture: build a zeroed 478-array, then poke in only the
// indices the helpers actually read. Anything not poked stays at (0, 0, 0).
// ---------------------------------------------------------------------------

const NUM_LANDMARKS = 478;

function makeLandmarks(
  overrides: Partial<Record<number, FaceLandmark>> = {},
): FaceLandmark[] {
  const out: FaceLandmark[] = new Array(NUM_LANDMARKS);
  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    out[i] = { x: 0, y: 0, z: 0 };
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v) out[Number(k)] = v;
  }
  return out;
}

/**
 * Default neutral face: forehead at (0.5, 0.2), chin at (0.5, 0.8), tragi at
 * (0.4, 0.5) and (0.6, 0.5). Mouth slightly closed; brow at rest.
 */
function neutralFace(): FaceLandmark[] {
  return makeLandmarks({
    [LM_FOREHEAD_TOP]: { x: 0.5, y: 0.2, z: 0 },
    [LM_CHIN_BOTTOM]: { x: 0.5, y: 0.8, z: 0 },
    [LM_LEFT_TRAGUS]: { x: 0.4, y: 0.5, z: 0 },
    [LM_RIGHT_TRAGUS]: { x: 0.6, y: 0.5, z: 0 },
    [LM_UPPER_INNER_LIP]: { x: 0.5, y: 0.66, z: 0 },
    [LM_LOWER_INNER_LIP]: { x: 0.5, y: 0.665, z: 0 }, // small gap = relaxed
    [LM_BROW_CENTRE]: { x: 0.5, y: 0.43, z: 0 },
    [LM_UPPER_EYELID]: { x: 0.5, y: 0.45, z: 0 }, // brow ~0.02 above eyelid
  });
}

// ---------------------------------------------------------------------------
// extractEulerFromMatrix
// ---------------------------------------------------------------------------

describe('extractEulerFromMatrix', () => {
  it('returns zero angles for the identity matrix', () => {
    // Row-major identity.
    // prettier-ignore
    const id = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const r = extractEulerFromMatrix(id);
    expect(r.yaw).toBeCloseTo(0, 5);
    expect(r.pitch).toBeCloseTo(0, 5);
    expect(r.roll).toBeCloseTo(0, 5);
  });

  it('extracts a positive pitch from a chin-up rotation matrix', () => {
    // Pure rotation around X by +30 degrees. With our convention
    //   pitch = asin(-m12), m12 is row 1 col 2 = element index 6.
    // For Rx(theta):
    //   m11 = cos(theta), m12 = -sin(theta)
    //   sin(pitch) = -m12 = sin(theta) => pitch = +theta = +0.5236
    const theta = Math.PI / 6;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // prettier-ignore
    const rx = [
      1, 0,  0, 0,
      0, c, -s, 0,
      0, s,  c, 0,
      0, 0,  0, 1,
    ];
    const r = extractEulerFromMatrix(rx);
    expect(r.pitch).toBeCloseTo(theta, 5);
    expect(r.yaw).toBeCloseTo(0, 5);
    expect(r.roll).toBeCloseTo(0, 5);
  });

  it('extracts yaw from a pure Y-rotation (head turning right)', () => {
    // Ry(theta): m00=c, m02=s, m20=-s, m22=c
    //   pitch = asin(-m12) = asin(0) = 0
    //   yaw   = atan2(m02, m22) = atan2(s, c) = theta
    const theta = Math.PI / 5;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // prettier-ignore
    const ry = [
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    ];
    const r = extractEulerFromMatrix(ry);
    expect(r.yaw).toBeCloseTo(theta, 5);
    expect(r.pitch).toBeCloseTo(0, 5);
    expect(r.roll).toBeCloseTo(0, 5);
  });

  it('returns the translation z component as depth', () => {
    // Identity rotation, translation (0, 0, 0.42) in row-major (column-vector
    // convention puts tz at index 11).
    // prettier-ignore
    const m = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0.42,
      0, 0, 0, 1,
    ];
    const r = extractEulerFromMatrix(m);
    expect(r.depth).toBeCloseTo(0.42, 6);
  });

  it('returns zeros for an undersized matrix array (defensive)', () => {
    const r = extractEulerFromMatrix([1, 0, 0]);
    expect(r.yaw).toBe(0);
    expect(r.pitch).toBe(0);
    expect(r.roll).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// apparentFaceWidth / closeness
// ---------------------------------------------------------------------------

describe('apparentFaceWidth + apparentSizeToCloseness', () => {
  it('measures the tragus-to-tragus distance', () => {
    const lms = neutralFace();
    expect(apparentFaceWidth(lms)).toBeCloseTo(0.2, 6);
  });

  it('returns 0 if either tragus is missing', () => {
    const lms = makeLandmarks({
      [LM_LEFT_TRAGUS]: { x: 0.4, y: 0.5, z: 0 },
      // RIGHT_TRAGUS deliberately at (0,0) — distance still nonzero in our
      // fixture because makeLandmarks defaults to (0,0,0). We test with a
      // truly truncated array instead.
    });
    // Truncate to before the right-tragus index.
    const truncated = lms.slice(0, LM_RIGHT_TRAGUS);
    expect(apparentFaceWidth(truncated)).toBe(0);
  });

  it('maps raw width 0.10 -> 0 (far) and 0.30 -> 1 (close)', () => {
    expect(apparentSizeToCloseness(0.1)).toBeCloseTo(0, 5);
    expect(apparentSizeToCloseness(0.3)).toBeCloseTo(1, 5);
    expect(apparentSizeToCloseness(0.2)).toBeCloseTo(0.5, 5);
    expect(apparentSizeToCloseness(0.05)).toBe(0);
    expect(apparentSizeToCloseness(0.5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// faceHeight / faceCenter
// ---------------------------------------------------------------------------

describe('faceHeight + faceCenter', () => {
  it('faceHeight is forehead -> chin distance', () => {
    expect(faceHeight(neutralFace())).toBeCloseTo(0.6, 6);
  });

  it('faceCenter averages forehead, chin, and tragi', () => {
    const c = faceCenter(neutralFace());
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo((0.2 + 0.8 + 0.5 + 0.5) / 4, 6);
  });
});

// ---------------------------------------------------------------------------
// mouthOpenFromLandmarks
// ---------------------------------------------------------------------------

describe('mouthOpenFromLandmarks', () => {
  it('returns ~0 for relaxed lips', () => {
    expect(mouthOpenFromLandmarks(neutralFace())).toBeLessThan(0.05);
  });

  it('rises toward 1 as inner-lip gap grows', () => {
    const lms = neutralFace();
    // Push lower lip down hard; gap = 0.6 * faceHeight = beyond MOUTH_OPEN_FULL.
    lms[LM_LOWER_INNER_LIP] = { x: 0.5, y: 0.78, z: 0 };
    const v = mouthOpenFromLandmarks(lms);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('returns 0 if landmarks are missing', () => {
    expect(mouthOpenFromLandmarks([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// browRaiseFromLandmarks
// ---------------------------------------------------------------------------

describe('browRaiseFromLandmarks', () => {
  it('returns ~0 for a neutral brow', () => {
    expect(browRaiseFromLandmarks(neutralFace())).toBeLessThan(0.1);
  });

  it('rises toward 1 when the brow lifts away from the eyelid', () => {
    const lms = neutralFace();
    // Brow up: gap = 0.1 (>= BROW_FULL of 0.08 of faceHeight 0.6 = 0.048).
    lms[LM_BROW_CENTRE] = { x: 0.5, y: 0.35, z: 0 };
    lms[LM_UPPER_EYELID] = { x: 0.5, y: 0.45, z: 0 };
    const v = browRaiseFromLandmarks(lms);
    expect(v).toBeGreaterThan(0.5);
  });

  it('returns 0 for empty input', () => {
    expect(browRaiseFromLandmarks([])).toBe(0);
  });
});
