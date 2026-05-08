// Owner: interaction-mapper
//
// Glue layer: subscribes to HandTracker events, derives audio params + music
// inputs, applies them. Owns the gesture→param mapping table:
//
// 2D mappings (XY-only, original):
//     handsDistance    -> filterCutoff       (200..12000 Hz, exp/log curve)
//                         (NOTE: now superseded by handsDistance3D — see below)
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
// 3D mappings (depth + palm rotation, additive on top of the hand-XY target):
//     meanDepth        -> masterDuck (inverse, 0.4 far → 0 close — hands closer
//                         = louder; pulls listener IN as user moves toward cam)
//     rightRoll        -> brightness fine-tune (±HAND_3D_BRIGHTNESS_GAIN)
//     leftRoll         -> saturatorDrive fine-tune (±HAND_3D_DRIVE_GAIN)
//     handsDistance3D  -> filterCutoff (replaces 2D handsDistance for cutoff;
//                         responds to in/out-of-camera depth, not just sideways)
//     meanPitch        -> delayFeedback fine-tune (±HAND_3D_DELAY_FB_GAIN)
//
// Application order: hand-XY → target → hand-3D additions → face modulators →
// push.
//
// See ARCHITECTURE.md "Gesture mapping" section.

import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  FaceState,
  FaceTracker,
  FaceTrackerEvents,
  GestureEvent,
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
import { GestureInterpreter } from '@hands/GestureInterpreter';
import { FACTORY_PRESETS } from '@presets/factory-presets';

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

// ---------------------------------------------------------------------------
// Discrete-gesture pulse mapping constants.
//
// Each "pulse" gesture (point, peace, rock_on, ok, finger_gun, fist_pump…)
// pushes a timed offset onto a small register inside the mapper, then linearly
// decays it back to zero across PULSE_DECAY_MS milliseconds. The decay runs
// inside the existing gesture-update path so it doesn't need its own ticker.
//
// Rationale for using time-decayed offsets rather than direct setParams calls:
//   - The hand-driven baseline keeps moving; a static set would be erased on
//     the next frame.
//   - The user has explicitly asked for "spike + decay" semantics in the brief.
//   - The diff-based setParams in this module already collapses unchanged
//     pushes, so the decaying offsets are not extra audio work when the
//     baseline doesn't move.
// ---------------------------------------------------------------------------

/** point: filter Q spike +6 for 600 ms then decay. */
const POINT_Q_SPIKE = 6;
const POINT_DECAY_MS = 600;

/** rock_on: distortion +0.35 for 1.5 s then decay. */
const ROCK_DRIVE_PULSE = 0.35;
const ROCK_DECAY_MS = 1500;

/** ok: tape-flutter — delay feedback +0.2 for 1 s then decay. */
const OK_DELAY_FB_PULSE = 0.2;
const OK_DECAY_MS = 1000;

/** peace: brightness pulse — MusicBrain has no setVibrato, so we lift
 * brightness +0.3 for 800 ms instead. Documented per the brief: if a target
 * API doesn't exist, do the most musically sensible existing-API
 * approximation. The vibrato semantics map naturally to a brightness sweep
 * because both are perceived as a "shimmer" on the lead. */
const PEACE_BRIGHT_PULSE = 0.3;
const PEACE_DECAY_MS = 800;

/** fist_pump (both hands): "drop bomb" — delay feedback +0.3 + reverb +0.3
 *  for 1.5 s then decay. Both-hands gating is enforced in the handler. */
const BOMB_DELAY_FB_PULSE = 0.3;
const BOMB_REVERB_PULSE = 0.3;
const BOMB_DECAY_MS = 1500;

/** wave: continuous tremolo wobble — implemented as a low-frequency LFO on
 * `brightness` (since no tremolo API exists on AudioEngine). Documented
 * per the brief. The wobble depth scales linearly with the wave_level. */
const WAVE_BRIGHTNESS_DEPTH = 0.25;
const WAVE_LFO_HZ = 5;

// ---------------------------------------------------------------------------
// Face → audio param mapping constants.
//
// Face is an *additive modulator* on top of the hand-driven signal. All
// contributions are zero when no FaceTracker is attached or no face has been
// seen. See ARCHITECTURE.md §"Head tracking" for the design rationale.
//
//   apparentSize (0=far, 1=close) -> reverbWet override blend
//      lerp(REVERB_FAR, REVERB_NEAR, apparentSize) replaces the hand reverb
//      contribution by a weighted blend (FACE_REVERB_BLEND).
//   pose.roll  -> brightness offset (±FACE_BRIGHTNESS_GAIN around hand value)
//   pose.yaw   -> filterResonance offset (±FACE_RESONANCE_GAIN)
//   pose.pitch -> intensity boost (+FACE_INTENSITY_GAIN * sin(pitch))
//   mouthOpen  -> rising-edge stab trigger + 4-dim continuous controller
//   eyesWide   -> reverbWet additive lift (+FACE_EYES_WIDE_REVERB_GAIN) AND
//                 filterResonance Q boost (+FACE_EYES_WIDE_Q_GAIN, clamped).
//                 "Explosive" sound when the user widens their eyes — pairs
//                 with the Superman laser-eye visual.
//   smile      -> brightness lift +FACE_SMILE_BRIGHTNESS_GAIN, masterDuck
//                 reduction -FACE_SMILE_DUCK_REDUCE (smile = brighter, louder).
//   frown      -> filterCutoff cap toward FACE_FROWN_CUTOFF_FLOOR Hz at full
//                 frown (sound darkens / introverted).
//   surprise   -> reverbWet boost +FACE_SURPRISE_REVERB_GAIN, delayFeedback
//                 boost +FACE_SURPRISE_DELAY_FB_GAIN (sound opens up).
//   anger      -> saturatorDrive boost +FACE_ANGER_DRIVE_GAIN (clamped),
//                 filterResonance peak +FACE_ANGER_Q_GAIN (clamped to Q_MAX).
//   noFaceDuration > face-lost threshold -> masterDuck += FACE_LOST_DUCK
// ---------------------------------------------------------------------------

