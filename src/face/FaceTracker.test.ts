// Owner: hand-tracker (sibling module under src/face/)
//
// Unit tests for FaceTrackerImpl. Two layers:
//
//   1. `deriveStateFromResult` — the public escape hatch that lets us drive
//      the state-derivation pipeline with a synthetic FaceLandmarkerResult.
//      No worker, no MediaPipe, no model. Verifies mirror, smoothing,
//      blendshape preference, gimbal-lock-friendly Euler extraction.
//
//   2. Worker integration — verifies init/start/stop talk to the (mocked)
//      face-worker via the expected message protocol and that on `start()`
//      we capture an ImageBitmap and ship it across via postMessage with a
//      transfer list.
//
// The worker import (`./face-worker.ts?worker`) is mocked with a stub class
// that captures postMessages and exposes a `_simulateMessage` method for
// driving the worker → main side of the protocol from tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceState, FaceTrackerEvents } from '@contracts/contracts';
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

// ---------------------------------------------------------------------------
// Mock for the `?worker` import. vi.mock is hoisted to the top of the file
// so the factory cannot close over module-level variables. We declare the
// stub class via vi.hoisted() so it's available both inside the mock factory
// and in the test bodies below (via `mocks.StubFaceWorker`).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  type Listener = (ev: MessageEvent<unknown>) => void;

  class StubFaceWorker {
    // Note: cannot reference vi inside hoisted callback for typing helpers
    // until vitest is loaded. Use plain functions and assign vi.fn lazily —
    // but since this whole hoisted block runs at the top of the module, vi
    // IS available. So we can use it directly.
    postMessage = vi.fn();
    terminate = vi.fn();
    listeners = new Map<string, Set<Listener>>();
    /** Captured here so tests can inspect them (msg + transferred items). */
    posted: Array<{ msg: unknown; transfer: Transferable[] | undefined }> = [];

    constructor() {
      this.postMessage.mockImplementation(
        (msg: unknown, transfer?: Transferable[]) => {
          this.posted.push({ msg, transfer });
          const m = msg as { type?: string };
          if (m && m.type === 'init') {
            queueMicrotask(() =>
              this._simulateMessage({ type: 'ready' }),
            );
          }
        },
      );
      mocks.StubFaceWorker.last = this;
    }

    addEventListener(evt: string, cb: Listener): void {
      let set = this.listeners.get(evt);
      if (!set) {
        set = new Set();
        this.listeners.set(evt, set);
      }
      set.add(cb);
    }

    removeEventListener(evt: string, cb: Listener): void {
      this.listeners.get(evt)?.delete(cb);
    }

    /** Drive a worker→main message into all 'message' listeners. */
    _simulateMessage(data: unknown): void {
      const ev = { data } as MessageEvent<unknown>;
      const set = this.listeners.get('message');
      if (!set) return;
      for (const cb of set) cb(ev);
    }

    static last: StubFaceWorker | null = null;
  }

  return { StubFaceWorker };
});

vi.mock('./face-worker.ts?worker', () => ({
  default: mocks.StubFaceWorker,
}));

// Also stub `createImageBitmap` (happy-dom doesn't implement it). We return a
// minimal object that satisfies the `Transferable` slot.
const fakeBitmap = (): ImageBitmap =>
  ({
    width: 320,
    height: 240,
    close: vi.fn(),
  }) as unknown as ImageBitmap;

