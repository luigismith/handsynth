// Owner: ux-curator
//
// Smoke tests for CalibrationPanelImpl after the hands-free redesign.
// Verifies:
//   - Single overlay mounts with target zones + card + skip button (no Next)
//   - First step renders the localized title + pose icon
//   - Quit fires onComplete(profile, quitEarly=true)
//   - Skip advances without writing data (no min/max captured)
//   - Mount + unmount are idempotent
//
// Auto-advance + RAF-driven progression are integration concerns —
// covered indirectly here by verifying that the panel never EXPOSES a
// Next button. Time-based progression is asserted via the store/types
// unit tests for makeRemap (range collection happens through the same
// channel path either way).

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

describe('CalibrationPanelImpl (hands-free)', () => {
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

  it('mounts a single overlay with card + zones + Skip only (no Next)', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    expect(parent.querySelector('.hs-calib-overlay')).not.toBeNull();
    expect(parent.querySelector('.hs-calib-card')).not.toBeNull();
    expect(parent.querySelector('.hs-calib-quit')).not.toBeNull();
    // Two zone slots (A + B) always exist; A may be visible depending on step.
    expect(parent.querySelectorAll('.hs-calib-zone').length).toBe(2);
    // Exactly ONE critical-path button: Skip. (Auto-advance replaces Next.)
    const btns = parent.querySelectorAll('.hs-calib-btn');
    expect(btns.length).toBe(1);
    expect(btns[0]!.classList.contains('hs-calib-btn-secondary')).toBe(true);
    panel.unmount();
    expect(parent.querySelector('.hs-calib-overlay')).toBeNull();
  });

  it('renders the first step title + pose icon', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    const title = parent.querySelector('.hs-calib-title');
    expect(title?.textContent).toBe('Find your spot');
    // Icon host renders an SVG for non-`none` icons (position step has
    // 'two-hands-frame').
    const iconHost = parent.querySelector('.hs-calib-icon');
    expect(iconHost?.querySelector('svg')).not.toBeNull();
    panel.unmount();
  });

  it('quit button fires onComplete with quitEarly=true', () => {
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

  it('Skip on every step walks to the end without writing data', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    // Feed some samples that WOULD produce a wide range — but we skip
    // before the RUN phase commits, so they should NOT land in the
    // profile.
    for (let i = 0; i < 12; i += 1) {
      hands.emitGesture(makeGesture({ meanDepth: 0.1 + (0.8 * i) / 11 }));
    }
    const skip = parent.querySelector('.hs-calib-btn-secondary') as HTMLButtonElement;
    for (let i = 0; i < CALIBRATION_STEPS.length; i += 1) skip.click();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const callArg = onComplete.mock.calls[0]![0] as Record<string, unknown>;
    const md = callArg.meanDepth as { min: number; max: number };
    // Default range survives because we never let the RUN phase elapse.
    expect(md.min).toBe(0);
    expect(md.max).toBe(1);
    // Completed the wizard so tutorialCompleted = true.
    expect(callArg.tutorialCompleted).toBe(true);
    panel.unmount();
  });

  it('mount is idempotent (second call is a no-op)', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    expect(parent.querySelectorAll('.hs-calib-overlay').length).toBe(1);
    panel.unmount();
  });

  it('unmount is idempotent', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    panel.unmount();
    expect(() => panel.unmount()).not.toThrow();
  });

  it('GET-READY countdown is visible on the first sample step', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    // Force one rAF cycle so tickUi runs and the prep countdown renders.
    // Happy-dom's rAF is synchronous-ish; we trigger by waiting one tick.
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        const prep = parent.querySelector('.hs-calib-prep') as HTMLElement;
        expect(prep).not.toBeNull();
        expect(prep.hidden).toBe(false);
        panel.unmount();
        resolve();
      });
    });
  });
});
