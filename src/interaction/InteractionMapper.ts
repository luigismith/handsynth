// Owner: interaction-mapper
//
// Glue layer: subscribes to HandTracker events, derives audio params + music
// inputs, applies them. Owns the gesture→param mapping table:
//
//     handsDistance    -> filterCutoff       (200..12000 Hz, exp/log curve)
//     meanHeight       -> intensity (0..1)   AND  brightness (0..1)
//     rightOpenness    -> reverbWet (0.1..0.85) AND delayFeedback (0.1..0.7)
//     leftOpenness     -> saturatorDrive (0.8..2.6) AND filterResonance (0.5..14)
//     pinch (R) edge   -> harmony-aware lead stab in upper register
//     pinch (L) edge   -> music.advanceChord()
//     bothFists (level)-> audio.setMute(true while held)
//     bothAboveHead    -> audio.triggerDrop(true while held)
//     meanHeight series-> mood ('calm'|'rising'|'peak'|'release')
//     noHandsDuration  -> drone-mode fallback (low intensity, quiet pad)
//
// See ARCHITECTURE.md "Gesture mapping" section.

import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  GestureState,
  HandTracker,
  HandTrackerEvents,
  InteractionMapper,
  Mood,
  MusicBrain,
  MusicBrainEvents,
  MusicBrainInput,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';
import { stripOctave } from '@music/harmony';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const FILTER_MIN_HZ = 200;
const FILTER_MAX_HZ = 12000;
const REVERB_MIN = 0.1;
const REVERB_MAX = 0.85;
const DELAY_FB_MIN = 0.1;
const DELAY_FB_MAX = 0.7;
const DRIVE_MIN = 0.8;
const DRIVE_MAX = 2.6;
const Q_MIN = 0.5;
const Q_MAX = 14;

/** Pinch re-trigger debounce window. */
const PINCH_DEBOUNCE_MS = 120;

/** Mood detection: window in ms over which we average meanHeight. */
const MOOD_WINDOW_MS = 2000;
/** Required slope to declare 'rising' / 'release'. */
const MOOD_SLOPE_THRESHOLD = 0.08;
/** meanHeight value above which we may declare 'peak'. */
const MOOD_PEAK_LEVEL = 0.7;
/** Continuous time above peak level required to commit to 'peak'. */
const MOOD_PEAK_DWELL_MS = 1000;
/** Hysteresis: don't change mood faster than this. */
const MOOD_MIN_HOLD_MS = 250;

/** No-hands fallback engages at this elapsed time. */
const NO_HANDS_FALLBACK_SECONDS = 2.0;

/** Drone-mode targets (engaged when no hands detected for >2s). */
const DRONE_PARAMS: Partial<AudioEngineParams> = {
  filterCutoff: 800,
  brightness: 0.3,
  reverbWet: 0.7,
  masterDuck: 0.4,
};

/** Hands-back crossfade duration. */
const HANDS_BACK_FADE_MS = 1000;

/** Autopilot tick rate. */
const AUTOPILOT_HZ = 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Map [0..1] to [200..12000] Hz logarithmically (musical filter sweep). */
function mapDistanceToCutoff(distance: number): number {
  const x = clamp01(distance);
  const logMin = Math.log(FILTER_MIN_HZ);
  const logMax = Math.log(FILTER_MAX_HZ);
  return Math.exp(logMin + (logMax - logMin) * x);
}

function mapRightOpenness(o: number): { reverbWet: number; delayFeedback: number } {
  const x = clamp01(o);
  return {
    reverbWet: lerp(REVERB_MIN, REVERB_MAX, x),
    delayFeedback: lerp(DELAY_FB_MIN, DELAY_FB_MAX, x),
  };
}

function mapLeftOpenness(o: number): { saturatorDrive: number; filterResonance: number } {
  const x = clamp01(o);
  return {
    saturatorDrive: lerp(DRIVE_MIN, DRIVE_MAX, x),
    filterResonance: lerp(Q_MIN, Q_MAX, x),
  };
}

/** A timestamped meanHeight sample for the rolling window. */
interface MoodSample {
  t: number;
  v: number;
}

