// Owner: ux-curator
//
// Full-screen, HANDS-FREE calibration + tutorial wizard.
//
// User pain-point that drove the redesign: "se ho le mani occupate a fare
// quello che dice, come faccio a cliccare?". The previous version required
// pressing Next at the end of every step — impossible while the user's
// hands are performing the calibration gesture. This version is fully
// auto-advancing.
//
// State machine per step:
//
//   SAMPLE STEPS (5 calibration steps)
//     1. PREP  — show GET READY 3·2·1 countdown for `prepMs`. No min/max
//                accumulation yet. User reads the prompt + spots the
//                on-screen target zone.
//     2. RUN   — accumulate stats for `durationMs`. Big bar shows live
//                "spread" so user gets feedback they're actually moving.
//     3. DONE  — flash "CAPTURED ✓" for DONE_FLASH_MS, write stats into
//                profile, auto-advance.
//
//   TUTORIAL STEPS (6 playable lessons)
//     1. WAIT  — predicate evaluated every frame. Status "in attesa".
//                After `timeoutHintMs` the encouragement hint reveals.
//     2. HOLD  — once predicate true, count consecutive frames. If
//                predicate becomes false, reset to WAIT. Bar shows hold
//                progress so the user sees their gesture being held.
//     3. DONE  — predicate held for `holdMs` → flash "GOT IT ✓" → advance.
//
// On-screen target zones (rendered OUTSIDE the card, full-screen):
//   The user sees a glowing bracketed rectangle telling them WHERE to put
//   their hand. For motion steps (vertical / horizontal) the zone
//   animates between two positions so the user knows to traverse.
//
// Pose icon (rendered inside the card):
//   Small inline-SVG glyph showing WHICH gesture to make (fist, open,
//   etc.). Lives next to the title so the user reads it at a glance.
//
// The Next button is gone from the critical path. Skip + Quit remain as
// small accessibility escape hatches; the user can move ONE hand to a
// nearby mouse/trackpad if they really need to bail. The wizard's
// promise is that they NEVER need to under normal use.

import type {
  FaceState,
  FaceTracker,
  GestureState,
  Hand,
  HandTracker,
} from '@contracts/contracts';
import { injectStyles } from '../ui/styles';
import { t, subscribeLang } from '../i18n';
import type { DictKey } from '../i18n';
import {
  CALIBRATION_PHASE_STEPS,
  CALIBRATION_STEPS,
  TUTORIAL_PHASE_STEPS,
  type CalibrationStep,
  type PoseIcon,
  type ProfileTarget,
  type SampleChannel,
  type SampleStep,
  type TargetZone,
  type TutorialStep,
} from './steps';
import {
  DEFAULT_CALIBRATION,
  type CalibrationProfile,
  type CalibrationRange,
} from './types';
import { saveCalibration } from './store';

export interface CalibrationPanelDeps {
  hands: HandTracker;
  /** Optional — face tracking is best-effort. Mouth-open tutorial step
   *  is auto-skipped (treated as complete on timeout) when absent. */
  face?: FaceTracker;
  /** Webcam <video> — needed to stamp videoWidth/Height into the profile. */
  videoEl?: HTMLVideoElement | null;
  /**
   * Called when the wizard finishes (Done) or is abandoned (Quit). The
   * caller persists + applies the profile. Even on quit we emit so the
   * caller can mark "user dismissed" and not re-trigger on next boot.
   */
  onComplete: (profile: CalibrationProfile, quitEarly: boolean) => void;
}

/** Tracks min/max for one channel across a step's lifetime. */
interface ChannelStats {
  min: number;
  max: number;
  /** Number of samples ingested. Below MIN_SAMPLES we treat as "no data". */
  samples: number;
}

const MIN_SAMPLES = 8;
/** How long the "CAPTURED ✓" / "GOT IT ✓" celebration shows before advance. */
const DONE_FLASH_MS = 700;

/** Per-step lifecycle phase. */
type Phase = 'prep' | 'run' | 'wait' | 'hold' | 'done';

