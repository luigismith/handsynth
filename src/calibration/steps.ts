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
// HANDS-FREE FLOW (user pain-point: "se ho le mani occupate a fare quello
// che dice, come faccio a cliccare?"):
//   - Every step auto-advances. Sample steps complete on timer; tutorial
//     steps complete the first sustained frame the predicate is true.
//   - The card is purely informational + status. No "Next" button on the
//     critical path — only Skip + Quit remain (escape hatches).
//   - Each step carries hint metadata: which on-screen target zone to
//     highlight (so the user knows WHERE to put their hand), and which
//     pose icon to render inside the card (so they know WHICH gesture).
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
 * Visual hint: an on-screen target zone overlaid on the live camera so the
 * user knows where to put their hand. Rendered by the panel as a glowing
 * bracketed rectangle outside the wizard card (between card and webcam),
 * sized to be visible without occluding the actual hand skeleton.
 *
 * - `top` / `bottom`: upper / lower band of the frame (vertical reach)
 * - `left` / `right`: left / right band (horizontal sweep)
 * - `center`: centered ~40% rectangle (general "be in view")
 * - `topThenBottom`: animated — top zone glows 2s then bottom zone glows 2s,
 *   used by "vertical range" so the user knows to traverse both extremes
 * - `apartThenTogether`: two zones at the sides that pulse, then a single
 *   centre zone — for horizontal spread sampling
 * - `none`: no on-screen target (pose-only steps like "make a fist")
 */
export type TargetZone =
  | 'none'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center'
  | 'topThenBottom'
  | 'apartThenTogether';

/**
 * Pose icon — small SVG glyph rendered prominently inside the wizard card.
 * Tells the user WHICH gesture to make. Each icon is hand-drawn inline
 * SVG in the panel renderer (so we don't ship a font / asset bundle).
 */
export type PoseIcon =
  | 'none'
  | 'two-hands-frame' // both hands inside a rectangle (positioning)
  | 'arrows-up-down' // raise / lower
  | 'arrows-out-in' // hands apart / together
  | 'open-fist-cycle' // alternating open hand <> fist
  | 'arrows-left-right' // sweep side to side
  | 'arrow-up' // raise high
  | 'arrow-down' // lower
  | 'fist' // single fist
  | 'open-hand' // single open hand
  | 'two-fists' // both fists (mute)
  | 'mouth-open'; // open mouth wide

/**
 * "Sample" step — collect channel values over a fixed duration. Auto-
 * advances when duration elapses.
 *
 * `prepMs` is a pre-roll grace period before sampling begins: the user has
 * time to read the title and position themselves before min/max collection
 * starts. The panel renders a "GET READY 3·2·1" countdown during prepMs
 * and only feeds samples to the accumulator once it elapses.
 */
export interface SampleStep {
  kind: 'sample';
  id: string;
  /** i18n key for the bold-line instruction shown to the user. */
  titleKey: DictKey;
  /** i18n key for the helper text under the title. */
  descKey: DictKey;
  /** ms of get-ready countdown before sampling starts. */
  prepMs: number;
  /** ms to collect samples after the countdown. */
  durationMs: number;
  /** GestureState channels to sample (e.g. ['rightOpenness','leftOpenness']). */
  channels: ReadonlyArray<SampleChannel>;
  /** Profile field to write the combined min/max into. */
  target: ProfileTarget;
  /** On-screen target zone hint. */
  zone: TargetZone;
  /** Pose icon shown inside the card. */
  icon: PoseIcon;
}

/**
 * Tutorial gesture predicate — invoked each frame with the latest
 * GestureState. The step completes the first SUSTAINED frame this
 * returns true (see `holdMs` for the debounce window).
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
 * the gesture. The panel holds the predicate for `holdMs` to debounce
 * false positives (a momentary spike of mouthOpen during a yawn etc.),
 * then auto-advances. `timeoutHintMs` controls when the encouragement
 * hint appears (doesn't auto-skip — Skip button is the explicit
 * escape).
 */