beforeEach(() => {
  mocks.StubFaceWorker.last = null;
  // happy-dom doesn't ship createImageBitmap. Provide one for any test that
  // exercises the start() path; tests that don't call start() won't trigger
  // it.
  (globalThis as unknown as { createImageBitmap: () => Promise<ImageBitmap> }).createImageBitmap =
    vi.fn().mockResolvedValue(fakeBitmap());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Imported AFTER the vi.mock declaration so the worker import resolves to the
// stub. (vi.mock is hoisted by vitest, but keep the import below the mock
// for clarity.)
import { FaceTrackerImpl } from './FaceTracker';

// ---------------------------------------------------------------------------
// Synthetic FaceLandmarkerResult builder (unchanged from the legacy tests).
// ---------------------------------------------------------------------------

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
// Helpers for the worker-integration tests
// ---------------------------------------------------------------------------

function makeFakeVideo(): HTMLVideoElement {
  // happy-dom gives us a real <video>; augment with the rVFC API + readyState.
  const v = document.createElement('video');
  Object.defineProperty(v, 'readyState', { get: () => 4 });
  Object.defineProperty(v, 'paused', { get: () => false });
  Object.defineProperty(v, 'ended', { get: () => false });
  // Force the rAF fallback so we can drive frames manually with vi.useFakeTimers.
  // (We don't actually need rVFC to fire — the test calls dispatchFrame
  // indirectly via start() then awaits a microtask.)
  return v;
}

// ---------------------------------------------------------------------------
// Tests — derivation pipeline (unchanged)
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
    const result = neutralResult({ faceCenterX: 0.3 });
    const s = t.deriveStateFromResult(result, 1000, 0.016);
    expect(s.detected).toBe(true);
    expect(s.center.x).toBeCloseTo(0.7, 2);
    expect(s.center.y).toBeCloseTo(0.5, 2);
  });

  it('apparentSize approaches 1 for a "close" face (raw width 0.30)', () => {
    const t = new FaceTrackerImpl();
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
    expect(last!.pose.yaw).toBeLessThan(0);
    expect(last!.pose.yaw).toBeGreaterThan(-0.6);
  });
});

// ---------------------------------------------------------------------------
// Tests — public event surface
// ---------------------------------------------------------------------------

describe('FaceTrackerImpl event surface', () => {
  it('on/off attaches and detaches listeners', () => {
    const t = new FaceTrackerImpl();
    const cb: FaceTrackerEvents['face:update'] = vi.fn();
    t.on('face:update', cb);
    t.off('face:update', cb);
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
    t.deriveStateFromResult(emptyResult(), 1000, 0.5);
    const before = t.deriveStateFromResult(emptyResult(), 1100, 0.5);
    expect(before.noFaceDuration).toBeCloseTo(1.0, 5);

    t.stop();
    t.stop(); // idempotent
    const after = t.deriveStateFromResult(emptyResult(), 1200, 0.1);
    expect(after.noFaceDuration).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests — worker wiring
// ---------------------------------------------------------------------------

describe('FaceTrackerImpl worker integration', () => {
  it('init() constructs a worker and posts an init message, awaits ready', async () => {
    const t = new FaceTrackerImpl();
    const v = makeFakeVideo();
    await t.init(v);

    const stub = mocks.StubFaceWorker.last!;
    expect(stub).not.toBeNull();
    // The init message was sent.
    expect(stub.postMessage).toHaveBeenCalled();
    const first = stub.postMessage.mock.calls[0]![0] as { type: string };
    expect(first.type).toBe('init');
    t.stop();
  });

  it('start() captures an ImageBitmap via createImageBitmap and posts it to the worker with a transfer list', async () => {
    const t = new FaceTrackerImpl();
    const v = makeFakeVideo();
    await t.init(v);

    const stub = mocks.StubFaceWorker.last!;
    // Reset captured calls; we only care about post-init traffic.
    stub.postMessage.mockClear();
    stub.posted.length = 0;
    // Re-install the default behaviour without the auto-ready (init is done).
    stub.postMessage.mockImplementation((msg, transfer) => {
      stub.posted.push({ msg, transfer });
    });

    // Spy on the global so we can assert it was called by dispatchFrame().
    const cibSpy = globalThis.createImageBitmap as ReturnType<typeof vi.fn>;
    cibSpy.mockClear();

    t.start();

    // Drive one rAF tick — happy-dom doesn't auto-fire rVFC, so the tracker
    // falls back to requestAnimationFrame. Wait two macrotasks: one for rAF
    // to fire, one for the createImageBitmap promise to settle.
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(cibSpy).toHaveBeenCalled();
    // At least one frame message was posted with a transfer list containing
    // exactly one Transferable (the ImageBitmap).
    const frameCall = stub.posted.find((p) => {
      const m = p.msg as { type?: string };
      return m && m.type === 'frame';
    });
    expect(frameCall).toBeDefined();
    expect(frameCall!.transfer).toBeDefined();
    expect(frameCall!.transfer!.length).toBe(1);

    t.stop();
  });

  it('stop() terminates the worker and clears state', async () => {
    const t = new FaceTrackerImpl();
    const v = makeFakeVideo();
    await t.init(v);
    const stub = mocks.StubFaceWorker.last!;
    t.stop();
    expect(stub.terminate).toHaveBeenCalled();
  });
});