export class CalibrationPanelImpl {
  // DOM refs
  private root: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private descEl: HTMLParagraphElement | null = null;
  private hintEl: HTMLParagraphElement | null = null;
  private progressFillEl: HTMLDivElement | null = null;
  private stepCounterEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private skipBtn: HTMLButtonElement | null = null;
  private quitBtn: HTMLButtonElement | null = null;
  private bigBarEl: HTMLDivElement | null = null;
  private bigBarFillEl: HTMLDivElement | null = null;
  private iconHostEl: HTMLDivElement | null = null;
  private prepCountdownEl: HTMLDivElement | null = null;
  /** Target-zone rectangles drawn full-screen behind the card. */
  private zoneAEl: HTMLDivElement | null = null;
  private zoneBEl: HTMLDivElement | null = null;
  private unsubLang: (() => void) | null = null;

  private deps: CalibrationPanelDeps | null = null;
  private gestureCb: ((state: GestureState) => void) | null = null;
  private faceCb: ((state: FaceState) => void) | null = null;

  /** Build the in-progress profile as we go. */
  private profile: CalibrationProfile = { ...DEFAULT_CALIBRATION };

  /** Current step index. */
  private idx = 0;
  /** Lifecycle phase for the current step. */
  private phase: Phase = 'prep';
  /** Per-channel min/max accumulators for the active sample step. */
  private stats: Map<SampleChannel, ChannelStats> = new Map();
  /** ms when the current step started (relative to the active phase). */
  private phaseStartMs = 0;
  /** ms when the predicate FIRST became true during the current hold attempt. */
  private holdStartMs = 0;
  /** Whether the tutorial encouragement hint has revealed for this step. */
  private tutorialHintShown = false;
  /** Latest mouth-open value — captured from FaceTracker if present. */
  private mouthOpen = 0;
  /** Latest gesture state — cached so the rAF tick can re-evaluate predicates
   *  even on frames when no fresh gesture:update arrived. */
  private latestState: GestureState | null = null;
  /** RAF handle for per-frame UI tick. */
  private rafHandle: number | null = null;
  /** Set true when user closes / completes. Prevents double-complete. */
  private finished = false;

  /**
   * Mount the wizard into the given host element. Idempotent.
   */
  mount(parent: HTMLElement, deps: CalibrationPanelDeps): void {
    if (this.root) return;
    injectStyles();
    this.deps = deps;
    if (deps.videoEl && deps.videoEl.videoWidth && deps.videoEl.videoHeight) {
      this.profile.videoWidth = deps.videoEl.videoWidth;
      this.profile.videoHeight = deps.videoEl.videoHeight;
    }

    const overlay = document.createElement('div');
    overlay.className = 'hs-calib-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hs-calib-title');

    // Target zones — rendered behind the card, full-screen positioned, so
    // the user sees them overlaid on the live video. Two slots so steps
    // with alternating zones (top↔bottom etc.) can crossfade A/B.
    const zoneA = document.createElement('div');
    zoneA.className = 'hs-calib-zone';
    zoneA.hidden = true;
    const zoneB = document.createElement('div');
    zoneB.className = 'hs-calib-zone';
    zoneB.hidden = true;
    overlay.append(zoneA, zoneB);

    // Wizard card
    const card = document.createElement('div');
    card.className = 'hs-calib-card';

    // Header — step counter + quit button.
    const header = document.createElement('div');
    header.className = 'hs-calib-header';
    const counter = document.createElement('div');
    counter.className = 'hs-calib-step-counter';
    const quit = document.createElement('button');
    quit.type = 'button';
    quit.className = 'hs-calib-quit';
    quit.addEventListener('click', () => this.handleQuit());
    header.append(counter, quit);

    // Pose icon — large SVG inside the card. Set per-step via setIcon().
    const iconHost = document.createElement('div');
    iconHost.className = 'hs-calib-icon';
    iconHost.setAttribute('aria-hidden', 'true');

    // Title + description + hint.
    const title = document.createElement('h2');
    title.id = 'hs-calib-title';
    title.className = 'hs-calib-title';
    const desc = document.createElement('p');
    desc.className = 'hs-calib-desc';
    const hint = document.createElement('p');
    hint.className = 'hs-calib-hint';
    hint.hidden = true;