/** apparentSize=0 (far) -> wet 0.65; apparentSize=1 (close) -> wet 0.15. */
const FACE_REVERB_FAR = 0.65;
const FACE_REVERB_NEAR = 0.15;
/** Blend weight: 1 = face fully overrides hand reverb, 0 = no contribution. */
const FACE_REVERB_BLEND = 0.6;

/** roll modulates brightness by ±FACE_BRIGHTNESS_GAIN. */
const FACE_BRIGHTNESS_GAIN = 0.15;
/** Approx half-range of useful head tilt (rad). */
const FACE_BRIGHTNESS_ROLL_SCALE = 0.6;

/** yaw modulates resonance by ±FACE_RESONANCE_GAIN (in Q units). */
const FACE_RESONANCE_GAIN = 5;
const FACE_RESONANCE_YAW_SCALE = 0.6;

/** pitch lifts intensity by +FACE_INTENSITY_GAIN * sin(pitch). */
const FACE_INTENSITY_GAIN = 0.15;

/** Mouth-open rising edge threshold for stab trigger. */
const FACE_MOUTH_STAB_THRESHOLD = 0.6;
/** Mouth-open falling edge (with hysteresis) before re-arming the stab. */
const FACE_MOUTH_STAB_RELEASE = 0.4;
/** Stab debounce window. */
const FACE_MOUTH_STAB_DEBOUNCE_MS = 200;

/** Threshold (seconds) for face-lost masterDuck nudge. */
const FACE_LOST_DUCK_AFTER_SEC = 1.5;
/** Additive masterDuck while face is lost. */
const FACE_LOST_DUCK = 0.15;

// ---------------------------------------------------------------------------
// Hand 3D additive modulation constants. The hand 3D contributions are
// applied on top of the hand-XY-derived target object, BEFORE the face
// modulators are composed (so the face overlay still gets the last word
// where it overrides).
// ---------------------------------------------------------------------------

/** rightRoll modulates brightness by ±HAND_3D_BRIGHTNESS_GAIN. */
const HAND_3D_BRIGHTNESS_GAIN = 0.15;
/** leftRoll modulates saturatorDrive by ±HAND_3D_DRIVE_GAIN. */
const HAND_3D_DRIVE_GAIN = 0.4;
/** meanPitch modulates delayFeedback by ±HAND_3D_DELAY_FB_GAIN. */
const HAND_3D_DELAY_FB_GAIN = 0.15;
/** masterDuck when hands are at meanDepth=0 (far). 0 when meanDepth=1 (close). */
const HAND_3D_DUCK_FAR = 0.4;

/**
 * Mouth-open is the FOURTH continuous controller (beside hand distance,
 * height, and openness). It modulates four audio dimensions simultaneously
 * so the user gets unmistakable, body-felt feedback when they open their
 * mouth — a single subtle parameter sweep wasn't perceived over the
 * baseline groove. Effects, ranked by audibility:
 *
 *   1. delayWet  — full sweep from BASE→FULL (huge "echoey" change)
 *   2. filterCutoff additive lift  — opens up the master filter (bright)
 *   3. reverbWet additive lift     — adds space / wash
 *   4. brightness lift             — sweetens lead voice
 *
 * The rising-edge stab trigger (one-shot lead chord-tone) is independent
 * of the continuous controls and still fires on a hard mouth-open.
 */
const FACE_MOUTH_DELAY_BASE = 0.15;
const FACE_MOUTH_DELAY_FULL = 0.85;
/** Hz added to filterCutoff when mouth is fully open. */
const FACE_MOUTH_CUTOFF_LIFT = 6000;
/** 0..1 added to reverbWet when mouth is fully open. */
const FACE_MOUTH_REVERB_LIFT = 0.3;
/** 0..1 added to brightness when mouth is fully open. */
const FACE_MOUTH_BRIGHTNESS_GAIN = 0.4;

/**
 * Eyes-wide additive contributions, layered on top of the hand-derived
 * target. eyesWide=1 -> +0.25 reverbWet AND +4 Q. The combination lifts
 * the wash and pinches the resonance — together they read as "explosive"
 * even when the underlying gesture mix is quiet. Pairs with the Superman
 * laser-eye visual.
 */
const FACE_EYES_WIDE_REVERB_GAIN = 0.25;
const FACE_EYES_WIDE_Q_GAIN = 4;

/**
 * Expression contributions. Each is layered AFTER the eyesWide / mouth / pose
 * blocks so the four discrete expressions are the loudest interpretive layer.
 * Calibrations:
 *   - smile: at full smile, brightness gets +0.2 and masterDuck is reduced
 *     by 0.15 — so smiling literally makes the room brighter and louder.
 *   - frown: at full frown, master cutoff is pulled toward 1500 Hz (dark).
 *   - surprise: +0.3 reverbWet, +0.1 delayFeedback at full surprise (opens up).
 *   - anger: +0.6 saturatorDrive (clamped to DRIVE_MAX), +5 Q (clamped to Q_MAX).
 */
