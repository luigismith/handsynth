// Owner: ux-curator
//
// Step definitions for the CalibrationPanel wizard.
//
// Two flavors:
//   - "sample" steps: collect min/max of one or more channels over a time
//     window. Used for the calibration half (position, range of motion,
//     hand-shape envelope).
//   - "tutorial" steps: teach a gesture → audio mapping. Show the
//     instruction, listen for the gesture, advance when observed. Used
//     for the playable tutorial.
//
// Each step has a unique `id`, an i18n key prefix, optional timing config,
// and a `kind`-specific payload. The panel renders generic UI from the
// definition — no per-step view code lives in CalibrationPanel.ts.

import type { DictKey } from '../i18n';

/**
 * Which GestureState channel to sample. The panel subscribes to
 * `gesture:update` and tracks min/max of the picked field. We use string
 * keys (rather than callback fns) so step defs stay declarative and
 * trivially testable.
 */
export type SampleChannel =
  | 'meanHeight'
  | 'meanDepth'
  | 'handsDistance3D'
  | 'rightOpenness'
  | 'leftOpenness'
  // x-coordinate of right-hand palm centre (0..1 left-to-right).
  | 'rightPalmX'
  // y-coordinate of right-hand palm centre.
  | 'rightPalmY';

/**
 * Field on the calibration profile that the collected min/max writes into.
 * Decoupled from the source channel so a step can sample `rightOpenness`
 * AND `leftOpenness` and write the combined envelope to `openness`.
 */
export type ProfileTarget =
  | 'handY'
  | 'handX'
  | 'meanDepth'
  | 'openness'
  | 'handsDistance3D';

/**
 * "Sample" step — collect channel values over a fixed duration. Auto-
 * advances when duration elapses. Skippable.
 */
export interface SampleStep {
  kind: 'sample';
  id: string;
  /** i18n key for the bold-line instruction shown to the user. */
  titleKey: DictKey;
  /** i18n key for the helper text under the title. */
  descKey: DictKey;
  /** ms to collect before auto-advance. */
  durationMs: number;
  /** GestureState channels to sample (e.g. ['rightOpenness','leftOpenness']). */
  channels: ReadonlyArray<SampleChannel>;
  /** Profile field to write the combined min/max into. */
  target: ProfileTarget;
}

/**
 * Tutorial gesture predicate — invoked each frame with the latest
 * GestureState. The step completes the first frame this returns true.
 * Defining predicates as named module-level functions (rather than
 * arrows in the array literal) keeps the step list declarative and the
 * predicates unit-testable in isolation.
 */
export type GesturePredicate = (state: {
  meanHeight: number;
  meanDepth: number;
  handsDistance3D: number;
  rightOpenness: number;
  leftOpenness: number;
  bothFists: boolean;
  // Mouth-open value from the FaceState — separate from GestureState so
  // we can require either modality. Defaults to 0 if face tracking is
  // not live.
  mouthOpen: number;
}) => boolean;

/**
 * "Tutorial" step — show an instruction, wait for the user to perform
 * the gesture. Optionally times out so the user can skip a gesture
 * they can't physically perform (e.g. accessibility mode).
 */
export interface TutorialStep {
  kind: 'tutorial';
  id: string;
  titleKey: DictKey;
  descKey: DictKey;
  /** Optional hint shown under the description. */
  hintKey?: DictKey;
  /** Frame predicate — return true to advance. */
  predicate: GesturePredicate;
  /** ms after which a "Skip" prompt is offered. Step doesn't auto-skip. */
  timeoutHintMs: number;
}

export type CalibrationStep = SampleStep | TutorialStep;

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Reach high — top half of frame. */
function reachedHigh(s: { meanHeight: number }): boolean {
  return s.meanHeight > 0.65;
}

/** Reach low — bottom half of frame. */
function reachedLow(s: { meanHeight: number }): boolean {
  return s.meanHeight < 0.35;
}

/** Make a fist on either hand. */
function madeFist(s: { rightOpenness: number; leftOpenness: number }): boolean {
  return s.rightOpenness < 0.25 || s.leftOpenness < 0.25;
}

/** Open hand wide on either hand. */
function openedWide(s: {
  rightOpenness: number;
  leftOpenness: number;
}): boolean {
  return s.rightOpenness > 0.75 || s.leftOpenness > 0.75;
}

