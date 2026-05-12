// Owner: ux-curator
//
// Full-screen calibration + tutorial wizard.
//
// Two phases walked in order (see steps.ts for the data):
//   1. Calibration sampling — the user does each motion (move up/down,
//      hands wide/close, open/close, etc.) for a fixed duration. The
//      panel subscribes to `gesture:update` and tracks the min/max of the
//      step's channels. At end of duration we write the observed range
//      into the in-progress profile.
//   2. Tutorial — the user performs one gesture at a time. The panel
//      runs the step's predicate against each `gesture:update`, advancing
//      on the first true frame. Audio is alive throughout so the user
//      hears the effect of each gesture.
//
// First-launch UX:
//   - The panel mounts AFTER hand tracking has come up but BEFORE the user
//     can do anything else. It's modal (overlay covers everything except
//     the visualizer canvas). Skippable in case the user already knows
//     the app and just wants in.
//
// Re-runs:
//   - The SettingsPanel exposes a "RICALIBRA" button that re-mounts the
//     wizard. The existing profile is preserved until the user finishes
//     the new one (no half-state).
//
// Audio side:
//   - We never disable audio during calibration — the user should hear
//     the synth react as they move. That gives them immediate feedback
//     and makes the tutorial steps actually playable.
//
// All strings flow through the i18n layer so the wizard switches language
// in lock-step with the lang toggle in HudControls.

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
  type ProfileTarget,
  type SampleChannel,
  type SampleStep,
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
   * Called when the user completes the wizard (or quits early with a
   * partial profile). The caller persists + applies the profile. Even
   * on quit we still emit so the caller can mark "user dismissed the
   * wizard" and not re-trigger on next boot.
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

export class CalibrationPanelImpl {
  private root: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private descEl: HTMLParagraphElement | null = null;
  private hintEl: HTMLParagraphElement | null = null;
  private progressFillEl: HTMLDivElement | null = null;
  private stepCounterEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private skipBtn: HTMLButtonElement | null = null;
  private quitBtn: HTMLButtonElement | null = null;
  private bigBarEl: HTMLDivElement | null = null;
  private bigBarFillEl: HTMLDivElement | null = null;
  private unsubLang: (() => void) | null = null;

  private deps: CalibrationPanelDeps | null = null;
  private gestureCb: ((state: GestureState) => void) | null = null;
  private faceCb: ((state: FaceState) => void) | null = null;

  /** Build the in-progress profile as we go. */
  private profile: CalibrationProfile = { ...DEFAULT_CALIBRATION };

  /** Current step index. */
  private idx = 0;
  /** Per-channel min/max accumulators for the active sample step. */
  private stats: Map<SampleChannel, ChannelStats> = new Map();
  /** ms when the current step started — drives sample-step countdown. */
  private stepStartMs = 0;
  /** Whether the current tutorial step has hit its timeoutHint. */
  private tutorialHintShown = false;
  /** Latest mouth-open value — captured from FaceTracker if present. */
  private mouthOpen = 0;
  /** RAF id for the per-frame UI tick. */
  private rafHandle: number | null = null;
  /** Set true when user closes / completes. Prevents double-complete. */
  private finished = false;

  /**
   * Mount the wizard into the given host element. Calling mount twice is a
   * no-op (idempotent).
   */
  mount(parent: HTMLElement, deps: CalibrationPanelDeps): void {
    if (this.root) return;
    injectStyles();
    this.deps = deps;
    // Stamp the webcam resolution into the profile (helps future-us detect
    // when the user's setup changed).
    if (deps.videoEl && deps.videoEl.videoWidth && deps.videoEl.videoHeight) {
      this.profile.videoWidth = deps.videoEl.videoWidth;
      this.profile.videoHeight = deps.videoEl.videoHeight;
    }

    const overlay = document.createElement('div');
    overlay.className = 'hs-calib-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hs-calib-title');

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

    // Title + description + hint.
    const title = document.createElement('h2');
    title.id = 'hs-calib-title';
    title.className = 'hs-calib-title';
    const desc = document.createElement('p');
    desc.className = 'hs-calib-desc';
    const hint = document.createElement('p');
    hint.className = 'hs-calib-hint';
    hint.hidden = true;