    // Big visual indicator — semantics decided per-step + per-phase.
    const bigBar = document.createElement('div');
    bigBar.className = 'hs-calib-bigbar';
    const bigBarFill = document.createElement('div');
    bigBarFill.className = 'hs-calib-bigbar-fill';
    bigBar.appendChild(bigBarFill);

    // GET READY prep countdown — large number centered over the bigbar.
    const prepCountdown = document.createElement('div');
    prepCountdown.className = 'hs-calib-prep';
    prepCountdown.hidden = true;

    // Step-timer progress (thin bar).
    const progress = document.createElement('div');
    progress.className = 'hs-calib-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'hs-calib-progress-fill';
    progress.appendChild(progressFill);

    // Live status text.
    const status = document.createElement('div');
    status.className = 'hs-calib-status';

    // Buttons — only Skip remains as an explicit critical-path action.
    // Quit is in the header X. No Next button: the wizard auto-advances.
    const buttons = document.createElement('div');
    buttons.className = 'hs-calib-buttons';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'hs-calib-btn hs-calib-btn-secondary';
    skip.addEventListener('click', () => this.advance(/* skipped */ true));
    buttons.appendChild(skip);

    card.append(
      header,
      iconHost,
      title,
      desc,
      hint,
      bigBar,
      prepCountdown,
      progress,
      status,
      buttons,
    );
    overlay.appendChild(card);
    parent.appendChild(overlay);

    this.root = overlay;
    this.card = card;
    this.titleEl = title;
    this.descEl = desc;
    this.hintEl = hint;
    this.progressFillEl = progressFill;
    this.stepCounterEl = counter;
    this.statusEl = status;
    this.skipBtn = skip;
    this.quitBtn = quit;
    this.bigBarEl = bigBar;
    this.bigBarFillEl = bigBarFill;
    this.iconHostEl = iconHost;
    this.prepCountdownEl = prepCountdown;
    this.zoneAEl = zoneA;
    this.zoneBEl = zoneB;

    // Subscribe to language changes so the panel re-localizes without
    // a remount.
    this.applyLang();
    this.unsubLang = subscribeLang(() => this.applyLang());

    // Subscribe to hand + face streams.
    this.gestureCb = (state: GestureState): void => this.onGestureUpdate(state);
    deps.hands.on('gesture:update', this.gestureCb);
    if (deps.face) {
      this.faceCb = (state: FaceState): void => {
        this.mouthOpen = state.detected ? state.mouthOpen : 0;
      };
      deps.face.on('face:update', this.faceCb);
    }