/** Two fists simultaneously (the mute gesture). */
function bothFistsClosed(s: { bothFists: boolean }): boolean {
  return s.bothFists === true;
}

/** Mouth open past the harmonic-flourish threshold. */
function mouthOpenedWide(s: { mouthOpen: number }): boolean {
  return s.mouthOpen > 0.6;
}

// ---------------------------------------------------------------------------
// Step list (order matters — the wizard walks this array)
// ---------------------------------------------------------------------------

/**
 * Calibration steps. Tuned for ~30s total wall-clock. Each sample step is
 * 6-8s — long enough for the user to actually reach the extremes, short
 * enough that the wizard doesn't drag.
 *
 * Tutorial section comes AFTER calibration so the user has already moved
 * their hands through the full envelope; the audio feedback during the
 * tutorial then uses the calibrated remap and FEELS responsive.
 */
export const CALIBRATION_STEPS: ReadonlyArray<CalibrationStep> = [
  // ---- Calibration phase ------------------------------------------------
  {
    kind: 'sample',
    id: 'position',
    titleKey: 'calib.position.title',
    descKey: 'calib.position.desc',
    durationMs: 6000,
    channels: ['meanDepth'],
    target: 'meanDepth',
  },
  {
    kind: 'sample',
    id: 'vertical',
    titleKey: 'calib.vertical.title',
    descKey: 'calib.vertical.desc',
    durationMs: 7000,
    channels: ['meanHeight'],
    target: 'handY',
  },
  {
    kind: 'sample',
    id: 'horizontal',
    titleKey: 'calib.horizontal.title',
    descKey: 'calib.horizontal.desc',
    durationMs: 7000,
    channels: ['handsDistance3D'],
    target: 'handsDistance3D',
  },
  {
    kind: 'sample',
    id: 'shape',
    titleKey: 'calib.shape.title',
    descKey: 'calib.shape.desc',
    durationMs: 7000,
    channels: ['rightOpenness', 'leftOpenness'],
    target: 'openness',
  },
  {
    kind: 'sample',
    id: 'lateral',
    titleKey: 'calib.lateral.title',
    descKey: 'calib.lateral.desc',
    durationMs: 6000,
    channels: ['rightPalmX'],
    target: 'handX',
  },

  // ---- Tutorial phase ---------------------------------------------------
  {
    kind: 'tutorial',
    id: 'pitch_high',
    titleKey: 'tut.pitchHigh.title',
    descKey: 'tut.pitchHigh.desc',
    hintKey: 'tut.pitchHigh.hint',
    predicate: reachedHigh,
    timeoutHintMs: 10000,
  },
  {
    kind: 'tutorial',
    id: 'pitch_low',
    titleKey: 'tut.pitchLow.title',
    descKey: 'tut.pitchLow.desc',
    predicate: reachedLow,
    timeoutHintMs: 10000,
  },
  {
    kind: 'tutorial',
    id: 'fist',
    titleKey: 'tut.fist.title',
    descKey: 'tut.fist.desc',
    predicate: madeFist,
    timeoutHintMs: 10000,
  },
  {
    kind: 'tutorial',
    id: 'open',
    titleKey: 'tut.open.title',
    descKey: 'tut.open.desc',
    predicate: openedWide,
    timeoutHintMs: 10000,
  },
  {
    kind: 'tutorial',
    id: 'mute',
    titleKey: 'tut.mute.title',
    descKey: 'tut.mute.desc',
    hintKey: 'tut.mute.hint',
    predicate: bothFistsClosed,
    timeoutHintMs: 12000,
  },
  {
    kind: 'tutorial',
    id: 'mouth',
    titleKey: 'tut.mouth.title',
    descKey: 'tut.mouth.desc',
    hintKey: 'tut.mouth.hint',
    predicate: mouthOpenedWide,
    timeoutHintMs: 12000,
  },
];

/**
 * Convenience: split the step list by phase. Useful for the panel to render
 * a phase divider between the calibration steps and the tutorial.
 */
export const CALIBRATION_PHASE_STEPS = CALIBRATION_STEPS.filter(
  (s): s is SampleStep => s.kind === 'sample',
);
export const TUTORIAL_PHASE_STEPS = CALIBRATION_STEPS.filter(
  (s): s is TutorialStep => s.kind === 'tutorial',
);