export interface TutorialStep {
  kind: 'tutorial';
  id: string;
  titleKey: DictKey;
  descKey: DictKey;
  /** Optional hint shown under the description after `timeoutHintMs`. */
  hintKey?: DictKey;
  /** Frame predicate — return true to advance. */
  predicate: GesturePredicate;
  /** ms the predicate must remain true continuously before completing. */
  holdMs: number;
  /** ms after which the encouragement hint appears (visual only). */
  timeoutHintMs: number;
  /** On-screen target zone hint. */
  zone: TargetZone;
  /** Pose icon shown inside the card. */
  icon: PoseIcon;
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
 * Default debounce window for tutorial-step completion. 350ms feels
 * instant to the user but is long enough to filter out single-frame
 * predicate spikes (e.g. a yawn registering as mouth-open during the
 * fist step).
 */
const DEFAULT_HOLD_MS = 350;

/**
 * Calibration steps. Each step auto-advances — no clicking required from
 * the user. Sample steps run a "GET READY" prep countdown so the user can
 * read the prompt and position before collection begins.
 *
 * Tutorial section comes AFTER calibration so the audio response during
 * tutorial uses the calibrated remap and FEELS responsive.
 */
export const CALIBRATION_STEPS: ReadonlyArray<CalibrationStep> = [
  // ---- Calibration phase ------------------------------------------------
  {
    kind: 'sample',
    id: 'position',
    titleKey: 'calib.position.title',
    descKey: 'calib.position.desc',
    prepMs: 2500,
    durationMs: 4000,
    channels: ['meanDepth'],
    target: 'meanDepth',
    zone: 'center',
    icon: 'two-hands-frame',
  },
  {
    kind: 'sample',
    id: 'vertical',
    titleKey: 'calib.vertical.title',
    descKey: 'calib.vertical.desc',
    prepMs: 2500,
    durationMs: 6000,
    channels: ['meanHeight'],
    target: 'handY',
    zone: 'topThenBottom',
    icon: 'arrows-up-down',
  },
  {
    kind: 'sample',
    id: 'horizontal',
    titleKey: 'calib.horizontal.title',
    descKey: 'calib.horizontal.desc',
    prepMs: 2500,
    durationMs: 6000,
    channels: ['handsDistance3D'],
    target: 'handsDistance3D',
    zone: 'apartThenTogether',
    icon: 'arrows-out-in',
  },
  {
    kind: 'sample',
    id: 'shape',
    titleKey: 'calib.shape.title',
    descKey: 'calib.shape.desc',
    prepMs: 2500,
    durationMs: 6000,
    channels: ['rightOpenness', 'leftOpenness'],
    target: 'openness',
    zone: 'none',
    icon: 'open-fist-cycle',
  },
  {
    kind: 'sample',
    id: 'lateral',
    titleKey: 'calib.lateral.title',
    descKey: 'calib.lateral.desc',
    prepMs: 2500,
    durationMs: 5500,
    channels: ['rightPalmX'],
    target: 'handX',
    zone: 'apartThenTogether',
    icon: 'arrows-left-right',
  },

  // ---- Tutorial phase ---------------------------------------------------
  {
    kind: 'tutorial',
    id: 'pitch_high',
    titleKey: 'tut.pitchHigh.title',
    descKey: 'tut.pitchHigh.desc',
    hintKey: 'tut.pitchHigh.hint',
    predicate: reachedHigh,
    holdMs: DEFAULT_HOLD_MS,
    timeoutHintMs: 7000,
    zone: 'top',
    icon: 'arrow-up',
  },
  {
    kind: 'tutorial',
    id: 'pitch_low',
    titleKey: 'tut.pitchLow.title',
    descKey: 'tut.pitchLow.desc',
    predicate: reachedLow,
    holdMs: DEFAULT_HOLD_MS,
    timeoutHintMs: 7000,
    zone: 'bottom',
    icon: 'arrow-down',
  },
  {
    kind: 'tutorial',
    id: 'fist',
    titleKey: 'tut.fist.title',
    descKey: 'tut.fist.desc',
    predicate: madeFist,
    holdMs: DEFAULT_HOLD_MS,
    timeoutHintMs: 7000,
    zone: 'none',
    icon: 'fist',
  },
  {
    kind: 'tutorial',
    id: 'open',
    titleKey: 'tut.open.title',
    descKey: 'tut.open.desc',
    predicate: openedWide,
    holdMs: DEFAULT_HOLD_MS,
    timeoutHintMs: 7000,
    zone: 'none',
    icon: 'open-hand',
  },
  {
    kind: 'tutorial',
    id: 'mute',
    titleKey: 'tut.mute.title',
    descKey: 'tut.mute.desc',
    hintKey: 'tut.mute.hint',
    predicate: bothFistsClosed,
    holdMs: 500, // a bit longer for the deliberate "BOTH fists" intent
    timeoutHintMs: 9000,
    zone: 'none',
    icon: 'two-fists',
  },
  {
    kind: 'tutorial',
    id: 'mouth',
    titleKey: 'tut.mouth.title',
    descKey: 'tut.mouth.desc',
    hintKey: 'tut.mouth.hint',
    predicate: mouthOpenedWide,
    holdMs: 400,
    timeoutHintMs: 9000,
    zone: 'none',
    icon: 'mouth-open',
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
