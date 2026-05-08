// Owner: hand-tracker
//
// Unit tests for the gesture-derivation helpers. Synthesized fixtures only —
// no MediaPipe runtime needed.

import { describe, it, expect } from 'vitest';
import type { Hand, HandLandmark } from '@contracts/contracts';
import {
  buildGestureState,
  computeOpenness,
  computePalmCenter,
  computePalmDepth,
  computePalmPitch,
  computePalmRoll,
  computePinch,
  extendedFingerCount,
  isFist,
} from './gestures';

// ---------------------------------------------------------------------------
// Synthetic fixtures
//
// MediaPipe HandLandmarker landmark order:
//   0 wrist
//   1-4 thumb (CMC, MCP, IP, TIP)
//   5-8 index (MCP, PIP, DIP, TIP)
//   9-12 middle
//   13-16 ring
//   17-20 pinky
// ---------------------------------------------------------------------------

function pt(x: number, y: number, z = 0): HandLandmark {
  return { x, y, z };
}

/** Open hand fixture — fingers fully splayed upward from the palm. */
function openHand(): HandLandmark[] {
  // Wrist at (0.5, 0.8). Palm landmarks at y ≈ 0.6. Fingertips at y ≈ 0.2.
  return [
    pt(0.5, 0.8), // 0  wrist
    pt(0.40, 0.75), // 1  thumb CMC
    pt(0.30, 0.70), // 2  thumb MCP
    pt(0.22, 0.65), // 3  thumb IP
    pt(0.15, 0.60), // 4  thumb TIP (extended sideways)
    pt(0.42, 0.60), // 5  index MCP
    pt(0.42, 0.45), // 6  index PIP
    pt(0.42, 0.30), // 7  index DIP
    pt(0.42, 0.15), // 8  index TIP
    pt(0.50, 0.60), // 9  middle MCP
    pt(0.50, 0.45), // 10 middle PIP
    pt(0.50, 0.30), // 11 middle DIP
    pt(0.50, 0.15), // 12 middle TIP
    pt(0.58, 0.60), // 13 ring MCP
    pt(0.58, 0.45), // 14 ring PIP
    pt(0.58, 0.30), // 15 ring DIP
    pt(0.58, 0.15), // 16 ring TIP
    pt(0.66, 0.60), // 17 pinky MCP
    pt(0.66, 0.48), // 18 pinky PIP
    pt(0.66, 0.32), // 19 pinky DIP
    pt(0.66, 0.18), // 20 pinky TIP
  ];
}

/** Fist fixture — fingertips curled tightly around the palm centre. */
function fistHand(): HandLandmark[] {
  const lm = openHand();
  // Pull fingertips back down close to palm centre (y ≈ 0.6, x in 0.42..0.66).
  // Also pull thumb in.
  lm[4] = pt(0.46, 0.62); // thumb TIP folded across palm
  lm[8] = pt(0.42, 0.62); // index TIP
  lm[12] = pt(0.50, 0.62); // middle TIP
  lm[16] = pt(0.58, 0.62); // ring TIP
  lm[20] = pt(0.66, 0.62); // pinky TIP
  // Bring PIPs in too so tip.y > pip.y → finger considered NOT extended.
  lm[6] = pt(0.42, 0.55);
  lm[10] = pt(0.50, 0.55);
  lm[14] = pt(0.58, 0.55);
  lm[18] = pt(0.66, 0.55);
  return lm;
}

function translate(lm: HandLandmark[], dx: number, dy: number): HandLandmark[] {
  return lm.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z }));
}

