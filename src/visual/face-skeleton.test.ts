// Owner: visualizer
//
// Unit tests for the face-skeleton drawing helpers in sketch.ts. We can't
// run the full p5 sketch under happy-dom (no real canvas), but the
// drawing helpers (drawFaceSkeleton / drawFakeArms) are pure functions
// over a p5-like surface — we can pass a stub recorder and assert which
// shapes/lines were emitted.

import { describe, it, expect } from 'vitest';
import type { FaceState, FaceLandmark, Hand } from '@contracts/contracts';
import {
  drawEyeLasers,
  drawFaceSkeleton,
  drawFakeArms,
  FACE_LEFT_EYE,
  FACE_LEFT_EYE_INNER_CORNER,
  FACE_LEFT_EYE_OUTER_CORNER,
  FACE_LEFT_BROW,
  FACE_LIPS_INNER,
  FACE_LIPS_OUTER,
  FACE_NOSE_BRIDGE,
  FACE_OVAL,
  FACE_RIGHT_EYE,
  FACE_RIGHT_EYE_INNER_CORNER,
  FACE_RIGHT_EYE_OUTER_CORNER,
  FACE_RIGHT_BROW,
} from './sketch';

// ---------------------------------------------------------------------------
// p5 stub: records every call so we can introspect what got drawn.
// ---------------------------------------------------------------------------

interface StubCall {
  fn: string;
  args: unknown[];
}

interface P5Stub {
  calls: StubCall[];
  CLOSE: 'close';
  ADD: 'add';
  BLEND: 'blend';
  push(): void;
  pop(): void;
  translate(x: number, y: number): void;
  rotate(a: number): void;
  noFill(): void;
  fill(...args: unknown[]): void;
  noStroke(): void;
  stroke(...args: unknown[]): void;
  strokeWeight(w: number): void;
  blendMode(mode: unknown): void;
  bezier(...args: number[]): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  beginShape(): void;
  vertex(x: number, y: number): void;
  endShape(mode?: string): void;
}

function createStub(): P5Stub {
  const calls: StubCall[] = [];
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
  };
  return {
    calls,
    CLOSE: 'close' as const,
    ADD: 'add' as const,
    BLEND: 'blend' as const,
    push: rec('push'),
    pop: rec('pop'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    noFill: rec('noFill'),
    fill: rec('fill'),
    noStroke: rec('noStroke'),
    stroke: rec('stroke'),
    strokeWeight: rec('strokeWeight'),
    blendMode: rec('blendMode'),
    bezier: rec('bezier') as unknown as P5Stub['bezier'],
    line: rec('line') as unknown as P5Stub['line'],
    beginShape: rec('beginShape'),
    vertex: rec('vertex') as unknown as P5Stub['vertex'],
    endShape: rec('endShape') as unknown as P5Stub['endShape'],
  };
}

// Build a synthetic 478-point face landmark array. All points at (0.5, 0.5)
// is fine — we only need the array length to be valid.
function makeFaceLandmarks(count = 478): FaceLandmark[] {
  const lms: FaceLandmark[] = [];
  for (let i = 0; i < count; i += 1) {
    // Spread a tiny bit so the chin (152) is distinct from forehead (10),
    // useful for the fake-arms test.
    lms.push({ x: 0.5, y: 0.3 + (i / count) * 0.4, z: 0 });
  }
  return lms;
}

function makeFace(over: Partial<FaceState> = {}): FaceState {
  return {
    detected: true,
    center: { x: 0.5, y: 0.5 },
    apparentSize: 0.4,
    pose: { yaw: 0, pitch: 0, roll: 0, depth: 0 },
    mouthOpen: 0,
    browRaise: 0,
    eyeOpenLeft: 0.5,
    eyeOpenRight: 0.5,
    eyesWide: 0,
    noFaceDuration: 0,
    landmarks: makeFaceLandmarks(),
    ...over,
  };
}

function makeHand(side: 'left' | 'right'): Hand {
  const lms: FaceLandmark[] = [];
  for (let i = 0; i < 21; i += 1) {
    lms.push({ x: side === 'right' ? 0.7 : 0.3, y: 0.6, z: 0 });
  }
  return {
    side,
    landmarks: lms,
    palmCenter: { x: side === 'right' ? 0.7 : 0.3, y: 0.6, z: 0 },
    openness: 0.5,
    pinch: 0.5,
    isClosed: false,
    depth: 0,
    roll: 0,
    pitch: 0,
  };
}

// ---------------------------------------------------------------------------

