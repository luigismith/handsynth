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
  drawFaceSkeleton,
  drawFakeArms,
  drawHandHalo,
  FACE_LEFT_EYE,
  FACE_LEFT_BROW,
  FACE_LIPS_INNER,
  FACE_LIPS_OUTER,
  FACE_NOSE_BRIDGE,
  FACE_OVAL,
  FACE_RIGHT_EYE,
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
  width: number;
  height: number;
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
  circle(x: number, y: number, d: number): void;
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
    width: 1280,
    height: 720,
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
    circle: rec('circle') as unknown as P5Stub['circle'],
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
    smile: 0,
    frown: 0,
    surprise: 0,
    anger: 0,
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

  it('draws the face oval as TWO passes (outer glow + crisp inner stroke)', () => {
    // Cosmetic polish: the oval gets a wider, low-alpha glow stroke
    // behind the crisp 1.4-weight inner stroke. Other lines stay
    // single-weight to keep the composition from getting mushy. We
    // count the number of strokeWeight() values > 2.0 — those are the
    // glow strokes (currently 2.1).
    const s = createStub();
    drawFaceSkeleton(
      s as unknown as Parameters<typeof drawFaceSkeleton>[0],
      makeFace(),
      1280,
      720,
      0,
    );
    const wideStrokes = s.calls.filter(
      (c) => c.fn === 'strokeWeight' && typeof c.args[0] === 'number' && (c.args[0] as number) > 2,
    );
    // At least one wide-stroke pass exists (the oval glow). The lip
    // stroke at mouthOpen=0 stays under 2.0, so this isolates the
    // oval glow specifically.
    expect(wideStrokes.length).toBeGreaterThanOrEqual(1);
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

// Removed: drawEyeLasers tests (5 cases) — the Superman laser-eyes feature
// was deleted per user request. The FaceState.eyesWide scalar still exists
// in the contract but no consumer uses it.

describe('drawHandHalo', () => {
  it('emits a paired R/B circle per fingertip (5 tips × 2 = 10 circles)', () => {
    const s = createStub();
    drawHandHalo(s as unknown as Parameters<typeof drawHandHalo>[0], makeHand('right'));
    const circs = s.calls.filter((c) => c.fn === 'circle').length;
    // FINGERTIP_INDICES has 5 entries; each emits 2 circles (red-shift
    // + blue-shift). 5 × 2 = 10.
    expect(circs).toBe(10);
  });

  it('uses both warm and cool stroke hues (R/B chromatic split)', () => {
    const s = createStub();
    drawHandHalo(s as unknown as Parameters<typeof drawHandHalo>[0], makeHand('left'));
    const strokeHues = new Set<number>();
    for (const c of s.calls) {
      if (c.fn !== 'stroke') continue;
      const h = c.args[0];
      if (typeof h === 'number') strokeHues.add(h);
    }
    // We expect at least 2 distinct hues — one in the warm (red) family
    // and one in the cool (blue) family.
    expect(strokeHues.size).toBeGreaterThanOrEqual(2);
  });
});