function handFromLandmarks(
  side: 'left' | 'right',
  lm: HandLandmark[],
): Hand {
  const palmCenter = computePalmCenter(lm);
  const provisional: Hand = {
    side,
    landmarks: lm,
    palmCenter,
    openness: 0,
    pinch: 1,
    isClosed: false,
    depth: 0,
    roll: 0,
    pitch: 0,
  };
  const opn = computeOpenness(provisional);
  const pin = computePinch(provisional);
  return {
    ...provisional,
    openness: opn,
    pinch: pin,
    isClosed: isFist(provisional),
    depth: computePalmDepth(lm),
    roll: computePalmRoll(lm),
    pitch: computePalmPitch(lm),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computePalmCenter', () => {
  it('averages the five palm landmarks', () => {
    const lm = openHand();
    const c = computePalmCenter(lm);
    // Palm landmarks: 0, 5, 9, 13, 17. Their xs: 0.5, 0.42, 0.5, 0.58, 0.66.
    expect(c.x).toBeCloseTo((0.5 + 0.42 + 0.5 + 0.58 + 0.66) / 5, 6);
    expect(c.y).toBeCloseTo((0.8 + 0.6 + 0.6 + 0.6 + 0.6) / 5, 6);
  });

  it('returns a zero vector for empty input', () => {
    expect(computePalmCenter([])).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('computeOpenness', () => {
  it('returns near 1 for a fully open hand', () => {
    const h = handFromLandmarks('right', openHand());
    expect(h.openness).toBeGreaterThan(0.6);
    expect(h.openness).toBeLessThanOrEqual(1);
  });

  it('returns near 0 for a fist', () => {
    const h = handFromLandmarks('right', fistHand());
    expect(h.openness).toBeLessThan(0.2);
  });
});

describe('computePinch', () => {
  it('reports a small value when thumb and index tips are close', () => {
    const lm = openHand();
    // Move thumb tip onto index tip.
    lm[4] = { x: lm[8]!.x, y: lm[8]!.y, z: lm[8]!.z };
    const h = handFromLandmarks('right', lm);
    expect(h.pinch).toBeLessThan(0.1);
  });

  it('reports a high value when thumb and index are far apart', () => {
    const h = handFromLandmarks('right', openHand());
    expect(h.pinch).toBeGreaterThan(0.5);
  });
});

describe('isFist / extendedFingerCount', () => {
  it('open hand → not a fist, 4-5 extended fingers', () => {
    const h = handFromLandmarks('right', openHand());
    expect(isFist(h)).toBe(false);
    expect(extendedFingerCount(h)).toBeGreaterThanOrEqual(4);
  });

  it('closed hand → is a fist, 0 extended fingers', () => {
    const h = handFromLandmarks('right', fistHand());
    expect(isFist(h)).toBe(true);
    expect(extendedFingerCount(h)).toBe(0);
  });
});

describe('buildGestureState', () => {
  it('reports zero hands and accumulates noHandsDuration', () => {
    const s1 = buildGestureState([], 0.016, null);
    expect(s1.hands.length).toBe(0);
    expect(s1.bothHandsDetected).toBe(false);
    expect(s1.noHandsDuration).toBeCloseTo(0.016, 6);

    const s2 = buildGestureState([], 0.016, s1);
    expect(s2.noHandsDuration).toBeCloseTo(0.032, 6);
  });

  it('resets noHandsDuration when a hand reappears', () => {
    const prev = buildGestureState([], 0.5, null);
    expect(prev.noHandsDuration).toBeCloseTo(0.5, 6);
    const right = handFromLandmarks('right', openHand());
    const next = buildGestureState([right], 0.016, prev);
    expect(next.noHandsDuration).toBe(0);
    expect(next.bothHandsDetected).toBe(false);
  });

  it('detects two hands and computes per-side openness', () => {
    const right = handFromLandmarks('right', openHand());
    const left = handFromLandmarks('left', translate(fistHand(), -0.3, 0));
    const s = buildGestureState([right, left], 0.016, null);
    expect(s.bothHandsDetected).toBe(true);
    expect(s.rightOpenness).toBeGreaterThan(0.5);
    expect(s.leftOpenness).toBeLessThan(0.2);
    expect(s.handsDistance).toBeGreaterThan(0);
  });

  it('flags bothFists when both hands are closed', () => {
    const right = handFromLandmarks('right', fistHand());
    const left = handFromLandmarks('left', translate(fistHand(), -0.3, 0));
    const s = buildGestureState([right, left], 0.016, null);
    expect(s.bothFists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3D derivations: depth, roll, pitch
// ---------------------------------------------------------------------------

describe('computePalmDepth', () => {
  it('returns the mean Z of palm landmarks {0, 5, 9, 13, 17}', () => {
    const lm = openHand();
    // Set distinct z values on the palm landmarks; non-palm landmarks have
    // z=0 in the fixture and must NOT influence the mean.
    lm[0] = { ...lm[0]!, z: -0.05 };
    lm[5] = { ...lm[5]!, z: -0.03 };
    lm[9] = { ...lm[9]!, z: -0.01 };
    lm[13] = { ...lm[13]!, z: 0.01 };
    lm[17] = { ...lm[17]!, z: 0.03 };
    const d = computePalmDepth(lm);
    expect(d).toBeCloseTo((-0.05 + -0.03 + -0.01 + 0.01 + 0.03) / 5, 6);
  });

  it('returns 0 for empty input', () => {
    expect(computePalmDepth([])).toBe(0);
  });
});

describe('computePalmRoll', () => {
  it('returns ~0 for a horizontal palm (index_MCP and pinky_MCP at same y)', () => {
    const lm = openHand();
    // openHand has lm[5].y == lm[17].y == 0.6 → horizontal pinky-index span.
    expect(Math.abs(computePalmRoll(lm))).toBeLessThan(1e-6);
  });

  it('returns ~π/2 for a vertical palm (pinky_MCP above index_MCP in image space)', () => {
    // Construct a palm where pinky_MCP is directly above index_MCP — i.e.
    // pinky.x == index.x but pinky.y < index.y. atan2(dy, 0) = -π/2; after
    // wrapping to [-π/2, π/2] this stays ~π/2 in magnitude.
    const lm = openHand();
    lm[5] = { x: 0.5, y: 0.7, z: 0 };
    lm[17] = { x: 0.5, y: 0.3, z: 0 };
    expect(Math.abs(computePalmRoll(lm))).toBeCloseTo(Math.PI / 2, 5);
  });

  it('returns near 0 for a rotated-by-π palm (wraps into [-π/2, π/2])', () => {
    const lm = openHand();
    // Mirror the index/pinky horizontal positions — atan2 yields π, wrapped
    // to ~0.
    lm[5] = { x: 0.66, y: 0.6, z: 0 };
    lm[17] = { x: 0.42, y: 0.6, z: 0 };
    expect(Math.abs(computePalmRoll(lm))).toBeLessThan(1e-6);
  });
});

describe('computePalmPitch', () => {
  it('returns ~0 when wrist and middle_MCP have the same z', () => {
    const lm = openHand();
    // Both at z=0 in the fixture.
    expect(Math.abs(computePalmPitch(lm))).toBeLessThan(1e-6);
  });

  it('returns positive when middle_MCP is farther from camera than wrist', () => {
    const lm = openHand();
    // Push middle_MCP +z (farther in MediaPipe convention).
    lm[9] = { ...lm[9]!, z: 0.05 };
    expect(computePalmPitch(lm)).toBeGreaterThan(0);
  });

  it('returns negative when middle_MCP is closer to camera than wrist', () => {
    const lm = openHand();
    lm[9] = { ...lm[9]!, z: -0.05 };
    expect(computePalmPitch(lm)).toBeLessThan(0);
  });
});

describe('buildGestureState 3D fields', () => {
  it('populates meanDepth, rightRoll, leftRoll, handsDistance3D, meanPitch', () => {
    const right = handFromLandmarks('right', openHand());
    const left = handFromLandmarks('left', translate(openHand(), -0.3, 0));
    const s = buildGestureState([right, left], 0.016, null);

    // With both hands at z=0 (default fixture), depth normalizes to 0.5
    // (mid of the [-DEPTH_RANGE, +DEPTH_RANGE] band).
    expect(s.meanDepth).toBeCloseTo(0.5, 5);

    // Horizontal palms → roll ~0 → normalized 0.
    expect(Math.abs(s.rightRoll)).toBeLessThan(1e-3);
    expect(Math.abs(s.leftRoll)).toBeLessThan(1e-3);

    // Wrist & middle MCP both at z=0 → pitch 0.
    expect(Math.abs(s.meanPitch)).toBeLessThan(1e-3);

    // 2D distance vs 3D distance: with z=0, they match. Both should be
    // positive since hands sit at distinct x positions in our fixture.
    expect(s.handsDistance3D).toBeGreaterThan(0);
    expect(s.handsDistance3D).toBeCloseTo(s.handsDistance, 5);
  });

  it('handsDistance3D is 0 when only one hand is present', () => {
    const right = handFromLandmarks('right', openHand());
    const s = buildGestureState([right], 0.016, null);
    expect(s.handsDistance3D).toBe(0);
  });

  it('meanDepth shifts toward 1 when palm landmarks have negative Z (closer)', () => {
    const lm = openHand();
    for (const i of [0, 5, 9, 13, 17]) {
      lm[i] = { ...lm[i]!, z: -0.08 };
    }
    const right = handFromLandmarks('right', lm);
    const s = buildGestureState([right], 0.016, null);
    expect(s.meanDepth).toBeGreaterThan(0.7);
  });
});