describe('face landmark index sets', () => {
  it('exports the documented MediaPipe FaceLandmarker indices', () => {
    expect(FACE_OVAL.length).toBe(36);
    expect(FACE_LEFT_EYE.length).toBe(16);
    expect(FACE_RIGHT_EYE.length).toBe(16);
    expect(FACE_LIPS_OUTER.length).toBe(20);
    expect(FACE_LIPS_INNER.length).toBe(20);
    expect(FACE_NOSE_BRIDGE.length).toBe(8);
    expect(FACE_LEFT_BROW.length).toBe(10);
    expect(FACE_RIGHT_BROW.length).toBe(10);
  });

  it('all referenced indices are within the 478-point mesh', () => {
    const all = [
      ...FACE_OVAL,
      ...FACE_LEFT_EYE,
      ...FACE_RIGHT_EYE,
      ...FACE_LIPS_OUTER,
      ...FACE_LIPS_INNER,
      ...FACE_NOSE_BRIDGE,
      ...FACE_LEFT_BROW,
      ...FACE_RIGHT_BROW,
    ];
    for (const i of all) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(478);
    }
  });
});

describe('drawFaceSkeleton', () => {
  it('wraps the face draw in a push/pop pair', () => {
    // PERF: dropped the rotate/translate triplet — applying a non-identity
    // canvas transform on a 2560×1215 buffer in Canvas2D mode forced a
    // CPU-side path that took the visualizer from ~12 fps to <1 fps.
    // Head tilt is still conveyed by the landmark positions themselves.
    const s = createStub();
    drawFaceSkeleton(s as unknown as Parameters<typeof drawFaceSkeleton>[0], makeFace(), 1280, 720, 0);
    const fns = s.calls.map((c) => c.fn);
    expect(fns[0]).toBe('push');
    expect(fns[fns.length - 1]).toBe('pop');
  });

  it('does nothing if landmarks are missing', () => {
    const s = createStub();
    drawFaceSkeleton(
      s as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace({ landmarks: undefined }),
      1280,
      720,
      0,
    );
    expect(s.calls.length).toBe(0);
  });

  it('does nothing for partial landmark arrays (<478 points)', () => {
    const s = createStub();
    drawFaceSkeleton(
      s as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace({ landmarks: makeFaceLandmarks(100) }),
      1280,
      720,
      0,
    );
    expect(s.calls.length).toBe(0);
  });

  it('issues at least one beginShape per closed loop (oval, eyes, lips)', () => {
    const s = createStub();
    drawFaceSkeleton(
      s as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace(),
      1280,
      720,
      0,
    );
    const beginCount = s.calls.filter((c) => c.fn === 'beginShape').length;
    // 5 closed loops (oval, L eye, R eye, lips outer, lips inner) +
    // 3 polylines (nose bridge, L brow, R brow) = 8 shapes minimum.
    expect(beginCount).toBeGreaterThanOrEqual(8);
  });

  it('thickens the lip stroke when mouthOpen > 0.1', () => {
    const closedStub = createStub();
    drawFaceSkeleton(
      closedStub as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace({ mouthOpen: 0 }),
      1280,
      720,
      0,
    );
    const openStub = createStub();
    drawFaceSkeleton(
      openStub as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace({ mouthOpen: 0.6 }),
      1280,
      720,
      0,
    );
    // At mouthOpen=0.6, lip strokeWeight = 1.2 * (1 + 1.2) = 2.64.
    // Find the largest strokeWeight value emitted by each call.
    const maxWeight = (calls: StubCall[]): number => {
      let max = 0;
      for (const c of calls) {
        if (c.fn === 'strokeWeight') {
          const w = c.args[0] as number;
          if (w > max) max = w;
        }
      }
      return max;
    };
    expect(maxWeight(openStub.calls)).toBeGreaterThan(maxWeight(closedStub.calls));
  });
});