    // Big visual indicator — for sample steps shows live value strength;
    // for tutorial steps glows green when predicate true. Single element,
    // semantics decided per step.
    const bigBar = document.createElement('div');
    bigBar.className = 'hs-calib-bigbar';
    const bigBarFill = document.createElement('div');
    bigBarFill.className = 'hs-calib-bigbar-fill';
    bigBar.appendChild(bigBarFill);

    // Step-timer progress (thin bar). Drives the sample countdown.
    const progress = document.createElement('div');
    progress.className = 'hs-calib-progress';
    const progressFill = document.createElement('div');
    progressFill.className = 'hs-calib-progress-fill';
    progress.appendChild(progressFill);

    // Live status text — for sample steps "raccogliendo dati… X/Y", for
    // tutorial steps "in attesa del gesto…".
    const status = document.createElement('div');
    status.className = 'hs-calib-status';

    // Buttons.
    const buttons = document.createElement('div');
    buttons.className = 'hs-calib-buttons';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'hs-calib-btn hs-calib-btn-secondary';
    skip.addEventListener('click', () => this.advance(/* skipped */ true));
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'hs-calib-btn hs-calib-btn-primary';
    next.addEventListener('click', () => this.advance(false));
    next.disabled = true; // enabled when step completes
    buttons.append(skip, next);

    card.append(header, title, desc, hint, bigBar, progress, status, buttons);
    overlay.appendChild(card);
    parent.appendChild(overlay);

    this.root = overlay;
    this.titleEl = title;
    this.descEl = desc;
    this.hintEl = hint;
    this.progressFillEl = progressFill;
    this.stepCounterEl = counter;
    this.statusEl = status;
    this.nextBtn = next;
    this.skipBtn = skip;
    this.quitBtn = quit;
    this.bigBarEl = bigBar;
    this.bigBarFillEl = bigBarFill;

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
    this.titleEl = null;
    this.descEl = null;
    this.hintEl = null;
    this.progressFillEl = null;
    this.stepCounterEl = null;
    this.statusEl = null;
    this.nextBtn = null;
    this.skipBtn = null;
    this.quitBtn = null;
    this.bigBarEl = null;
    this.bigBarFillEl = null;