    // Boot the first step.
    this.beginStep(0);
    this.startRaf();
  }

  /**
   * Tear down the DOM + detach listeners. Idempotent.
   */
  unmount(): void {
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;

    if (this.gestureCb && this.deps?.hands) {
      this.deps.hands.off('gesture:update', this.gestureCb);
    }
    this.gestureCb = null;
    if (this.faceCb && this.deps?.face) {
      this.deps.face.off('face:update', this.faceCb);
    }
    this.faceCb = null;

    if (this.root && this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
    this.root = null;
    this.card = null;
    this.titleEl = null;
    this.descEl = null;
    this.hintEl = null;
    this.progressFillEl = null;
    this.stepCounterEl = null;
    this.statusEl = null;
    this.skipBtn = null;
    this.quitBtn = null;
    this.bigBarEl = null;
    this.bigBarFillEl = null;
    this.iconHostEl = null;
    this.prepCountdownEl = null;
    this.zoneAEl = null;
    this.zoneBEl = null;

    this.deps = null;
    this.stats.clear();
  }

  /**
   * Re-apply localized labels onto the existing DOM.
   */
  applyLang(): void {
    if (!this.root) return;
    const step = CALIBRATION_STEPS[this.idx];
    if (this.stepCounterEl) {
      const total = CALIBRATION_STEPS.length;
      const phaseKey: DictKey =
        step?.kind === 'tutorial'
          ? 'calib.counter.tutorial'
          : 'calib.counter.calibration';
      this.stepCounterEl.textContent = `${t(phaseKey)} · ${this.idx + 1}/${total}`;
    }
    if (this.quitBtn) {
      const tip = t('calib.quit');
      this.quitBtn.textContent = '✕';
      this.quitBtn.title = tip;
      this.quitBtn.setAttribute('aria-label', tip);
    }
    if (this.skipBtn) this.skipBtn.textContent = t('calib.skip');
    if (!step) return;
    if (this.titleEl) this.titleEl.textContent = t(step.titleKey);
    if (this.descEl) this.descEl.textContent = t(step.descKey);
    if (this.hintEl) {
      const hintKey = step.kind === 'tutorial' ? step.hintKey : undefined;
      if (hintKey) {
        this.hintEl.textContent = t(hintKey);
        if (!this.tutorialHintShown) this.hintEl.hidden = true;
        else this.hintEl.hidden = false;
      } else {
        this.hintEl.textContent = '';
        this.hintEl.hidden = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step state machine
  // -----------------------------------------------------------------------

  private beginStep(idx: number): void {
    this.idx = idx;
    this.stats.clear();
    this.tutorialHintShown = false;
    this.phaseStartMs = performance.now();
    this.holdStartMs = 0;
    if (this.hintEl) this.hintEl.hidden = true;
    if (this.bigBarFillEl) this.bigBarFillEl.style.width = '0%';
    if (this.bigBarEl) this.bigBarEl.classList.remove('hs-calib-bigbar-ok');
    if (this.statusEl) this.statusEl.textContent = '';
    if (this.card) this.card.classList.remove('hs-calib-card-done');

    const step = CALIBRATION_STEPS[idx];
    if (!step) return;

    // Reset to the correct initial phase for the new step.
    this.phase = step.kind === 'sample' ? 'prep' : 'wait';
    this.renderIcon(step.icon);
    this.renderZone(step.zone);
    this.applyLang();
  }

  /**
   * Per-frame UI tick. Drives:
   *  - PREP countdown (sample steps)
   *  - SAMPLE progress bar + spread feedback
   *  - WAIT/HOLD progress for tutorial steps (predicate timing)
   *  - DONE flash + auto-advance
   *  - Animated alternating zones (topThenBottom / apartThenTogether)
   */
  private tickUi(): void {
    if (!this.root) return;
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    const now = performance.now();
    const elapsed = now - this.phaseStartMs;

    // Animate zones that alternate. Slow 2s cycle so user has time to
    // register each target.
    this.animateZone(step.zone, now);

    if (this.phase === 'done') {
      // We're in the celebration flash — wait DONE_FLASH_MS then advance.
      if (elapsed >= DONE_FLASH_MS) {
        this.advance(/* skipped */ false);
      }
      return;
    }

    if (step.kind === 'sample') {
      if (this.phase === 'prep') {
        const t = Math.max(0, step.prepMs - elapsed);
        const sec = Math.ceil(t / 1000);
        if (this.prepCountdownEl) {
          this.prepCountdownEl.hidden = false;
          this.prepCountdownEl.textContent = sec > 0 ? String(sec) : 'GO';
        }
        if (this.progressFillEl) this.progressFillEl.style.width = '0%';
        if (this.statusEl) this.statusEl.textContent = t > 0
          ? this.localizedReady()
          : '';
        if (this.bigBarFillEl) this.bigBarFillEl.style.width = '0%';
        if (elapsed >= step.prepMs) {
          // Transition PREP → RUN. Reset phase clock.
          this.phase = 'run';
          this.phaseStartMs = now;
          this.stats.clear();
          if (this.prepCountdownEl) this.prepCountdownEl.hidden = true;
        }
        return;
      }
      // phase === 'run'
      const frac = Math.min(1, elapsed / step.durationMs);
      if (this.progressFillEl) {
        this.progressFillEl.style.width = `${frac * 100}%`;
      }
      const span = this.computeBestSpan();
      if (this.bigBarFillEl) {
        this.bigBarFillEl.style.width = `${Math.min(1, span / 0.6) * 100}%`;
      }
      if (this.statusEl) {
        const remainingSec = Math.max(0, Math.ceil((step.durationMs - elapsed) / 1000));
        this.statusEl.textContent = t('calib.collecting', { s: remainingSec });
      }
      if (frac >= 1) {
        // Sample window closed — write profile + transition to DONE flash.
        this.commitSampleStep(step);
        this.enterDoneFlash();
      }
      return;
    }

    // ---- TUTORIAL step --------------------------------------------------
    // Show countdown bar for the timeoutHint (visual; not blocking).
    const hintFrac = Math.min(1, elapsed / step.timeoutHintMs);
    if (this.progressFillEl) {
      this.progressFillEl.style.width = `${hintFrac * 100}%`;
    }
    if (!this.tutorialHintShown && elapsed > step.timeoutHintMs) {
      this.tutorialHintShown = true;
      if (this.hintEl && step.hintKey) {
        this.hintEl.textContent = t(step.hintKey);
        this.hintEl.hidden = false;
      }
    }

    if (this.phase === 'wait') {
      if (this.statusEl) this.statusEl.textContent = t('calib.waitingGesture');
      if (this.bigBarFillEl) this.bigBarFillEl.style.width = '0%';
      // Predicate is evaluated each frame in onGestureUpdate; on first
      // true we transition wait → hold. We re-check here using the
      // cached latest state in case no fresh gesture event arrived since
      // the last frame (avoids a stuck WAIT when the gesture is stable).
      if (this.latestState && this.evaluateTutorial(step, this.latestState)) {
        this.phase = 'hold';
        this.holdStartMs = now;
      }
      return;
    }

    // phase === 'hold'
    const heldFor = now - this.holdStartMs;
    const holdFrac = Math.min(1, heldFor / step.holdMs);
    if (this.bigBarFillEl) {
      this.bigBarFillEl.style.width = `${holdFrac * 100}%`;
    }
    if (this.bigBarEl) this.bigBarEl.classList.add('hs-calib-bigbar-ok');
    if (this.statusEl) this.statusEl.textContent = t('calib.holding');

    // Re-check predicate against latest state; if it broke, drop back to wait.
    if (this.latestState && !this.evaluateTutorial(step, this.latestState)) {
      this.phase = 'wait';
      this.holdStartMs = 0;
      if (this.bigBarEl) this.bigBarEl.classList.remove('hs-calib-bigbar-ok');
      return;
    }
    if (heldFor >= step.holdMs) {
      this.enterDoneFlash();
    }
  }

  /** Compute the largest observed span across all channels in this step. */
  private computeBestSpan(): number {
    let best = 0;
    for (const stats of this.stats.values()) {
      if (stats.samples < MIN_SAMPLES) continue;
      const span = stats.max - stats.min;
      if (span > best) best = span;
    }
    return best;
  }

  /**
   * Commit the collected min/max to the profile. Called at the end of a
   * sample step's RUN phase, before the DONE flash. Idempotent: a second
   * call would just overwrite with the same data.
   */
  private commitSampleStep(step: SampleStep): void {
    const range = this.flattenStats(step.channels);
    if (range) this.profile[step.target] = range;
  }

  private enterDoneFlash(): void {
    this.phase = 'done';
    this.phaseStartMs = performance.now();
    if (this.card) this.card.classList.add('hs-calib-card-done');
    if (this.bigBarEl) this.bigBarEl.classList.add('hs-calib-bigbar-ok');
    if (this.bigBarFillEl) this.bigBarFillEl.style.width = '100%';
    if (this.statusEl) this.statusEl.textContent = t('calib.captured');
  }

  // -----------------------------------------------------------------------
  // Event handling
  // -----------------------------------------------------------------------

  private onGestureUpdate(state: GestureState): void {
    this.latestState = state;
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    if (this.phase === 'done') return;

    if (step.kind === 'sample') {
      // Only accumulate during the RUN phase (skip PREP / DONE).
      if (this.phase !== 'run') return;
      for (const ch of step.channels) {
        const v = channelValue(ch, state);
        if (v === null) continue;
        let stats = this.stats.get(ch);
        if (!stats) {
          stats = { min: v, max: v, samples: 0 };
          this.stats.set(ch, stats);
        } else {
          if (v < stats.min) stats.min = v;
          if (v > stats.max) stats.max = v;
        }
        stats.samples += 1;
      }
      return;
    }

    // Tutorial step — predicate-driven state transitions.
    const ok = this.evaluateTutorial(step, state);
    if (this.phase === 'wait' && ok) {
      this.phase = 'hold';
      this.holdStartMs = performance.now();
    } else if (this.phase === 'hold' && !ok) {
      this.phase = 'wait';
      this.holdStartMs = 0;
      if (this.bigBarEl) this.bigBarEl.classList.remove('hs-calib-bigbar-ok');
    }
  }

  private evaluateTutorial(step: TutorialStep, state: GestureState): boolean {
    return step.predicate({
      meanHeight: state.meanHeight,
      meanDepth: state.meanDepth,
      handsDistance3D: state.handsDistance3D,
      rightOpenness: state.rightOpenness,
      leftOpenness: state.leftOpenness,
      bothFists: state.bothFists,
      mouthOpen: this.mouthOpen,
    });
  }

  // -----------------------------------------------------------------------
  // Advance / finish
  // -----------------------------------------------------------------------

  private advance(skipped: boolean): void {
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    // If we're auto-advancing from DONE, the sample step's data is already
    // committed (during the RUN→DONE transition). If we're SKIPPING from
    // any other phase, do NOT write — user explicitly opted out of this
    // step's measurement.
    if (skipped && step.kind === 'sample' && this.phase === 'run') {
      // Partial data — discard.
    }

    const nextIdx = this.idx + 1;
    if (nextIdx >= CALIBRATION_STEPS.length) {
      this.finish(/* quitEarly */ false);
      return;
    }
    this.beginStep(nextIdx);
  }

  /**
   * Combine per-channel stats into a single CalibrationRange. When the step
   * samples multiple channels (e.g. openness sees both R and L), take the
   * widest observed envelope. Returns null when no channel has enough
   * samples.
   */
  private flattenStats(channels: ReadonlyArray<SampleChannel>): CalibrationRange | null {
    let lo = Infinity;
    let hi = -Infinity;
    let any = false;
    for (const ch of channels) {
      const s = this.stats.get(ch);
      if (!s || s.samples < MIN_SAMPLES) continue;
      if (s.min < lo) lo = s.min;
      if (s.max > hi) hi = s.max;
      any = true;
    }
    if (!any || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return { min: lo, max: hi };
  }

  private handleQuit(): void {
    this.finish(/* quitEarly */ true);
  }

  private finish(quitEarly: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.profile.completedAt = Date.now();
    if (!quitEarly) this.profile.tutorialCompleted = true;
    saveCalibration(this.profile);
    if (this.deps?.onComplete) this.deps.onComplete(this.profile, quitEarly);
  }

  // -----------------------------------------------------------------------
  // Per-frame tick
  // -----------------------------------------------------------------------

  private startRaf(): void {
    const tick = (): void => {
      if (!this.root) return;
      this.tickUi();
      this.rafHandle = requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === 'function') {
      this.rafHandle = requestAnimationFrame(tick);
    }
  }

  // -----------------------------------------------------------------------
  // Visual hints — pose icon (in-card SVG) + target zone (on-screen)
  // -----------------------------------------------------------------------

  private renderIcon(icon: PoseIcon): void {
    if (!this.iconHostEl) return;
    this.iconHostEl.innerHTML = POSE_ICON_SVG[icon] ?? '';
  }

  /**
   * Configure the on-screen target zone overlay. Static zones render in
   * zoneAEl with a fixed position. Animated zones (topThenBottom,
   * apartThenTogether) use both zoneA and zoneB and `animateZone` toggles
   * their visibility on a slow oscillation.
   */
  private renderZone(zone: TargetZone): void {
    if (!this.zoneAEl || !this.zoneBEl) return;
    // Clear both.
    this.zoneAEl.hidden = true;
    this.zoneBEl.hidden = true;
    this.zoneAEl.style.cssText = '';
    this.zoneBEl.style.cssText = '';
    this.zoneAEl.className = 'hs-calib-zone';
    this.zoneBEl.className = 'hs-calib-zone';

    switch (zone) {
      case 'none':
        return;
      case 'center':
        applyZone(this.zoneAEl, 'center');
        this.zoneAEl.hidden = false;
        return;
      case 'top':
        applyZone(this.zoneAEl, 'top');
        this.zoneAEl.hidden = false;
        return;
      case 'bottom':
        applyZone(this.zoneAEl, 'bottom');
        this.zoneAEl.hidden = false;
        return;
      case 'left':
        applyZone(this.zoneAEl, 'left');
        this.zoneAEl.hidden = false;
        return;
      case 'right':
        applyZone(this.zoneAEl, 'right');
        this.zoneAEl.hidden = false;
        return;
      case 'topThenBottom':
        applyZone(this.zoneAEl, 'top');
        applyZone(this.zoneBEl, 'bottom');
        // Visibility is toggled by animateZone() on a 2s cycle.
        this.zoneAEl.hidden = false;
        return;
      case 'apartThenTogether':
        applyZone(this.zoneAEl, 'left');
        applyZone(this.zoneBEl, 'right');
        this.zoneAEl.hidden = false;
        this.zoneBEl.hidden = false;
        return;
    }
  }

  /**
   * Drive the A/B crossfade for alternating zones. Runs every UI tick;
   * pure DOM class toggling so it's cheap.
   */
  private animateZone(zone: TargetZone, now: number): void {
    if (!this.zoneAEl || !this.zoneBEl) return;
    if (zone === 'topThenBottom') {
      // 2s cycle — A glows for the first half, B for the second half.
      const phase = Math.floor(now / 2000) % 2;
      this.zoneAEl.classList.toggle('hs-calib-zone-active', phase === 0);
      this.zoneBEl.classList.toggle('hs-calib-zone-active', phase === 1);
      this.zoneBEl.hidden = false;
      return;
    }
    if (zone === 'apartThenTogether') {
      // Both glow simultaneously (showing "reach to either side").
      this.zoneAEl.classList.add('hs-calib-zone-active');
      this.zoneBEl.classList.add('hs-calib-zone-active');
      return;
    }
    // Static zones — A is always "active".
    if (this.zoneAEl && !this.zoneAEl.hidden) {
      this.zoneAEl.classList.add('hs-calib-zone-active');
    }
  }

  private localizedReady(): string {
    return t('calib.getReady');
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-level — pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Extract the float value of a SampleChannel from a GestureState. Returns
 * null when the channel isn't available this frame (e.g. rightPalmX when
 * the right hand isn't in view).
 */
export function channelValue(
  ch: SampleChannel,
  state: GestureState,
): number | null {
  switch (ch) {
    case 'meanHeight':
      return state.hands.length > 0 ? state.meanHeight : null;
    case 'meanDepth':
      return state.hands.length > 0 ? state.meanDepth : null;
    case 'handsDistance3D':
      return state.bothHandsDetected ? state.handsDistance3D : null;
    case 'rightOpenness': {
      const r = state.hands.find((h: Hand) => h.side === 'right');
      return r ? r.openness : null;
    }
    case 'leftOpenness': {
      const l = state.hands.find((h: Hand) => h.side === 'left');
      return l ? l.openness : null;
    }
    case 'rightPalmX': {
      const r = state.hands.find((h: Hand) => h.side === 'right');
      if (!r) return null;
      return r.palmCenter.x;
    }
    case 'rightPalmY': {
      const r = state.hands.find((h: Hand) => h.side === 'right');
      if (!r) return null;
      return r.palmCenter.y;
    }
  }
}

/**
 * Apply CSS for a named static zone position. The zones live in viewport
 * coords (vw/vh) so they reflow with the window.
 */
function applyZone(el: HTMLDivElement, kind: string): void {
  switch (kind) {
    case 'center':
      el.style.cssText =
        'left:30vw; right:30vw; top:25vh; bottom:35vh;';
      break;
    case 'top':
      el.style.cssText =
        'left:20vw; right:20vw; top:6vh; height:25vh;';
      break;
    case 'bottom':
      el.style.cssText =
        'left:20vw; right:20vw; bottom:6vh; height:25vh;';
      break;
    case 'left':
      el.style.cssText =
        'left:5vw; top:30vh; bottom:30vh; width:18vw;';
      break;
    case 'right':
      el.style.cssText =
        'right:5vw; top:30vh; bottom:30vh; width:18vw;';
      break;
  }
}

// ---------------------------------------------------------------------------
// Pose icon SVG library
//
// Hand-drawn inline SVG. Each glyph uses currentColor stroke so it picks up
// the orange accent from the surrounding card. Kept minimal (path + arc
// primitives only) so the bundle isn't bloated.
// ---------------------------------------------------------------------------

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" width="48" height="48"';

const POSE_ICON_SVG: Record<PoseIcon, string> = {
  none: '',
  'two-hands-frame': `<svg ${SVG_ATTRS}>
    <rect x="8" y="14" width="48" height="36" rx="3"/>
    <path d="M18 28v10M22 26v12M26 24v14M30 26v12M18 38h12"/>
    <path d="M46 28v10M42 26v12M38 24v14M34 26v12M46 38h-12"/>
  </svg>`,
  'arrows-up-down': `<svg ${SVG_ATTRS}>
    <path d="M32 10v44"/>
    <path d="M22 18l10-10 10 10"/>
    <path d="M22 46l10 10 10-10"/>
  </svg>`,
  'arrows-out-in': `<svg ${SVG_ATTRS}>
    <path d="M28 22l-10 10 10 10"/>
    <path d="M36 22l10 10-10 10"/>
    <path d="M18 32h28"/>
  </svg>`,
  'open-fist-cycle': `<svg ${SVG_ATTRS}>
    <circle cx="18" cy="32" r="10"/>
    <path d="M14 26v6M18 24v8M22 26v6"/>
    <circle cx="46" cy="32" r="10"/>
    <path d="M40 30h12M40 34h12"/>
    <path d="M28 32h8M30 30l-2 2 2 2M34 30l2 2-2 2"/>
  </svg>`,
  'arrows-left-right': `<svg ${SVG_ATTRS}>
    <path d="M10 32h44"/>
    <path d="M18 22l-10 10 10 10"/>
    <path d="M46 22l10 10-10 10"/>
  </svg>`,
  'arrow-up': `<svg ${SVG_ATTRS}>
    <path d="M32 8v48"/>
    <path d="M18 22L32 8l14 14"/>
  </svg>`,
  'arrow-down': `<svg ${SVG_ATTRS}>
    <path d="M32 8v48"/>
    <path d="M18 42L32 56l14-14"/>
  </svg>`,
  fist: `<svg ${SVG_ATTRS}>
    <circle cx="32" cy="32" r="14"/>
    <path d="M22 28h20M22 34h20M28 28v6M32 28v6M36 28v6"/>
  </svg>`,
  'open-hand': `<svg ${SVG_ATTRS}>
    <path d="M18 38c0-6 0-12 0-16 0-2 3-2 3 0v10"/>
    <path d="M24 26V14c0-2 3-2 3 0v14"/>
    <path d="M30 26V12c0-2 3-2 3 0v16"/>
    <path d="M36 26V14c0-2 3-2 3 0v14"/>
    <path d="M42 28v-8c0-2 3-2 3 0v14"/>
    <path d="M21 32c0 8 4 14 12 14s12-6 12-14"/>
  </svg>`,
  'two-fists': `<svg ${SVG_ATTRS}>
    <circle cx="18" cy="32" r="10"/>
    <path d="M11 30h14M11 34h14M15 30v4M19 30v4"/>
    <circle cx="46" cy="32" r="10"/>
    <path d="M39 30h14M39 34h14M43 30v4M47 30v4"/>
    <path d="M30 32l4 0M30 28l4 4-4 4"/>
  </svg>`,
  'mouth-open': `<svg ${SVG_ATTRS}>
    <circle cx="32" cy="32" r="22"/>
    <circle cx="24" cy="26" r="2" fill="currentColor"/>
    <circle cx="40" cy="26" r="2" fill="currentColor"/>
    <ellipse cx="32" cy="40" rx="8" ry="6"/>
  </svg>`,
};

// Re-export for the panel users + tests.
export { CALIBRATION_PHASE_STEPS, TUTORIAL_PHASE_STEPS, CALIBRATION_STEPS };
export type { CalibrationStep, ProfileTarget, SampleChannel, SampleStep, TutorialStep };