describe('drawFakeArms', () => {
  it('emits one bezier set per detected hand (3 bezier strokes per arm)', () => {
    const s = createStub();
    drawFakeArms(
      s as unknown as Parameters<typeof drawFakeArms>[0],
      makeFace(),
      [makeHand('left'), makeHand('right')],
      1280,
      720,
    );
    const beziers = s.calls.filter((c) => c.fn === 'bezier').length;
    // 3 layers (outer, mid, core) * 2 hands = 6 beziers.
    expect(beziers).toBe(6);
  });

  it('does not draw if landmarks are missing', () => {
    const s = createStub();
    drawFakeArms(
      s as unknown as Parameters<typeof drawFakeArms>[0],
      makeFace({ landmarks: undefined }),
      [makeHand('left')],
      1280,
      720,
    );
    expect(s.calls.length).toBe(0);
  });

  it('skips a hand whose wrist landmark is missing', () => {
    const hand = makeHand('right');
    // Force wrist (idx 0) to be undefined-equivalent. Setting to NaN
    // keeps the type but our code checks for !lm; we instead splice it.
    const lms = hand.landmarks.slice();
    // Set the array index 0 to undefined via a partial array.
    const broken: Hand = {
      ...hand,
      landmarks: lms.map((p, i) => (i === 0 ? undefined : p)) as unknown as FaceLandmark[],
    };
    const s = createStub();
    drawFakeArms(
      s as unknown as Parameters<typeof drawFakeArms>[0],
      makeFace(),
      [broken],
      1280,
      720,
    );
    const beziers = s.calls.filter((c) => c.fn === 'bezier').length;
    expect(beziers).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// drawEyeLasers — Superman laser eyes
// ---------------------------------------------------------------------------

/**
 * Build a face fixture with valid eye-corner landmarks at the documented
 * MediaPipe indices. Without these the laser function early-returns even
 * with eyesWide above threshold.
 */
function makeFaceWithEyeCorners(over: Partial<FaceState> = {}): FaceState {
  const lms = makeFaceLandmarks();
  // Place eye corners at distinct pixel positions so the centroids land
  // on different points and the helpers don't collapse to (0,0).
  lms[FACE_LEFT_EYE_OUTER_CORNER] = { x: 0.30, y: 0.45, z: 0 };
  lms[FACE_LEFT_EYE_INNER_CORNER] = { x: 0.40, y: 0.45, z: 0 };
  lms[FACE_RIGHT_EYE_OUTER_CORNER] = { x: 0.70, y: 0.45, z: 0 };
  lms[FACE_RIGHT_EYE_INNER_CORNER] = { x: 0.60, y: 0.45, z: 0 };
  return {
    ...makeFace({ landmarks: lms }),
    ...over,
  };
}

describe('drawEyeLasers', () => {
  it('is a no-op when eyesWide is at or below 0.15', () => {
    const s = createStub();
    drawEyeLasers(
      s as unknown as Parameters<typeof drawEyeLasers>[0],
      makeFaceWithEyeCorners({ eyesWide: 0.15 }),
      1280,
      720,
      0,
    );
    // No stroke / line calls — only a defensive early return.
    expect(s.calls.length).toBe(0);
  });

  it('is a no-op when landmarks are missing', () => {
    const s = createStub();
    drawEyeLasers(
      s as unknown as Parameters<typeof drawEyeLasers>[0],
      makeFace({ landmarks: undefined, eyesWide: 0.9 }),
      1280,
      720,
      0,
    );
    expect(s.calls.length).toBe(0);
  });

  it('emits at least 6 stroke calls (3 layers x 2 eyes) when above threshold', () => {
    const s = createStub();
    drawEyeLasers(
      s as unknown as Parameters<typeof drawEyeLasers>[0],
      makeFaceWithEyeCorners({ eyesWide: 0.8 }),
      1280,
      720,
      0,
    );
    const strokes = s.calls.filter((c) => c.fn === 'stroke').length;
    expect(strokes).toBeGreaterThanOrEqual(6);
  });

  it('wraps the laser draw in a push/pop pair', () => {
    const s = createStub();
    drawEyeLasers(
      s as unknown as Parameters<typeof drawEyeLasers>[0],
      makeFaceWithEyeCorners({ eyesWide: 0.7 }),
      1280,
      720,
      0,
    );
    const pushes = s.calls.filter((c) => c.fn === 'push').length;
    const pops = s.calls.filter((c) => c.fn === 'pop').length;
    expect(pushes).toBeGreaterThanOrEqual(1);
    expect(pops).toBe(pushes);
    // First push and last pop frame the body of the function.
    expect(s.calls[0]?.fn).toBe('push');
    expect(s.calls[s.calls.length - 1]?.fn).toBe('pop');
  });

  it('reduced-motion mode draws a single thin line per eye, no glow stack', () => {
    const s = createStub();
    drawEyeLasers(
      s as unknown as Parameters<typeof drawEyeLasers>[0],
      makeFaceWithEyeCorners({ eyesWide: 0.9 }),
      1280,
      720,
      0,
      null,
      /* reducedMotion */ true,
    );
    // One stroke + one line per eye = 2 strokes, 2 lines.
    const strokes = s.calls.filter((c) => c.fn === 'stroke').length;
    const lines = s.calls.filter((c) => c.fn === 'line').length;
    expect(strokes).toBe(2);
    expect(lines).toBe(2);
  });
});