const FACE_SMILE_BRIGHTNESS_GAIN = 0.2;
const FACE_SMILE_DUCK_REDUCE = 0.15;
const FACE_FROWN_CUTOFF_FLOOR = 1500;
const FACE_SURPRISE_REVERB_GAIN = 0.3;
const FACE_SURPRISE_DELAY_FB_GAIN = 0.1;
const FACE_ANGER_DRIVE_GAIN = 0.6;
const FACE_ANGER_Q_GAIN = 5;

/**
 * Lower bound on the intensity pushed into MusicBrain. Re-maps the gesture's
 * meanHeight ∈ [0, 1] to [INTENSITY_FLOOR, 1] so the music has continuous
 * presence even when the user's hands rest at chest level. Tested at 0.45 in
 * the autonomous browser harness — at that floor, density=2 (eighths) +
 * mood='rising' (non-sparse leads) produces a rich, continuous bed; lifting
 * hands toward the top of the frame still escalates to peak/sixteenths.
 */
const INTENSITY_FLOOR = 0.45;

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
  private face: FaceTracker | null = null;

  // Latest face state — null until the FaceTracker emits at least once. The
  // mapper tolerates `null` for the entire session (hand-only mode).
  private lastFace: FaceState | null = null;
  /** Mouth-open hysteresis state (true between rising edge and release). */
  private mouthOpenHigh = false;
  /** Last mouth stab fire time, for debounce. */
  private lastMouthStabMs = 0;

  // State.
  private currentVibe: VibePreset | null = null;
  private currentMood: Mood = 'calm';
  private moodLastChangeMs = 0;
  private moodSamples: MoodSample[] = [];
  private peakDwellStartMs: number | null = null;

  /**
   * Gestures processed via this mapper (real or autopilot). Seed at 0.5 so
   * that even before any GestureState arrives (e.g., the user hasn't put
   * their hands in frame yet), the MusicBrain runs at meaningful density
   * instead of degenerating to sparse single hits.
   */
  private currentInputIntensity = 0.5;

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
  /** Bound face listener (kept for off()). */
  private onFaceUpdate: FaceTrackerEvents['face:update'] | null = null;

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
  // Discrete-gesture interpreter — owned by the mapper. Subscribed in
  // start(), unsubscribed in stop(). Driven from `handleGestureUpdate`
  // by extracting left/right Hand objects from the GestureState.
  // -------------------------------------------------------------------------
  private interpreter: GestureInterpreter | null = null;
  private onGestureEvent: ((e: GestureEvent) => void) | null = null;

  /** Time-decay registers for the discrete-gesture pulses. Each entry
   * stores when the pulse started and its peak magnitude; we recompute the
   * remaining contribution every frame. */
  private pointPulseStartMs: number | null = null;
  private rockPulseStartMs: number | null = null;
  private okPulseStartMs: number | null = null;
  private peacePulseStartMs: number | null = null;
  private bombPulseStartMs: number | null = null;

  /** Current wave level (0..1) — continuous controller, no decay. */
  private waveLevel = 0;
  /** Index into the current factory preset list — for swipe prev/next. */
  private factoryPresetIndex = 0;
  /** Pending fist_pump fires per hand for the both-hand gating window. */
  private leftFistPumpAtMs = -Infinity;
  private rightFistPumpAtMs = -Infinity;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  attach(deps: {
    audio: AudioEngine;
    music: MusicBrain;
    hands: HandTracker;
    face?: FaceTracker;
  }): void {
    // Idempotent: store latest refs. If start() was already called, callers
    // are expected to stop() first; we do not rewire automatically.
    this.audio = deps.audio;
    this.music = deps.music;
    this.hands = deps.hands;
    this.face = deps.face ?? null;
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

    // Wire FaceTracker -> mapper if present. Face is an additive modulator on
    // top of the hand-driven param stream; we only need 'face:update' here.
    // Mouth-open rising-edge stabs are detected inside the same handler so we
    // don't have to introduce a separate event in the contract.
    if (this.face) {
      this.onFaceUpdate = (s: FaceState) => this.handleFaceUpdate(s);
      this.face.on('face:update', this.onFaceUpdate);
    }

    // Wire the discrete-gesture interpreter. We feed it from inside
    // `handleGestureUpdate` so its clock advances in lockstep with the
    // HandTracker's emit rate. Listener routes to `handleGestureEvent`,
    // which dispatches to the per-event handlers below.
    this.interpreter = new GestureInterpreter();
    this.onGestureEvent = (e) => this.handleGestureEvent(e);
    this.interpreter.on('gesture', this.onGestureEvent);
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

    if (this.face && this.onFaceUpdate) {
      this.face.off('face:update', this.onFaceUpdate);
    }
    this.onFaceUpdate = null;
    this.lastFace = null;
    this.mouthOpenHigh = false;

    if (this.interpreter && this.onGestureEvent) {
      this.interpreter.off('gesture', this.onGestureEvent);
    }
    this.interpreter = null;
    this.onGestureEvent = null;

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

  /** Read-only snapshot for the debug panel. */
  getCurrentIntensity(): number {
    return this.currentInputIntensity;
  }

  /**
   * Manually pin intensity (debug-panel slider). Pass `null` to release the
   * override and let gestures drive the value again.
   */
  setManualIntensity(v: number | null): void {
    if (v === null) {
      this.manualIntensity = null;
      return;
    }
    this.manualIntensity = clamp01(v);
    this.currentInputIntensity = this.manualIntensity;
    this.pushMusicInput();
  }

  /** Internal: when set, gesture-driven updates ignore meanHeight intensity. */
  private manualIntensity: number | null = null;

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
        meanDepth: 0.5,
        rightRoll: 0,
        leftRoll: 0,
        handsDistance3D: handsDistance,
        meanPitch: 0,
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

    // Feed the discrete-gesture interpreter. It internally edge-detects
    // shape changes and velocity gestures; events arrive through
    // `handleGestureEvent` (set up in start()).
    if (this.interpreter) {
      const left = state.hands.find((h) => h.side === 'left');
      const right = state.hands.find((h) => h.side === 'right');
      this.interpreter.ingestHands({ left, right });
    }

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
    // Cutoff now responds to 3D hand-to-hand distance (was 2D handsDistance).
    // This means the filter sweep also tracks the user's hands moving in/out
    // of camera depth, not just sideways spread. The 2D handsDistance field
    // is preserved on GestureState for any downstream consumer that wants
    // the pure-image-plane signal.
    const cutoff = mapDistanceToCutoff(state.handsDistance3D);
    // Intensity floor: even with hands resting at chest level the music
    // should feel rich, not skeletal. Re-map [0, 1] → [INTENSITY_FLOOR, 1]
    // so users can still raise hands for density but never hit the dead
    // zone where leads/bass barely fire.
    const intensity = clamp01(
      INTENSITY_FLOOR + (1 - INTENSITY_FLOOR) * state.meanHeight,
    );
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

    // Hand 3D additive modulation. meanDepth → masterDuck (close=loud),
    // rightRoll → brightness offset, leftRoll → saturatorDrive offset,
    // meanPitch → delayFeedback offset. Applied BEFORE face modulation so
    // the face layer still wins where it composes on top.
    target = this.applyHand3DModulation(target, state);

    // Face additive modulation. Only contributes when a FaceTracker is
    // attached AND has emitted at least one detected state. All branches are
    // tolerant of `lastFace === null` (no-op).
    target = this.applyFaceModulation(target);

    // Discrete-gesture pulses (point/peace/rock_on/ok/fist_pump bomb) and
    // the continuous wave_level wobble. Applied AFTER face modulation so
    // the deliberate one-shot gestures always sit on top of the mix.
    target = this.applyDiscreteGesturePulses(target);

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
    // If a manual override is active (debug panel slider), it wins over the
    // gesture-derived value. Face pitch contributes a small additive boost
    // (chin up = denser) after the mood logic — see applyFaceIntensityBoost.
    const baseIntensity =
      this.manualIntensity !== null ? this.manualIntensity : intensity;
    this.currentInputIntensity = clamp01(
      baseIntensity + this.faceIntensityBoost(),
    );
    this.pushMusicInput();

    // Push params, but ONLY the keys whose value changed meaningfully
    // since the last frame. Two wins:
    //   1) Gestures that move are reflected immediately (every-other-frame
    //      throttle removed — fixes "audio sensitivity to movement").
    //   2) Static gestures don't re-fire ramps every frame, so Tone's
    //      scheduler queue stays bounded even with hands+mouth+eyes all
    //      driving setParams (fixes the freeze regression that the
    //      throttle was originally added to mitigate).
    const diff = diffParams(this.lastParamSnapshot, target);
    if (diff || this.handsBackFade) {
      this.audio?.setParams(diff ?? target);
      this.lastParamSnapshot = target;
    }
    void this.frameTick;

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
  // Face modulation
  // -------------------------------------------------------------------------

  /**
   * Edge-detect mouth-open and update the cached face state. Hand-driven
   * `handleGestureUpdate` reads `this.lastFace` to apply additive modulation.
   *
   * Stabs trigger on a rising edge through `FACE_MOUTH_STAB_THRESHOLD`, and
   * re-arm only after mouthOpen falls below `FACE_MOUTH_STAB_RELEASE`
   * (hysteresis) and the debounce window has elapsed.
   */
  private handleFaceUpdate(state: FaceState): void {
    this.lastFace = state;

    // Mouth-open rising edge -> stab. Hand-driven stabs already fire from the
    // right pinch; this is the face-driven equivalent. We funnel through the
    // same triggerStab() so it remains harmony-aware when chord context is
    // present.
    if (state.detected) {
      if (!this.mouthOpenHigh && state.mouthOpen >= FACE_MOUTH_STAB_THRESHOLD) {
        const now = performance.now();
        if (now - this.lastMouthStabMs >= FACE_MOUTH_STAB_DEBOUNCE_MS) {
          this.lastMouthStabMs = now;
          this.triggerStab();
        }
        this.mouthOpenHigh = true;
      } else if (
        this.mouthOpenHigh &&
        state.mouthOpen <= FACE_MOUTH_STAB_RELEASE
      ) {
        this.mouthOpenHigh = false;
      }
    } else {
      // Face left the frame — disarm so the next time it re-appears with
      // mouth open we get a fresh rising edge.
      this.mouthOpenHigh = false;
    }
  }

  /**
   * Hand 3D additive modulation — applied on top of the hand-XY-derived
   * `target`, BEFORE face modulators run. Each contribution is bounded and
   * tolerant of zero-hand frames (where the smoothed signals carry their
   * default 0 / 0.5).
   *
   *   meanDepth (0=far, 1=close) → masterDuck = lerp(HAND_3D_DUCK_FAR, 0, depth)
   *     ⇒ closer hands = louder. Pulls the listener IN as the user moves
   *     toward the camera.
   *   rightRoll (−1..1) → brightness += roll * HAND_3D_BRIGHTNESS_GAIN
   *   leftRoll  (−1..1) → saturatorDrive += roll * HAND_3D_DRIVE_GAIN
   *   meanPitch (−1..1) → delayFeedback += pitch * HAND_3D_DELAY_FB_GAIN
   */
  private applyHand3DModulation(
    target: Partial<AudioEngineParams>,
    state: GestureState,
  ): Partial<AudioEngineParams> {
    const out: Partial<AudioEngineParams> = { ...target };

    // Depth → masterDuck. Far (depth=0) ducks the master by HAND_3D_DUCK_FAR;
    // close (depth=1) leaves the master un-ducked. Additive on whatever
    // baseline target.masterDuck the upstream hand-XY mapping set.
    const depth = clamp01(state.meanDepth);
    const handDuck = typeof out.masterDuck === 'number' ? out.masterDuck : 0;
    out.masterDuck = clamp01(handDuck + lerp(HAND_3D_DUCK_FAR, 0, depth));

    // Right-hand roll → brightness fine-tune.
    const rRoll = clamp(state.rightRoll, -1, 1);
    const baseBright =
      typeof out.brightness === 'number' ? out.brightness : 0.5;
    out.brightness = clamp01(baseBright + rRoll * HAND_3D_BRIGHTNESS_GAIN);

    // Left-hand roll → saturatorDrive fine-tune.
    const lRoll = clamp(state.leftRoll, -1, 1);
    const baseDrive =
      typeof out.saturatorDrive === 'number' ? out.saturatorDrive : DRIVE_MIN;
    out.saturatorDrive = clamp(
      baseDrive + lRoll * HAND_3D_DRIVE_GAIN,
      DRIVE_MIN,
      DRIVE_MAX,
    );

    // Mean pitch → delayFeedback fine-tune.
    const mPitch = clamp(state.meanPitch, -1, 1);
    const baseFb =
      typeof out.delayFeedback === 'number' ? out.delayFeedback : DELAY_FB_MIN;
    out.delayFeedback = clamp(
      baseFb + mPitch * HAND_3D_DELAY_FB_GAIN,
      DELAY_FB_MIN,
      DELAY_FB_MAX,
    );

    return out;
  }

  /**
   * Blend face modulators into the partial param target. Idempotent: with no
   * face state, returns `target` unchanged.
   */
  private applyFaceModulation(
    target: Partial<AudioEngineParams>,
  ): Partial<AudioEngineParams> {
    const f = this.lastFace;
    if (!f) return target;

    const out: Partial<AudioEngineParams> = { ...target };

    if (f.detected) {
      // Reverb wet: blend hand-driven reverb with the depth-mapped face value.
      const faceReverb = lerp(
        FACE_REVERB_FAR,
        FACE_REVERB_NEAR,
        clamp01(f.apparentSize),
      );
      const handReverb =
        typeof out.reverbWet === 'number' ? out.reverbWet : faceReverb;
      out.reverbWet = lerp(handReverb, faceReverb, FACE_REVERB_BLEND);

      // Brightness offset from head tilt (roll). Centred on 0.
      const rollNorm = clamp(
        f.pose.roll / FACE_BRIGHTNESS_ROLL_SCALE,
        -1,
        1,
      );
      const handBrightness =
        typeof out.brightness === 'number' ? out.brightness : 0.5;
      out.brightness = clamp01(handBrightness + rollNorm * FACE_BRIGHTNESS_GAIN);

      // Resonance offset from yaw.
      const yawNorm = clamp(f.pose.yaw / FACE_RESONANCE_YAW_SCALE, -1, 1);
      const handQ =
        typeof out.filterResonance === 'number' ? out.filterResonance : 1;
      out.filterResonance = clamp(
        handQ + yawNorm * FACE_RESONANCE_GAIN,
        Q_MIN,
        Q_MAX,
      );

      // Mouth as a fourth continuous controller. Modulates four audio
      // dimensions at once so the sweep is unmistakably audible:
      //   - delayWet: full LERP BASE→FULL (huge "echoey" change)
      //   - filterCutoff: additive lift up to FACE_MOUTH_CUTOFF_LIFT Hz
      //   - reverbWet: additive lift up to FACE_MOUTH_REVERB_LIFT
      //   - brightness: additive lift up to FACE_MOUTH_BRIGHTNESS_GAIN
      // All applied AFTER the hand-driven values so the user's hand
      // gestures remain the primary control surface; mouth is a layer
      // on top.
      const m = clamp01(f.mouthOpen);
      out.delayWet = lerp(FACE_MOUTH_DELAY_BASE, FACE_MOUTH_DELAY_FULL, m);
      const handCutoff =
        typeof out.filterCutoff === 'number' ? out.filterCutoff : 8000;
      out.filterCutoff = Math.min(
        16000,
        handCutoff + m * FACE_MOUTH_CUTOFF_LIFT,
      );
      const reverbBefore =
        typeof out.reverbWet === 'number' ? out.reverbWet : 0.4;
      out.reverbWet = clamp01(reverbBefore + m * FACE_MOUTH_REVERB_LIFT);
      const handBrightness2 =
        typeof out.brightness === 'number' ? out.brightness : 0.5;
      out.brightness = clamp01(
        handBrightness2 + m * FACE_MOUTH_BRIGHTNESS_GAIN,
      );

      // Eyes-wide additive: lift reverbWet and Q on top of everything
      // already composed. Layered AFTER the mouth block so wide eyes +
      // open mouth read as the most extreme combined sound.
      const w = clamp01(f.eyesWide);
      out.reverbWet = clamp01(
        (out.reverbWet ?? 0.4) + w * FACE_EYES_WIDE_REVERB_GAIN,
      );
      out.filterResonance = clamp(
        (out.filterResonance ?? 1) + w * FACE_EYES_WIDE_Q_GAIN,
        Q_MIN,
        Q_MAX,
      );

      // -----------------------------------------------------------------
      // Expression layer — smile / frown / surprise / anger. Layered last
      // so an expression always wins over the underlying gesture mix.
      // -----------------------------------------------------------------

      // Smile: brighter + louder. Reduces masterDuck (so smiling pushes
      // the mix forward) and lifts brightness directly.
      const smile = clamp01(f.smile);
      if (smile > 0) {
        const baseBright =
          typeof out.brightness === 'number' ? out.brightness : 0.5;
        out.brightness = clamp01(
          baseBright + smile * FACE_SMILE_BRIGHTNESS_GAIN,
        );
        const baseDuckSmile =
          typeof out.masterDuck === 'number' ? out.masterDuck : 0;
        out.masterDuck = clamp01(
          baseDuckSmile - smile * FACE_SMILE_DUCK_REDUCE,
        );
      }

      // Frown: darkens. Pulls master cutoff toward FACE_FROWN_CUTOFF_FLOOR
      // — fully frowning lerps the cutoff between its current value and
      // the floor by `frown`.
      const frown = clamp01(f.frown);
      if (frown > 0) {
        const baseCutoff =
          typeof out.filterCutoff === 'number' ? out.filterCutoff : 8000;
        out.filterCutoff = lerp(baseCutoff, FACE_FROWN_CUTOFF_FLOOR, frown);
      }

      // Surprise: opens up. +reverb, +delay feedback.
      const surprise = clamp01(f.surprise);
      if (surprise > 0) {
        const baseReverbS =
          typeof out.reverbWet === 'number' ? out.reverbWet : 0.4;
        out.reverbWet = clamp01(
          baseReverbS + surprise * FACE_SURPRISE_REVERB_GAIN,
        );
        const baseFbS =
          typeof out.delayFeedback === 'number' ? out.delayFeedback : DELAY_FB_MIN;
        out.delayFeedback = clamp(
          baseFbS + surprise * FACE_SURPRISE_DELAY_FB_GAIN,
          DELAY_FB_MIN,
          DELAY_FB_MAX,
        );
      }

      // Anger: drive + resonance peak.
      const anger = clamp01(f.anger);
      if (anger > 0) {
        const baseDriveA =
          typeof out.saturatorDrive === 'number' ? out.saturatorDrive : DRIVE_MIN;
        out.saturatorDrive = clamp(
          baseDriveA + anger * FACE_ANGER_DRIVE_GAIN,
          DRIVE_MIN,
          DRIVE_MAX,
        );
        const baseQA =
          typeof out.filterResonance === 'number' ? out.filterResonance : 1;
        out.filterResonance = clamp(
          baseQA + anger * FACE_ANGER_Q_GAIN,
          Q_MIN,
          Q_MAX,
        );
      }
    }

    // Face-lost duck (additive). Independent of detected/undetected snapshot
    // because `noFaceDuration` is provided in both branches.
    if (f.noFaceDuration >= FACE_LOST_DUCK_AFTER_SEC) {
      const handDuck = typeof out.masterDuck === 'number' ? out.masterDuck : 0;
      out.masterDuck = clamp01(handDuck + FACE_LOST_DUCK);
    }

    return out;
  }

  /**
   * Pitch-driven intensity contribution. Returns 0 when no face is present.
   * Chin up (positive pitch) -> +boost, chin down -> -boost (small).
   */
  private faceIntensityBoost(): number {
    const f = this.lastFace;
    if (!f || !f.detected) return 0;
    return FACE_INTENSITY_GAIN * Math.sin(f.pose.pitch);
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

  // -------------------------------------------------------------------------
  // Discrete gesture event handling
  //
  // The GestureInterpreter has already done all the timing work (3-frame
  // consensus, per-shape cooldown, velocity sustain, etc.) — this layer just
  // routes events to musical actions. Each shape_enter dispatches in a
  // single switch; velocity gestures (snap, swipe, fist_pump, wave_level)
  // get their own branches.
  //
  // Compromises (per the brief — "if a target API doesn't exist, do the
  // most musically sensible existing-API approximation and document it"):
  //   - peace → MusicBrain has no setVibrato, so we lift brightness for a
  //     short window instead.
  //   - thumbs_up → SettingsPanel has no public savePatch API; we log a
  //     console message ("saved").
  //   - thumbs_down / three / four → load factory presets directly through
  //     audio.setParams (the SettingsPanel exposes only mount/unmount/
  //     setVisible). FACTORY_PRESETS is in src/presets, not src/ui, so
  //     reading it here doesn't violate the module-ownership rules.
  //   - swipe_left / swipe_right → cycle through FACTORY_PRESETS in place
  //     (same reason as above).
  //   - wave → no tremolo on AudioEngine; we LFO the brightness param.
  // -------------------------------------------------------------------------

  private handleGestureEvent(e: GestureEvent): void {
    switch (e.type) {
      case 'shape_enter':
        this.handleShapeEnter(e.shape, e.handedness);
        break;
      case 'shape_exit':
        // Currently no per-exit action; left here as a hook for future
        // momentary-hold shapes.
        break;
      case 'snap':
        // Either-hand percussion one-shot.
        this.audio?.triggerPerc();
        break;
      case 'swipe_right':
        if (e.handedness === 'Right') this.cycleFactoryPreset(+1);
        break;
      case 'swipe_left':
        if (e.handedness === 'Right') this.cycleFactoryPreset(-1);
        break;
      case 'fist_pump':
        this.handleFistPump(e.handedness);
        break;
      case 'wave_level':
        this.waveLevel = clamp01(e.level);
        break;
    }
  }

  private handleShapeEnter(
    shape: import('@contracts/contracts').HandShape,
    handedness: 'Left' | 'Right',
  ): void {
    // Most shape mappings are right-hand only per the brief. Snap / wave /
    // fist_pump are explicitly multi-hand.
    if (handedness !== 'Right') return;

    const now = performance.now();
    switch (shape) {
      case 'point':
        this.pointPulseStartMs = now;
        break;
      case 'peace':
        // No setVibrato API on MusicBrain → brightness pulse approximation.
        this.peacePulseStartMs = now;
        break;
      case 'rock_on':
        this.rockPulseStartMs = now;
        break;
      case 'ok':
        this.okPulseStartMs = now;
        break;
      case 'finger_gun':
        // Lead stab — same path as right pinch.
        this.triggerStab();
        break;
      case 'thumbs_up':
        // No public savePatch API on the SettingsPanel — log as the brief
        // documents this fallback choice.
        // eslint-disable-next-line no-console
        console.info('[InteractionMapper] thumbs_up — quick-patch saved (logged)');
        break;
      case 'thumbs_down':
        this.applyFactoryPresetById('init');
        break;
      case 'three':
        this.applyFactoryPresetByIndex(2);
        break;
      case 'four':
        this.applyFactoryPresetByIndex(3);
        break;
      case 'call_me':
        this.audio?.triggerPerc();
        break;
      default:
        // unknown / fist / open_palm — no shape-specific action.
        break;
    }
  }

  private handleFistPump(handedness: 'Left' | 'Right'): void {
    const now = performance.now();
    if (handedness === 'Left') this.leftFistPumpAtMs = now;
    else this.rightFistPumpAtMs = now;
    // Both-hands gating: both fist_pumps within 250 ms of each other to
    // qualify for the "drop bomb". Stricter than a single hand fires
    // alone — the brief calls this a "both" event.
    if (Math.abs(this.leftFistPumpAtMs - this.rightFistPumpAtMs) < 250) {
      this.bombPulseStartMs = now;
    }
  }

  private cycleFactoryPreset(direction: 1 | -1): void {
    if (FACTORY_PRESETS.length === 0) return;
    this.factoryPresetIndex =
      (this.factoryPresetIndex + direction + FACTORY_PRESETS.length) %
      FACTORY_PRESETS.length;
    this.applyFactoryPresetByIndex(this.factoryPresetIndex);
  }

  private applyFactoryPresetByIndex(idx: number): void {
    if (idx < 0 || idx >= FACTORY_PRESETS.length) return;
    const preset = FACTORY_PRESETS[idx];
    if (!preset) return;
    this.factoryPresetIndex = idx;
    const { bpm: _bpm, ...params } = preset.params;
    void _bpm;
    if (Object.keys(params).length > 0) {
      this.audio?.setParams(params as Partial<AudioEngineParams>);
    }
  }

  private applyFactoryPresetById(id: string): void {
    const idx = FACTORY_PRESETS.findIndex((p) => p.id === id);
    if (idx >= 0) this.applyFactoryPresetByIndex(idx);
  }

  // -------------------------------------------------------------------------
  // Time-decayed pulse application
  //
  // Each pulse register holds the start timestamp; we compute the remaining
  // contribution as `peak * (1 - elapsed / decayMs)`, clamped to [0, peak].
  // When the contribution reaches 0 we clear the register so subsequent
  // frames are pure baseline.
  // -------------------------------------------------------------------------

  private applyDiscreteGesturePulses(
    target: Partial<AudioEngineParams>,
  ): Partial<AudioEngineParams> {
    const out: Partial<AudioEngineParams> = { ...target };
    const now = performance.now();

    // point → filterResonance spike
    const pointAmt = pulseAmount(this.pointPulseStartMs, now, POINT_DECAY_MS);
    if (pointAmt > 0) {
      const baseQ =
        typeof out.filterResonance === 'number' ? out.filterResonance : 1;
      out.filterResonance = clamp(
        baseQ + pointAmt * POINT_Q_SPIKE,
        Q_MIN,
        Q_MAX,
      );
    } else {
      this.pointPulseStartMs = null;
    }

    // peace → brightness pulse (vibrato approximation)
    const peaceAmt = pulseAmount(this.peacePulseStartMs, now, PEACE_DECAY_MS);
    if (peaceAmt > 0) {
      const baseB =
        typeof out.brightness === 'number' ? out.brightness : 0.5;
      out.brightness = clamp01(baseB + peaceAmt * PEACE_BRIGHT_PULSE);
    } else {
      this.peacePulseStartMs = null;
    }

    // rock_on → drive pulse
    const rockAmt = pulseAmount(this.rockPulseStartMs, now, ROCK_DECAY_MS);
    if (rockAmt > 0) {
      const baseDrive =
        typeof out.saturatorDrive === 'number' ? out.saturatorDrive : DRIVE_MIN;
      out.saturatorDrive = clamp(
        baseDrive + rockAmt * ROCK_DRIVE_PULSE,
        DRIVE_MIN,
        DRIVE_MAX,
      );
    } else {
      this.rockPulseStartMs = null;
    }

    // ok → tape-flutter (delay feedback pulse)
    const okAmt = pulseAmount(this.okPulseStartMs, now, OK_DECAY_MS);
    if (okAmt > 0) {
      const baseFb =
        typeof out.delayFeedback === 'number' ? out.delayFeedback : DELAY_FB_MIN;
      out.delayFeedback = clamp(
        baseFb + okAmt * OK_DELAY_FB_PULSE,
        DELAY_FB_MIN,
        DELAY_FB_MAX,
      );
    } else {
      this.okPulseStartMs = null;
    }

    // bomb (fist_pump both hands) → delay feedback + reverb
    const bombAmt = pulseAmount(this.bombPulseStartMs, now, BOMB_DECAY_MS);
    if (bombAmt > 0) {
      const baseFb =
        typeof out.delayFeedback === 'number' ? out.delayFeedback : DELAY_FB_MIN;
      out.delayFeedback = clamp(
        baseFb + bombAmt * BOMB_DELAY_FB_PULSE,
        DELAY_FB_MIN,
        DELAY_FB_MAX,
      );
      const baseRev =
        typeof out.reverbWet === 'number' ? out.reverbWet : REVERB_MIN;
      out.reverbWet = clamp01(baseRev + bombAmt * BOMB_REVERB_PULSE);
    } else {
      this.bombPulseStartMs = null;
    }

    // wave → continuous brightness LFO. No decay — the wave_level is
    // already a controller scalar set by the interpreter.
    if (this.waveLevel > 0.01) {
      const baseB =
        typeof out.brightness === 'number' ? out.brightness : 0.5;
      const phase =
        Math.sin((2 * Math.PI * (now / 1000) * WAVE_LFO_HZ));
      out.brightness = clamp01(
        baseB + phase * this.waveLevel * WAVE_BRIGHTNESS_DEPTH,
      );
    }

    return out;
  }
}

// ---------------------------------------------------------------------------
// Utility: minimum-change thresholds for setParams diff (per-param ε). Below
// these deltas a param is considered unchanged and not re-pushed. Tuned so
// audio-imperceptible differences don't queue ramp events — the listener
// still hears every meaningful change but the scheduler queue stays small.
// ---------------------------------------------------------------------------

const PARAM_EPS: Partial<Record<keyof AudioEngineParams, number>> = {
  filterCutoff: 8,         // Hz — sub-perceptual at any cutoff
  filterResonance: 0.05,   // Q
  saturatorDrive: 0.01,
  reverbWet: 0.005,
  delayFeedback: 0.005,
  delayWet: 0.005,
  brightness: 0.005,
  masterDuck: 0.005,
};

/**
 * Return a Partial<AudioEngineParams> containing only the keys in `to`
 * whose value differs from `from` by more than the per-param epsilon, or
 * `null` if no key changed enough to push. The first call (no `from`)
 * always returns a copy of `to`.
 */
function diffParams(
  from: Partial<AudioEngineParams> | null,
  to: Partial<AudioEngineParams>,
): Partial<AudioEngineParams> | null {
  if (!from) return { ...to };
  const out: Partial<AudioEngineParams> = {};
  let any = false;
  for (const k of Object.keys(to) as (keyof AudioEngineParams)[]) {
    const v = to[k];
    if (typeof v !== 'number') continue;
    const prev = from[k];
    const eps = PARAM_EPS[k] ?? 0.005;
    if (typeof prev !== 'number' || Math.abs(v - prev) > eps) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
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

/**
 * Linear pulse decay helper. Returns the *remaining* contribution scalar
 * (0..1) at time `now` for a pulse that started at `startMs` with a
 * `decayMs` window. Returns 0 (and is therefore safe to clear) when the
 * pulse has fully decayed or `startMs` is null.
 *
 * Semantics: amount = max(0, 1 - (now - startMs) / decayMs).
 * - At now == startMs → amount = 1 (full peak)
 * - At now == startMs + decayMs → amount = 0
 * - Beyond decayMs → amount = 0
 */
function pulseAmount(
  startMs: number | null,
  now: number,
  decayMs: number,
): number {
  if (startMs === null) return 0;
  const elapsed = now - startMs;
  if (elapsed < 0) return 1;
  if (elapsed >= decayMs) return 0;
  return 1 - elapsed / decayMs;
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
  pulseAmount,
};
