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
//   - Timed flow (fake timers drive rAF + performance.now): sample commit,
//     no-data retry, countdown reset on Skip, face-less mouth step
//   - Tutorial hand-shape predicates ignore a hand that is not in view

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CalibrationPanelImpl } from './CalibrationPanel';
import { __resetForTests } from '../i18n';
import {
  CALIBRATION_STEPS,
  type SampleStep,
  type TutorialStep,
} from './steps';
import type { CalibrationProfile } from './types';
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

function stepIndex(id: string): number {
  const i = CALIBRATION_STEPS.findIndex((s) => s.id === id);
  if (i < 0) throw new Error(`no step ${id}`);
  return i;
}

function tutorialStep(id: string): TutorialStep {
  const s = CALIBRATION_STEPS[stepIndex(id)]!;
  if (s.kind !== 'tutorial') throw new Error(`${id} is not a tutorial step`);
  return s;
}

describe('tutorial hand-shape predicates', () => {
  const base = {
    meanHeight: 0.5,
    meanDepth: 0.5,
    handsDistance3D: 0,
    bothFists: false,
    mouthOpen: 0,
  };

  it('a missing hand (openness defaults to 0) does not count as a fist', () => {
    const fist = tutorialStep('fist').predicate;
    // Right hand open, left hand out of frame.
    expect(
      fist({ ...base, rightOpenness: 0.9, leftOpenness: 0, rightPresent: true, leftPresent: false }),
    ).toBe(false);
    // No hands at all.
    expect(
      fist({ ...base, rightOpenness: 0, leftOpenness: 0, rightPresent: false, leftPresent: false }),
    ).toBe(false);
    // A real fist on a visible hand still passes.
    expect(
      fist({ ...base, rightOpenness: 0.1, leftOpenness: 0, rightPresent: true, leftPresent: false }),
    ).toBe(true);
  });

  it('open-hand step requires the open hand to be in view', () => {
    const open = tutorialStep('open').predicate;
    expect(
      open({ ...base, rightOpenness: 0.9, leftOpenness: 0, rightPresent: true, leftPresent: false }),
    ).toBe(true);
    expect(
      open({ ...base, rightOpenness: 0.9, leftOpenness: 0, rightPresent: false, leftPresent: false }),
    ).toBe(false);
  });
});

describe('CalibrationPanelImpl timed flow', () => {
  let parent: HTMLDivElement;
  let hands: ReturnType<typeof makeHandTrackerStub>;
  let face: ReturnType<typeof makeFaceTrackerStub>;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    parent = document.createElement('div');
    document.body.appendChild(parent);
    localStorage.clear();
    __resetForTests('en');
    hands = makeHandTrackerStub();
    face = makeFaceTrackerStub();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });

  const skipBtn = (): HTMLButtonElement =>
    parent.querySelector('.hs-calib-btn-secondary') as HTMLButtonElement;
  const title = (): string | null | undefined =>
    parent.querySelector('.hs-calib-title')?.textContent;

  it('commits the observed min/max when a sample step runs to completion', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    const step = CALIBRATION_STEPS[stepIndex('position')] as SampleStep;
    vi.advanceTimersByTime(step.prepMs + 50); // PREP → RUN
    for (let i = 0; i < 12; i += 1) {
      hands.emitGesture(makeGesture({ meanDepth: 0.3 + (0.4 * i) / 11 }));
    }
    vi.advanceTimersByTime(step.durationMs + 50); // RUN → DONE (commit)
    expect(parent.querySelector('.hs-calib-status')?.textContent).toBe('Captured ✓');
    (parent.querySelector('.hs-calib-quit') as HTMLButtonElement).click();
    const profile = onComplete.mock.calls[0]![0] as CalibrationProfile;
    expect(profile.meanDepth.min).toBeCloseTo(0.3);
    expect(profile.meanDepth.max).toBeCloseTo(0.7);
    panel.unmount();
  });

  it('a sample step with no data says so, retries once, then moves on', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    const step = CALIBRATION_STEPS[stepIndex('position')] as SampleStep;
    const firstTitle = title();
    const status = (): string | null | undefined =>
      parent.querySelector('.hs-calib-status')?.textContent;

    // No hands in view for the whole run.
    vi.advanceTimersByTime(step.prepMs + step.durationMs + 50);
    expect(status()).toMatch(/No movement detected/);
    expect(status()).not.toBe('Captured ✓');
    vi.advanceTimersByTime(2000); // flash over → same step again
    expect(title()).toBe(firstTitle);

    vi.advanceTimersByTime(step.prepMs + step.durationMs + 50);
    expect(status()).toMatch(/keeping the default/);
    vi.advanceTimersByTime(2000); // second failure → next step
    expect(title()).not.toBe(firstTitle);
    panel.unmount();
  });

  it('Skip during a sample countdown does not leave the digit on a tutorial step', () => {
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete: vi.fn() });
    const lastSample = stepIndex('pitch_high') - 1;
    for (let i = 0; i < lastSample; i += 1) skipBtn().click();
    vi.advanceTimersByTime(100);
    const prep = parent.querySelector('.hs-calib-prep') as HTMLElement;
    expect(prep.hidden).toBe(false); // countdown showing on the last sample step
    skipBtn().click(); // → first tutorial step
    vi.advanceTimersByTime(100);
    expect(prep.hidden).toBe(true);
    panel.unmount();
  });

  it('the mouth step auto-skips when no face is being tracked', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, onComplete }); // no FaceTracker at all
    const mouth = stepIndex('mouth');
    for (let i = 0; i < mouth; i += 1) skipBtn().click();
    vi.advanceTimersByTime(tutorialStep('mouth').timeoutHintMs + 100);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![1]).toBe(false);
    panel.unmount();
  });

  it('the mouth step keeps waiting while a face is in view', () => {
    const onComplete = vi.fn();
    const panel = new CalibrationPanelImpl();
    panel.mount(parent, { hands, face, onComplete });
    const mouth = stepIndex('mouth');
    for (let i = 0; i < mouth; i += 1) skipBtn().click();
    const faceState = { detected: true, mouthOpen: 0.1 } as unknown as FaceState;
    for (let ms = 0; ms < tutorialStep('mouth').timeoutHintMs + 2000; ms += 200) {
      face.emitFace(faceState);
      vi.advanceTimersByTime(200);
    }
    expect(onComplete).not.toHaveBeenCalled();
    panel.unmount();
  });
});
