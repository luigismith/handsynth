// Owner: hand-tracker (sibling module under src/face/)
//
// Unit tests for FaceTrackerImpl. The MediaPipe runtime is heavy, so these
// tests exercise the public API plus `deriveStateFromResult` (a public escape
// hatch that lets us drive the state-derivation pipeline with a synthetic
// FaceLandmarkerResult — no model load required).

import { describe, it, expect, vi } from 'vitest';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type {
  FaceState,
  FaceTrackerEvents,
} from '@contracts/contracts';
import { FaceTrackerImpl } from './FaceTracker';
import {
  LM_BROW_CENTRE,
  LM_CHIN_BOTTOM,
  LM_FOREHEAD_TOP,
  LM_LEFT_TRAGUS,
  LM_LOWER_INNER_LIP,
  LM_RIGHT_TRAGUS,
  LM_UPPER_EYELID,
  LM_UPPER_INNER_LIP,
} from './face-gestures';

const NUM_LANDMARKS = 478;

function makeRawLandmarks(
  overrides: Partial<Record<number, { x: number; y: number; z: number }>> = {},
): { x: number; y: number; z: number; visibility: number }[] {
  const out = new Array(NUM_LANDMARKS);
  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    out[i] = { x: 0, y: 0, z: 0, visibility: 1 };
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v) out[Number(k)] = { ...v, visibility: 1 };
  }
  return out;
}