    this.deps = null;
    this.stats.clear();
  }

  /**
   * Re-apply localized labels onto the existing DOM. Cheap (string assigns
   * only) — called on mount + each step transition + each lang change.
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
    if (this.nextBtn) {
      const isLast = this.idx >= CALIBRATION_STEPS.length - 1;
      this.nextBtn.textContent = isLast ? t('calib.finish') : t('calib.next');
    }
    if (!step) return;
    if (this.titleEl) this.titleEl.textContent = t(step.titleKey);
    if (this.descEl) this.descEl.textContent = t(step.descKey);
    if (this.hintEl) {
      const hintKey = step.kind === 'tutorial' ? step.hintKey : undefined;
      if (hintKey) {
        this.hintEl.textContent = t(hintKey);
        // Don't show the hint until the timeout fires — applyLang preserves
        // the visible state set by the runtime.
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
    this.stepStartMs = performance.now();
    if (this.nextBtn) this.nextBtn.disabled = true;
    if (this.hintEl) this.hintEl.hidden = true;
    if (this.bigBarFillEl) this.bigBarFillEl.style.width = '0%';
    if (this.bigBarEl) this.bigBarEl.classList.remove('hs-calib-bigbar-ok');
    if (this.statusEl) this.statusEl.textContent = '';
    this.applyLang();
  }

  /**
   * Called from the per-frame tick. Drives:
   *  - progress bar fill (sample steps)
   *  - bigbar live value (sample → fraction of observed-span; tutorial →
   *    not used, predicate enables the "next" button instead)
   *  - tutorial hint reveal after timeoutHintMs
   *  - auto-complete on sample timer elapsed (still need user to click
   *    Next so they can verify; alternative: auto-advance, kept manual
   *    so a wrong reading can be redone via Skip+back)
   */
  private tickUi(): void {
    if (!this.root) return;
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    const now = performance.now();
    const elapsed = now - this.stepStartMs;

    if (step.kind === 'sample') {
      const frac = Math.min(1, elapsed / step.durationMs);
      if (this.progressFillEl) {
        this.progressFillEl.style.width = `${frac * 100}%`;
      }
      // Big bar shows how much "spread" we have so far — visual feedback
      // that the user is actually moving (not just standing still).
      const span = this.computeBestSpan();
      if (this.bigBarFillEl) {
        this.bigBarFillEl.style.width = `${Math.min(1, span / 0.6) * 100}%`;
      }
      if (this.statusEl) {
        const remainingSec = Math.max(0, Math.ceil((step.durationMs - elapsed) / 1000));
        this.statusEl.textContent =
          frac < 1
            ? t('calib.collecting', { s: remainingSec })
            : t('calib.collected');
      }
      // Once the timer elapses, enable Next so the user can confirm. If
      // they've moved (span > MIN), we visually "approve" the big bar.
      if (frac >= 1) {
        if (this.nextBtn) this.nextBtn.disabled = false;
        if (this.bigBarEl) this.bigBarEl.classList.add('hs-calib-bigbar-ok');
      }
    } else {
      // Tutorial step — progress bar shows the timeoutHintMs countdown
      // (purely visual; doesn't block completion).
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
      if (this.statusEl && !this.nextBtn?.disabled) {
        this.statusEl.textContent = t('calib.gestureOk');
      } else if (this.statusEl) {
        this.statusEl.textContent = t('calib.waitingGesture');
      }
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

  // -----------------------------------------------------------------------
  // Event handling
  // -----------------------------------------------------------------------

  private onGestureUpdate(state: GestureState): void {
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    if (step.kind === 'sample') this.sampleFrame(step, state);
    else this.checkTutorialPredicate(step, state);
  }

  private sampleFrame(step: SampleStep, state: GestureState): void {
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
  }

  private checkTutorialPredicate(step: TutorialStep, state: GestureState): void {
    const ok = step.predicate({
      meanHeight: state.meanHeight,
      meanDepth: state.meanDepth,
      handsDistance3D: state.handsDistance3D,
      rightOpenness: state.rightOpenness,
      leftOpenness: state.leftOpenness,
      bothFists: state.bothFists,
      mouthOpen: this.mouthOpen,
    });
    if (ok && this.nextBtn?.disabled) {
      // Enable Next and flash the big bar green. The user can pick when
      // to advance — pressing Next manually lets them practice the
      // gesture a few more times before moving on.
      if (this.nextBtn) this.nextBtn.disabled = false;
      if (this.bigBarEl) this.bigBarEl.classList.add('hs-calib-bigbar-ok');
      if (this.bigBarFillEl) this.bigBarFillEl.style.width = '100%';
    }
  }

  // -----------------------------------------------------------------------
  // Advance / finish
  // -----------------------------------------------------------------------

  private advance(skipped: boolean): void {
    const step = CALIBRATION_STEPS[this.idx];
    if (!step) return;
    if (step.kind === 'sample' && !skipped) {
      // Write the collected range into the profile.
      const range = this.flattenStats(step.channels);
      if (range) this.profile[step.target] = range;
    }
    // Move on.
    const nextIdx = this.idx + 1;
    if (nextIdx >= CALIBRATION_STEPS.length) {
      this.finish(/* quitEarly */ false);
      return;
    }
    this.beginStep(nextIdx);
  }

  /**
   * Combine the per-channel stats into a single CalibrationRange. When the
   * step samples multiple channels (e.g. openness sees both R and L), we
   * take the WIDEST observed envelope so future remap uses the most
   * permissive bounds.
   *
   * Returns null when there's no usable data (every channel below
   * MIN_SAMPLES). The caller leaves the profile field at DEFAULT_CALIBRATION
   * for that channel, which is identity remap downstream.
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
    // The tutorial is considered "completed" only if we made it past all
    // tutorial steps without quitting early. quitEarly=true means the
    // user closed the panel — leave tutorialCompleted as-is (which is
    // false unless an earlier successful run set it).
    if (!quitEarly) this.profile.tutorialCompleted = true;

    // Persist even on quit so we don't re-prompt on next launch (we
    // remember the user dismissed the wizard). If the user clicked
    // Quit on step 1 we still write a profile — albeit one with mostly
    // default ranges, which is fine (mapper falls back to identity).
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the float value of a SampleChannel from a GestureState. Returns
 * null when the channel isn't available this frame (e.g. rightPalmX when
 * the right hand isn't in view).
 *
 * Module-level so it's trivially unit-testable.
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

// Re-export for the panel users.
export { CALIBRATION_PHASE_STEPS, TUTORIAL_PHASE_STEPS, CALIBRATION_STEPS };
export type { CalibrationStep, ProfileTarget, SampleChannel, SampleStep, TutorialStep };