// ---------------------------------------------------------------------------
// InteractionMapperImpl
// ---------------------------------------------------------------------------

export class InteractionMapperImpl implements InteractionMapper {
  // Wired dependencies (set by attach()).
  private audio: AudioEngine | null = null;
  private music: MusicBrain | null = null;
  private hands: HandTracker | null = null;

  // State.
  private currentVibe: VibePreset | null = null;
  private currentMood: Mood = 'calm';
  private moodLastChangeMs = 0;
  private moodSamples: MoodSample[] = [];
  private peakDwellStartMs: number | null = null;

  /** Gestures processed via this mapper (real or autopilot). */
  private currentInputIntensity = 0;

  /** Last raw gesture state — used by the no-hands → hands-back crossfade. */
  private lastSeenState: GestureState | null = null;

  /** True while the no-hands fallback is engaged. */
  private inDroneMode = false;
  /** Fade progress 0..1 when transitioning back from drone mode. */
  private handsBackFade: { startMs: number; from: Partial<AudioEngineParams> } | null = null;

  /** Last param snapshot pushed to AudioEngine — used for crossfade source. */
  private lastParamSnapshot: Partial<AudioEngineParams> = {};

  /** Pinch debouncing. */
  private lastRightPinchMs = 0;
  private lastLeftPinchMs = 0;

  /** Bound listeners (so we can off() exactly the same fn refs). */
  private onGestureUpdate: HandTrackerEvents['gesture:update'] | null = null;
  private onPinchRight: HandTrackerEvents['gesture:pinch-right'] | null = null;
  private onPinchLeft: HandTrackerEvents['gesture:pinch-left'] | null = null;
  private onNoHands: HandTrackerEvents['gesture:no-hands'] | null = null;
  private onHandsBack: HandTrackerEvents['gesture:hands-back'] | null = null;

  /** MusicBrain subscription — kept for off(). */
  private musicSubscription: MusicBrainEvents | null = null;

  /** Last chord voicing (notes in scientific notation). For harmony-aware stab. */
  private lastChordNotes: string[] = [];

  /** Autopilot timer. */
  private autopilotTimer: ReturnType<typeof setInterval> | null = null;
  private autopilotPhase = 0;

  /** True while bothFists held (so we know to release mute on the next state). */
  private fistsHeld = false;
  private dropHeld = false;

  /** True after start() is called and before stop(). */
  private running = false;

  /** Frame budget: throttle setParams to every other frame. */
  private frameTick = 0;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  attach(deps: { audio: AudioEngine; music: MusicBrain; hands: HandTracker }): void {
    // Idempotent: store latest refs. If start() was already called, callers
    // are expected to stop() first; we do not rewire automatically.
    this.audio = deps.audio;
    this.music = deps.music;
    this.hands = deps.hands;
  }

  setVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    if (this.audio) this.audio.loadVibe(vibe);
    if (this.music) {
      this.music.setInput({
        intensity: this.currentInputIntensity,
        mood: this.currentMood,
        vibe,
      });
    }
  }

  start(): void {
    if (this.running) return; // idempotent — duplicate start() is a no-op
    if (!this.audio || !this.music || !this.hands) {
      throw new Error('[InteractionMapper] start() before attach()');
    }
    this.running = true;

    // Wire MusicBrain → AudioEngine.
    const subscription: MusicBrainEvents = {
      onLead: (e: NoteEvent) => this.audio?.triggerLead(e),
      onBass: (e: NoteEvent) => this.audio?.triggerBass(e),
      onChord: (e: ChordEvent) => {
        this.lastChordNotes = e.notes.slice();
        this.audio?.triggerChord(e);
      },
      onKick: (t: number | string) => this.audio?.triggerKick(t),
      onHat: (t: number | string) => this.audio?.triggerHat(t),
      onPerc: (t: number | string) => this.audio?.triggerPerc(t),
    };
    this.musicSubscription = subscription;
    this.music.on(subscription);

    // Wire HandTracker → mapper.
    this.onGestureUpdate = (s: GestureState) => this.handleGestureUpdate(s);
    this.onPinchRight = () => this.handleRightPinch();
    this.onPinchLeft = () => this.handleLeftPinch();
    this.onNoHands = () => this.handleNoHands();
    this.onHandsBack = () => this.handleHandsBack();

    this.hands.on('gesture:update', this.onGestureUpdate);
    this.hands.on('gesture:pinch-right', this.onPinchRight);
    this.hands.on('gesture:pinch-left', this.onPinchLeft);
    this.hands.on('gesture:no-hands', this.onNoHands);
    this.hands.on('gesture:hands-back', this.onHandsBack);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.hands) {
      if (this.onGestureUpdate)
        this.hands.off('gesture:update', this.onGestureUpdate);
      if (this.onPinchRight)
        this.hands.off('gesture:pinch-right', this.onPinchRight);
      if (this.onPinchLeft)
        this.hands.off('gesture:pinch-left', this.onPinchLeft);
      if (this.onNoHands) this.hands.off('gesture:no-hands', this.onNoHands);
      if (this.onHandsBack)
        this.hands.off('gesture:hands-back', this.onHandsBack);
    }
    this.onGestureUpdate = null;
    this.onPinchRight = null;
    this.onPinchLeft = null;
    this.onNoHands = null;
    this.onHandsBack = null;

    if (this.music && this.musicSubscription) {
      this.music.off(this.musicSubscription);
    }
    this.musicSubscription = null;

    this.stopAutopilot();
  }

  // -------------------------------------------------------------------------
  // Public extras (not in interface)
  // -------------------------------------------------------------------------

  getCurrentMood(): Mood {
    return this.currentMood;
  }

  /**
   * Drive the mapper from a synthetic gesture stream when no webcam is
   * available. Slow sinusoidal wandering on meanHeight + handsDistance, with
   * occasional pinch triggers. Runs at ~60 Hz via setInterval.
   */
  startAutopilot(): void {
    if (this.autopilotTimer) return;
    this.autopilotPhase = 0;
    const intervalMs = 1000 / AUTOPILOT_HZ;
    this.autopilotTimer = setInterval(() => {
      this.autopilotPhase += intervalMs / 1000;
      const t = this.autopilotPhase;

      // Slow wandering: meanHeight oscillates ~30s period, handsDistance ~17s.
      const meanHeight = clamp01(0.5 + 0.4 * Math.sin((2 * Math.PI * t) / 30));
      const handsDistance = clamp01(0.5 + 0.3 * Math.sin((2 * Math.PI * t) / 17));
      const rightOpenness = clamp01(0.5 + 0.45 * Math.sin((2 * Math.PI * t) / 11));
      const leftOpenness = clamp01(0.5 + 0.4 * Math.cos((2 * Math.PI * t) / 13));

      // Periodic chord advance every ~8s, stab every ~5s — phased apart.
      const wantChord =
        Math.floor(t / 8) !== Math.floor((t - intervalMs / 1000) / 8);
      const wantStab =
        Math.floor((t - 2) / 5) !==
        Math.floor((t - 2 - intervalMs / 1000) / 5);

      const synthState: GestureState = {
        hands: [],
        bothHandsDetected: true,
        handsDistance,
        meanHeight,
        rightOpenness,
        leftOpenness,
        rightPinchActive: false,
        leftPinchActive: false,
        bothFists: false,
        bothAboveHead: false,
        fingerCount: 8,
        noHandsDuration: 0,
      };

      this.handleGestureUpdate(synthState);
      if (wantChord) this.handleLeftPinch();
      if (wantStab) this.handleRightPinch();
    }, intervalMs);
  }

  stopAutopilot(): void {
    if (!this.autopilotTimer) return;
    clearInterval(this.autopilotTimer);
    this.autopilotTimer = null;
  }

  // -------------------------------------------------------------------------
  // Gesture handling
  // -------------------------------------------------------------------------

  private handleGestureUpdate(state: GestureState): void {
    this.lastSeenState = state;

    // No-hands fallback engages within the gesture stream itself: HandTracker
    // also emits 'gesture:no-hands' but we double-check from state to be
    // robust to ordering.
    if (state.noHandsDuration > NO_HANDS_FALLBACK_SECONDS) {
      this.engageDroneMode();
      return;
    }

    // bothFists → hard mute while held.
    if (state.bothFists && !this.fistsHeld) {
      this.fistsHeld = true;
      this.audio?.setMute(true);
    } else if (!state.bothFists && this.fistsHeld) {
      this.fistsHeld = false;
      this.audio?.setMute(false);
    }

    // bothAboveHead → drop while held.
    if (state.bothAboveHead && !this.dropHeld) {
      this.dropHeld = true;
      this.audio?.triggerDrop(true);
    } else if (!state.bothAboveHead && this.dropHeld) {
      this.dropHeld = false;
      this.audio?.triggerDrop(false);
    }

    // Continuous mappings.
    const cutoff = mapDistanceToCutoff(state.handsDistance);
    const intensity = clamp01(state.meanHeight);
    const brightness = clamp01(state.meanHeight);
    const { reverbWet, delayFeedback } = mapRightOpenness(state.rightOpenness);
    const { saturatorDrive, filterResonance } = mapLeftOpenness(
      state.leftOpenness,
    );

    let target: Partial<AudioEngineParams> = {
      filterCutoff: cutoff,
      brightness,
      reverbWet,
      delayFeedback,
      saturatorDrive,
      filterResonance,
      masterDuck: 0,
    };

    // Hands-back crossfade: blend from drone params back to gesture-driven.
    if (this.handsBackFade) {
      const elapsed = performance.now() - this.handsBackFade.startMs;
      const t = clamp01(elapsed / HANDS_BACK_FADE_MS);
      target = blendParams(this.handsBackFade.from, target, t);
      if (t >= 1) this.handsBackFade = null;
    }

    // Mood detection (independent of param push throttle).
    this.updateMood(state.meanHeight);

    // Push intensity / mood to MusicBrain whenever it changes meaningfully.
    this.currentInputIntensity = intensity;
    this.pushMusicInput();

    // Throttle param push to every other frame (AudioEngine ramps internally).
    this.frameTick = (this.frameTick + 1) & 1;
    if (this.frameTick === 0 || this.handsBackFade) {
      this.audio?.setParams(target);
      this.lastParamSnapshot = target;
    }

    // If we just left drone mode, this update path is fine — clear the flag.
    if (this.inDroneMode) {
      this.inDroneMode = false;
    }
  }

  private handleRightPinch(): void {
    const now = performance.now();
    if (now - this.lastRightPinchMs < PINCH_DEBOUNCE_MS) return;
    this.lastRightPinchMs = now;
    this.triggerStab();
  }

  private handleLeftPinch(): void {
    const now = performance.now();
    if (now - this.lastLeftPinchMs < PINCH_DEBOUNCE_MS) return;
    this.lastLeftPinchMs = now;
    this.music?.advanceChord();
  }

  private handleNoHands(): void {
    this.engageDroneMode();
  }

  private handleHandsBack(): void {
    if (!this.inDroneMode) return;
    // Begin a 1s fade from current drone params back toward gesture-driven.
    this.handsBackFade = {
      startMs: performance.now(),
      from: { ...this.lastParamSnapshot },
    };
    this.inDroneMode = false;
  }

  // -------------------------------------------------------------------------
  // Drone mode
  // -------------------------------------------------------------------------

  private engageDroneMode(): void {
    if (this.inDroneMode) return;
    this.inDroneMode = true;

    if (!this.currentVibe) return;
    this.music?.setInput({
      intensity: 0.15,
      mood: 'calm',
      vibe: this.currentVibe,
    });
    this.audio?.setParams(DRONE_PARAMS);
    this.lastParamSnapshot = { ...DRONE_PARAMS };
  }

  // -------------------------------------------------------------------------
  // Mood detection
  // -------------------------------------------------------------------------

  /**
   * Windowed mood detection.
   *
   * Algorithm:
   *  - Maintain a rolling buffer of (timestamp, meanHeight) for the last
   *    MOOD_WINDOW_MS (2s).
   *  - Compute the slope of meanHeight over the window via simple endpoint
   *    diff (newest avg - oldest avg).
   *  - peak: meanHeight has been > MOOD_PEAK_LEVEL continuously for >1s.
   *  - rising: slope > +threshold and current > 0.4
   *  - release: slope < -threshold
   *  - calm: otherwise
   *  - Hysteresis: hold each mood at least MOOD_MIN_HOLD_MS before changing.
   */
  private updateMood(meanHeight: number): void {
    const now = performance.now();
    this.moodSamples.push({ t: now, v: meanHeight });
    // Drop samples older than the window.
    const cutoff = now - MOOD_WINDOW_MS;
    while (this.moodSamples.length > 0 && this.moodSamples[0]!.t < cutoff) {
      this.moodSamples.shift();
    }
    // Track peak dwell (continuous time above MOOD_PEAK_LEVEL).
    if (meanHeight > MOOD_PEAK_LEVEL) {
      if (this.peakDwellStartMs === null) this.peakDwellStartMs = now;
    } else {
      this.peakDwellStartMs = null;
    }

    // Need at least a couple samples and a meaningful span.
    if (this.moodSamples.length < 3) return;

    const oldestN = Math.max(2, Math.floor(this.moodSamples.length * 0.25));
    const newestN = oldestN;
    const oldAvg = avg(this.moodSamples.slice(0, oldestN).map((s) => s.v));
    const newAvg = avg(
      this.moodSamples.slice(this.moodSamples.length - newestN).map((s) => s.v),
    );
    const slope = newAvg - oldAvg;

    let next: Mood = 'calm';
    if (
      this.peakDwellStartMs !== null &&
      now - this.peakDwellStartMs >= MOOD_PEAK_DWELL_MS
    ) {
      next = 'peak';
    } else if (slope > MOOD_SLOPE_THRESHOLD && newAvg > 0.4) {
      next = 'rising';
    } else if (slope < -MOOD_SLOPE_THRESHOLD) {
      next = 'release';
    } else {
      next = 'calm';
    }

    if (next !== this.currentMood && now - this.moodLastChangeMs >= MOOD_MIN_HOLD_MS) {
      this.currentMood = next;
      this.moodLastChangeMs = now;
    }
  }

  private pushMusicInput(): void {
    if (!this.music || !this.currentVibe) return;
    const input: MusicBrainInput = {
      intensity: this.currentInputIntensity,
      mood: this.currentMood,
      vibe: this.currentVibe,
    };
    this.music.setInput(input);
  }

  // -------------------------------------------------------------------------
  // Harmony-aware stab — picks a chord-tone in the upper register.
  // -------------------------------------------------------------------------

  private triggerStab(): void {
    if (!this.audio) return;
    const notes = this.lastChordNotes;
    if (notes.length === 0) {
      this.audio.triggerStab();
      return;
    }
    const idx = Math.floor(Math.random() * notes.length);
    const pick = notes[idx];
    if (!pick) {
      this.audio.triggerStab();
      return;
    }
    const pitch = `${stripOctave(pick)}5`;
    const event: NoteEvent = {
      pitch,
      duration: '8n',
      velocity: 0.95,
      time: '+0.005',
    };
    this.audio.triggerLead(event);
  }
}

// ---------------------------------------------------------------------------
// Utility: blend two partial param objects.
// ---------------------------------------------------------------------------

function blendParams(
  from: Partial<AudioEngineParams>,
  to: Partial<AudioEngineParams>,
  t: number,
): Partial<AudioEngineParams> {
  const keys = new Set<keyof AudioEngineParams>([
    ...(Object.keys(from) as (keyof AudioEngineParams)[]),
    ...(Object.keys(to) as (keyof AudioEngineParams)[]),
  ]);
  const out: Partial<AudioEngineParams> = {};
  for (const k of keys) {
    const a = from[k];
    const b = to[k];
    if (typeof a === 'number' && typeof b === 'number') {
      out[k] = lerp(a, b, t);
    } else if (typeof b === 'number') {
      out[k] = b;
    } else if (typeof a === 'number') {
      out[k] = a;
    }
  }
  return out;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// Re-export helpers for testing.
export const __testing = {
  mapDistanceToCutoff,
  mapRightOpenness,
  mapLeftOpenness,
  blendParams,
  clamp,
  clamp01,
  lerp,
};
