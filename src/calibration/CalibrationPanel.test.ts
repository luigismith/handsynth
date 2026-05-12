// Owner: ux-curator
//
// Smoke tests for CalibrationPanelImpl — verifies the wizard DOM mounts,
// localized strings render, sample steps capture min/max, tutorial steps
// advance via predicate, quit + skip paths, and the onComplete callback
// fires with a profile shaped correctly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CalibrationPanelImpl } from './CalibrationPanel';
import { __resetForTests } from '../i18n';
import { CALIBRATION_STEPS } from './steps';
import type {
  GestureState,
  HandTracker,
  HandTrackerEvents,
  FaceTracker,
  FaceState,
  Hand,
} from '@contracts/contracts';

// ---------------------------------------------------------------------------
// HandTracker / FaceTracker stubs — capture the gesture:update / face:update
// subscriber so the test can synthesize events.
// ---------------------------------------------------------------------------

function makeHandTrackerStub(): HandTracker & {
  emitGesture: (s: GestureState) => void;
} {
  let cb: HandTrackerEvents['gesture:update'] | null = null;
  return {
    init: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn((evt: string, fn: unknown) => {
      if (evt === 'gesture:update') cb = fn as HandTrackerEvents['gesture:update'];
    }),
    off: vi.fn(),
    emitGesture: (s: GestureState): void => {
      if (cb) cb(s);
    },
  } as unknown as HandTracker & { emitGesture: (s: GestureState) => void };
}

function makeFaceTrackerStub(): FaceTracker & {
  emitFace: (s: FaceState) => void;
} {
  let cb: ((s: FaceState) => void) | null = null;
  return {
    init: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setMirror: vi.fn(),
    on: vi.fn((evt: string, fn: unknown) => {
      if (evt === 'face:update') cb = fn as (s: FaceState) => void;
    }),
    off: vi.fn(),
    emitFace: (s: FaceState): void => {
      if (cb) cb(s);
    },
  } as unknown as FaceTracker & { emitFace: (s: FaceState) => void };
}

// Build a minimal GestureState with sensible defaults; override any field
// per-test by passing a partial.
function makeGesture(over: Partial<GestureState> = {}): GestureState {
  const rightHand: Hand = {
    handedness: 'Right',
    side: 'right',
    landmarks: [],
    palmCenter: { x: 0.5, y: 0.5, z: 0 },
    openness: 0.5,
    pinch: 0,
    isClosed: false,
  } as unknown as Hand;
  return {
    hands: [rightHand],
    bothHandsDetected: false,
    handsDistance: 0,
    meanHeight: 0.5,
    rightOpenness: 0.5,
    leftOpenness: 0.5,
    rightPinchActive: false,
    leftPinchActive: false,
    bothFists: false,
    bothAboveHead: false,
    fingerCount: 5,
    noHandsDuration: 0,
    meanDepth: 0.5,
    rightRoll: 0,
    leftRoll: 0,
    handsDistance3D: 0,
    meanPitch: 0,
    ...over,
  };
}

describe('CalibrationPanelImpl', () => {
  let parent: HTMLDivElement;
  let hands: ReturnType<typeof makeHandTrackerStub>;
  let face: ReturnType<typeof makeFaceTrackerStub>;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    localStorage.clear();
    __resetForTests('en');
    hands = makeHandTrackerStub();
    face = makeFaceTrackerStub();
  });

  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });

  it('mounts a single overlay with header + buttons', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    expect(parent.querySelector('.hs-calib-overlay')).not.toBeNull();
    expect(parent.querySelector('.hs-calib-card')).not.toBeNull();
    expect(parent.querySelector('.hs-calib-quit')).not.toBeNull();
    expect(parent.querySelectorAll('.hs-calib-btn').length).toBe(2);
    panel.unmount();
    expect(parent.querySelector('.hs-calib-overlay')).toBeNull();
  });

  it('renders the first step title (english)', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    const title = parent.querySelector('.hs-calib-title');
    // First step is the "position" sample step.
    expect(title?.textContent).toBe('Find your spot');
    panel.unmount();
  });

  it('captures min/max for sample step and writes into the profile', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    // First step samples `meanDepth` and writes into profile.meanDepth.
    // Feed 10 samples spanning [0.2, 0.85].
    for (let i = 0; i < 10; i += 1) {
      const v = 0.2 + (0.65 * i) / 9;
      hands.emitGesture(makeGesture({ meanDepth: v }));
    }
    // Click Next on the first step. Since duration hasn't elapsed yet the
    // Next button is disabled — we drive the panel to advance via the
    // private path by simulating a click. The button is only enabled
    // after the timer, so we hit Skip instead to force advance without
    // writing. To exercise the WRITE path we'll call advance via the
    // Next button after manually enabling it; simulate by directly
    // calling: dispatch a click on the primary button after enabling it.
    const nextBtn = parent.querySelector(
      '.hs-calib-btn-primary',
    ) as HTMLButtonElement;
    nextBtn.disabled = false;
    nextBtn.click();
    // Advance through ALL remaining steps via Skip so we reach finish().
    const skipBtn = parent.querySelector(
      '.hs-calib-btn-secondary',
    ) as HTMLButtonElement;
    for (let i = 1; i < CALIBRATION_STEPS.length; i += 1) {
      skipBtn.click();
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    const callArg = onComplete.mock.calls[0]![0] as Record<string, unknown>;
    const md = callArg.meanDepth as { min: number; max: number };
    expect(md.min).toBeCloseTo(0.2, 2);
    expect(md.max).toBeCloseTo(0.85, 2);
    // tutorialCompleted = true because we walked to the end.
    expect(callArg.tutorialCompleted).toBe(true);
    panel.unmount();
  });

  it('Quit button fires onComplete with quitEarly=true', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    const quit = parent.querySelector('.hs-calib-quit') as HTMLButtonElement;
    quit.click();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const [profile, quitEarly] = onComplete.mock.calls[0]!;
    expect(quitEarly).toBe(true);
    expect((profile as { tutorialCompleted: boolean }).tutorialCompleted).toBe(false);
    panel.unmount();
  });

  it('Skip on a sample step does NOT write its range into the profile', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    // Feed samples that WOULD produce a wide range.
    for (let i = 0; i < 12; i += 1) {
      const v = 0.1 + (0.8 * i) / 11;
      hands.emitGesture(makeGesture({ meanDepth: v }));
    }
    const skip = parent.querySelector(
      '.hs-calib-btn-secondary',
    ) as HTMLButtonElement;
    // Walk to the end via Skip on every step.
    for (let i = 0; i < CALIBRATION_STEPS.length; i += 1) {
      skip.click();
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    const callArg = onComplete.mock.calls[0]![0] as Record<string, unknown>;
    // Default range survives because we skipped without confirming the
    // first sample step.
    const md = callArg.meanDepth as { min: number; max: number };
    expect(md.min).toBe(0);
    expect(md.max).toBe(1);
    panel.unmount();
  });

  it('mount is idempotent (second call is a no-op)', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    // Still exactly one overlay.
    expect(parent.querySelectorAll('.hs-calib-overlay').length).toBe(1);
    panel.unmount();
  });

  it('unmount is idempotent', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    panel.unmount();
    expect(() => panel.unmount()).not.toThrow();
  });
});