function neutralResult(over: {
  matrix?: number[];
  blendshapes?: { name: string; score: number }[];
  faceCenterX?: number;
  apparentWidth?: number;
} = {}): FaceLandmarkerResult {
  // Neutral landmarks (forehead at top, chin at bottom, tragi at horizontal
  // tragi line). x = faceCenterX (default 0.5).
  const cx = over.faceCenterX ?? 0.5;
  const halfWidth = (over.apparentWidth ?? 0.2) / 2;

  const lms = makeRawLandmarks({
    [LM_FOREHEAD_TOP]: { x: cx, y: 0.2, z: 0 },
    [LM_CHIN_BOTTOM]: { x: cx, y: 0.8, z: 0 },
    [LM_LEFT_TRAGUS]: { x: cx - halfWidth, y: 0.5, z: 0 },
    [LM_RIGHT_TRAGUS]: { x: cx + halfWidth, y: 0.5, z: 0 },
    [LM_UPPER_INNER_LIP]: { x: cx, y: 0.66, z: 0 },
    [LM_LOWER_INNER_LIP]: { x: cx, y: 0.665, z: 0 },
    [LM_BROW_CENTRE]: { x: cx, y: 0.43, z: 0 },
    [LM_UPPER_EYELID]: { x: cx, y: 0.45, z: 0 },
  });

  // Identity matrix by default (no rotation).
  // prettier-ignore
  const id = over.matrix ?? [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];

  const blend = over.blendshapes
    ? [
        {
          categories: over.blendshapes.map((b, i) => ({
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

  return {
    faceLandmarks: [lms],
    faceBlendshapes: blend,
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: id }],
  } as FaceLandmarkerResult;
}

function emptyResult(): FaceLandmarkerResult {
  return {
    faceLandmarks: [],
    faceBlendshapes: [],
    facialTransformationMatrixes: [],
  } as FaceLandmarkerResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FaceTrackerImpl.deriveStateFromResult', () => {
  it('flags detected=false for an empty result and accumulates noFaceDuration', () => {
    const t = new FaceTrackerImpl();
    const a = t.deriveStateFromResult(emptyResult(), 1000, 0.05);
    expect(a.detected).toBe(false);
    expect(a.noFaceDuration).toBeCloseTo(0.05, 5);

    const b = t.deriveStateFromResult(emptyResult(), 1100, 0.1);
    expect(b.detected).toBe(false);
    expect(b.noFaceDuration).toBeCloseTo(0.15, 5);
  });

  it('mirrors face center x to selfie space (1 - x)', () => {
    const t = new FaceTrackerImpl();
    // Place face at un-mirrored x = 0.3 (camera POV: left side of frame).
    const result = neutralResult({ faceCenterX: 0.3 });
    const s = t.deriveStateFromResult(result, 1000, 0.016);
    expect(s.detected).toBe(true);
    // Selfie-mirrored x => 0.7.
    expect(s.center.x).toBeCloseTo(0.7, 2);
    expect(s.center.y).toBeCloseTo(0.5, 2);
  });

  it('apparentSize approaches 1 for a "close" face (raw width 0.30)', () => {
    const t = new FaceTrackerImpl();
    // Drive a short series so the One-Euro filter settles.
    let s: FaceState | null = null;
    for (let i = 0; i < 12; i += 1) {
      s = t.deriveStateFromResult(
        neutralResult({ apparentWidth: 0.3 }),
        1000 + i * 16,
        0.016,
      );
    }
    expect(s).not.toBeNull();
    expect(s!.apparentSize).toBeGreaterThan(0.85);
  });

  it('apparentSize approaches 0 for a "far" face (raw width 0.10)', () => {
    const t = new FaceTrackerImpl();
    let s: FaceState | null = null;
    for (let i = 0; i < 12; i += 1) {
      s = t.deriveStateFromResult(
        neutralResult({ apparentWidth: 0.1 }),
        1000 + i * 16,
        0.016,
      );
    }
    expect(s!.apparentSize).toBeLessThan(0.15);
  });

  it('prefers the jawOpen blendshape over geometric mouth opening', () => {
    const t = new FaceTrackerImpl();
    // Geometric mouth would be ~0 (relaxed lips). Blendshape says 0.95.
    let s: FaceState | null = null;
    for (let i = 0; i < 8; i += 1) {
      s = t.deriveStateFromResult(
        neutralResult({ blendshapes: [{ name: 'jawOpen', score: 0.95 }] }),
        1000 + i * 16,
        0.016,
      );
    }
    expect(s!.mouthOpen).toBeGreaterThan(0.5);
  });

  it('negates yaw and roll (selfie convention)', () => {
    const t = new FaceTrackerImpl();
    // Build a Ry(0.5) rotation matrix → un-mirrored yaw = +0.5.
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    // prettier-ignore
    const ry = [
       c, 0, s, 0,
       0, 1, 0, 0,
      -s, 0, c, 0,
       0, 0, 0, 1,
    ];
    let last: FaceState | null = null;
    for (let i = 0; i < 8; i += 1) {
      last = t.deriveStateFromResult(
        neutralResult({ matrix: ry }),
        1000 + i * 16,
        0.016,
      );
    }
    // After mirror, yaw should be approximately -0.5 (some smoothing lag).
    expect(last!.pose.yaw).toBeLessThan(0);
    expect(last!.pose.yaw).toBeGreaterThan(-0.6);
  });
});

describe('FaceTrackerImpl event surface', () => {
  it('on/off attaches and detaches listeners', () => {
    const t = new FaceTrackerImpl();
    const cb: FaceTrackerEvents['face:update'] = vi.fn();
    t.on('face:update', cb);
    t.off('face:update', cb);
    // Stop is safe before any start.
    t.stop();
    expect(cb).not.toHaveBeenCalled();
  });

  it('start() before init() emits an error and does not throw', () => {
    const t = new FaceTrackerImpl();
    const err = vi.fn();
    t.on('error', err);
    t.start();
    expect(err).toHaveBeenCalledTimes(1);
    const arg = err.mock.calls[0]![0]! as Error;
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toMatch(/before init/);
  });

  it('stop() is idempotent and resets internal accumulators', () => {
    const t = new FaceTrackerImpl();
    // Drive a not-detected derivation so noFaceDuration grows, then stop().
    t.deriveStateFromResult(emptyResult(), 1000, 0.5);
    const before = t.deriveStateFromResult(emptyResult(), 1100, 0.5);
    expect(before.noFaceDuration).toBeCloseTo(1.0, 5);

    t.stop();
    t.stop(); // idempotent
    const after = t.deriveStateFromResult(emptyResult(), 1200, 0.1);
    expect(after.noFaceDuration).toBeCloseTo(0.1, 5);
  });
});
