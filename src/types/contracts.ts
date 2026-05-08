/**
 * HandSynth — module contracts.
 *
 * This file is the **single source of truth** for the public surface of every
 * module in the project. Each subsystem (audio, music, hands, interaction,
 * visualizer) implements one of the interfaces below. Downstream agents must
 * implement against these signatures exactly. Only the `architect` agent may
 * modify this file; all others read it.
 *
 * Owner: architect
 */

// =============================================================================
// VIBE PRESETS
// =============================================================================

/** Identifier of one of the four built-in vibes. */
export type VibeId = 'tycho' | 'bonobo' | 'hopkins' | 'floating-points';

/**
 * A vibe is a complete musical and timbral character: tempo, scale, chord
 * progressions, and synth/FX defaults. Selected via the `VibeSelector` UI and
 * propagated to `MusicBrain` (for harmony) and `AudioEngine` (for timbre).
 */
export interface VibePreset {
  /** Stable identifier. */
  id: VibeId;
  /** Human-readable name shown in the UI. */
  displayName: string;
  /** Tempo in beats per minute. */
  bpm: number;
  /** Tonal centre and mode, in `@tonaljs/tonal`-compatible notation. */
  scale: { tonic: string; mode: string };
  /**
   * Available chord progressions, each as an array of chord symbols. The
   * MusicBrain may pick or rotate between them. Symbols use Tonal notation
   * (e.g. `'F#maj9'`, `'Cmaj7/E'`).
   */
  progressions: string[][];
  /** Pad voice defaults. */
  pad: { waveform: string; lfoRate: number; detuneCents: number };
  /** Lead voice defaults. */
  lead: {
    synthType: 'wavetable' | 'fm' | 'mono';
    fmRatio?: number;
    modIndex?: number;
  };
  /** Bass voice defaults. */
  bass: { waveform: string; sub: boolean };
  /** Convolution-reverb wet level (0..1). */
  reverbWet: number;
  /** Ping-pong delay wet level (0..1). */
  delayWet: number;
  /** Saturator drive amount (0.5..3.0). */
  saturatorDrive: number;
  /** Groove swing amount (0..1, 0 = straight, ~0.5 = jazzy). */
  swing: number;
}

// =============================================================================
// AUDIO
// =============================================================================

/** A single melodic note event. Timing follows Tone.js notation. */
export interface NoteEvent {
  /** Pitch in scientific notation, e.g. `'C4'`, `'F#3'`. */
  pitch: string;
  /** Duration in Tone.js notation, e.g. `'8n'`, `'16n'`, or seconds. */
  duration: string;
  /** Velocity, 0..1. */
  velocity: number;
  /** Schedule time in Tone.js Time, or numeric seconds. */
  time: number | string;
}

/** A chord (multi-note) event. */
export interface ChordEvent {
  /** Voicing — array of pitches in scientific notation. */
  notes: string[];
  /** Duration in Tone.js notation. */
  duration: string;
  /** Schedule time in Tone.js Time, or numeric seconds. */
  time: number | string;
}

/**
 * Continuous audio parameters mapped from gestures by the InteractionMapper.
 * The AudioEngine smooths these internally to avoid zipper noise (see
 * ARCHITECTURE.md, "Parameter smoothing").
 */
export interface AudioEngineParams {
  /** Master low-pass filter cutoff in Hz, 200..12000. */
  filterCutoff: number;
  /** Convolution reverb wet, 0..1. */
  reverbWet: number;
  /** Ping-pong delay feedback, 0..0.95. */
  delayFeedback: number;
  /** Ping-pong delay wet/dry mix, 0..1. */
  delayWet: number;
  /** Saturator drive, 0.5..3.0. */
  saturatorDrive: number;
  /** Filter resonance / Q, 0..20. */
  filterResonance: number;
  /** Oscillator brightness / wavetable position, 0..1. */
  brightness: number;
  /** Master ducking amount, 0..1 (1 = full mute / silent). */
  masterDuck: number;
}

/**
 * The single audio output. Owned by `audio-engineer`. Lazy-init: `init()` MUST
 * be called from a user-gesture handler so the AudioContext starts unsuspended.
 */
export interface AudioEngine {
  /** Idempotent. Sets up Tone.js context, voices, FX chain, worklets. */
  init(): Promise<void>;
  /** Re-tunes voices/FX to a vibe preset. Safe to call any time after init. */
  loadVibe(vibe: VibePreset): void;
  /** Trigger a lead-voice note. */
  triggerLead(event: NoteEvent): void;
  /** Trigger a bass-voice note. */
  triggerBass(event: NoteEvent): void;
  /** Trigger a chord on the pad voice. */
  triggerChord(event: ChordEvent): void;
  /** Drum hits — scheduled by the MusicBrain. */
  triggerKick(time?: number | string): void;
  triggerHat(time?: number | string): void;
  triggerPerc(time?: number | string): void;
  /** Punctual stab triggered by the right-hand pinch gesture. */
  triggerStab(): void;
  /** Apply a partial parameter update (smoothed). */
  setParams(partial: Partial<AudioEngineParams>): void;
  /** Hard mute / unmute (e.g. when no hands are detected). */
  setMute(muted: boolean): void;
  /** Engage / release the "drop" effect (filter sweep + perc roll). */
  triggerDrop(active: boolean): void;
  /** Returns the master analyser node for the visualizer's FFT. */
  getAnalyser(): AnalyserNode;
  /** True after `init()` has resolved. */
  isReady(): boolean;
}

// =============================================================================
// MUSIC BRAIN
// =============================================================================

/** Discrete mood bucket, derived by the InteractionMapper from gesture state. */
export type Mood = 'calm' | 'rising' | 'peak' | 'release';

/** Continuous control input to the MusicBrain. */
export interface MusicBrainInput {
  /** Density / energy, 0..1. Drives note rate, drum complexity, voicing density. */
  intensity: number;
  /** Discrete mood — biases progression and arpeggio choice. */
  mood: Mood;
  /** Active vibe. Tonality, scale, progressions all come from here. */
  vibe: VibePreset;
  /** Override BPM (otherwise `vibe.bpm`). */
  bpm?: number;
}

/** Event callbacks that the MusicBrain emits to the AudioEngine. */
export interface MusicBrainEvents {
  onLead(event: NoteEvent): void;
  onBass(event: NoteEvent): void;
  onChord(event: ChordEvent): void;
  onKick(time: number | string): void;
  onHat(time: number | string): void;
  onPerc(time: number | string): void;
  /** Optional sync hook for the visualizer. */
  onBeat?(beat: number): void;
}

/**
 * Generative engine. Owns the transport clock, current chord index, and
 * note-generation state. Owned by `music-brain` agent.
 */
export interface MusicBrain {
  /** Start the transport. Idempotent. */
  start(): void;
  /** Stop the transport. Idempotent. */
  stop(): void;
  /** Update intensity / mood / vibe. */
  setInput(input: MusicBrainInput): void;
  /** Force-advance to the next chord in the active progression. */
  advanceChord(): void;
  /** Subscribe to musical events. */
  on(events: MusicBrainEvents): void;
  /** Unsubscribe. */
  off(events: MusicBrainEvents): void;
}

// =============================================================================
// HANDS
// =============================================================================

/** A single normalized landmark in MediaPipe space (x, y in 0..1, z relative). */
export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

/** A detected hand with derived metrics. */
export interface Hand {
  /** Which side of the body — MediaPipe handedness, mirrored to user POV. */
  side: 'left' | 'right';
  /** 21 landmarks in MediaPipe order (wrist, thumb 1-4, index 1-4, ...). */
  landmarks: HandLandmark[];
  /** Convenience: centroid of palm landmarks. */
  palmCenter: HandLandmark;
  /** Hand openness, 0 (fist) .. 1 (fully splayed). */
  openness: number;
  /** Pinch distance thumb-tip ↔ index-tip, normalized 0..1. */
  pinch: number;
  /** True when openness < threshold (fist). */
  isClosed: boolean;
}

/** Aggregate frame-level gesture state, emitted at `gesture:update`. */
export interface GestureState {
  /** All hands present this frame (0, 1, or 2). */
  hands: Hand[];
  /** Convenience: hands.length === 2. */
  bothHandsDetected: boolean;
  /** Distance between palm centres, normalized 0..1 to frame width. */
  handsDistance: number;
  /** Average normalized Y of palm centres (0 = bottom of frame, 1 = top). */
  meanHeight: number;
  /** Smoothed openness of the right hand, 0..1. */
  rightOpenness: number;
  /** Smoothed openness of the left hand, 0..1. */
  leftOpenness: number;
  /** Edge-detected pinch on the right hand (true exactly while pinching). */
  rightPinchActive: boolean;
  /** Edge-detected pinch on the left hand. */
  leftPinchActive: boolean;
  /** Both hands closed (fists) — used as the "drop" gesture. */
  bothFists: boolean;
  /** Both palm centres above frame midline — used as "lift / climax". */
  bothAboveHead: boolean;
  /** Total visible extended-finger count across both hands, 0..10. */
  fingerCount: number;
  /** Seconds since the last frame with at least one detected hand. */
  noHandsDuration: number;
}

/**
 * Event map for the HandTracker. Strongly typed — listeners get the right
 * payload by event name.
 */
export interface HandTrackerEvents {
  /** Emitted every frame with the latest gesture state. */
  'gesture:update': (state: GestureState) => void;
  /** Edge: right-hand pinch closed. */
  'gesture:pinch-right': () => void;
  /** Edge: left-hand pinch closed. */
  'gesture:pinch-left': () => void;
  /** Edge: hands disappeared from view. */
  'gesture:no-hands': () => void;
  /** Edge: hands re-entered after `gesture:no-hands`. */
  'gesture:hands-back': () => void;
  /** Tracker error (e.g. webcam denied, model load failed). */
  error: (e: Error) => void;
}

/**
 * MediaPipe Tasks Vision wrapper. Owned by `hand-tracker` agent. Runs on the
 * main thread by default with `requestVideoFrameCallback`; may move to a
 * dedicated worker if budget allows (see ARCHITECTURE.md "Threading").
 */
export interface HandTracker {
  /** Wire the webcam stream and load the model. Throws on permission denial. */
  init(videoEl: HTMLVideoElement): Promise<void>;
  /** Begin per-frame tracking. */
  start(): void;
  /** Stop tracking and release resources. */
  stop(): void;
  on<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]): void;
  off<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]): void;
}

// =============================================================================
// FACE
// =============================================================================

/** A single normalized face landmark (x, y in 0..1, z relative). */
export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

/**
 * Head pose extracted from the FaceLandmarker's facialTransformationMatrix
 * (4x4). Angles are in radians; coordinate convention is selfie-mirrored to
 * match HandTracker output.
 */
export interface HeadPose {
  /** Yaw (left-right rotation) in radians, ~-π/2 .. π/2. Positive = right turn. */
  yaw: number;
  /** Pitch (up-down rotation) in radians. Positive = chin up. */
  pitch: number;
  /** Roll (head tilt). Positive = right ear toward right shoulder. */
  roll: number;
  /** Z-translation in normalized units; <0.5 = closer, >0.5 = farther. */
  depth: number;
}

/** Aggregate face state, emitted at `face:update`. */
export interface FaceState {
  detected: boolean;
  /** Face center in normalized image coords (0..1, mirrored to selfie space). */
  center: { x: number; y: number };
  /** Bounding-box-normalized scale (apparent face size, used as depth proxy). */
  apparentSize: number;
  pose: HeadPose;
  /** Mouth open 0..1 (from blendshapes if available, else fallback geometry). */
  mouthOpen: number;
  /** Eyebrow raise 0..1. */
  browRaise: number;
  /** Time since face last seen, seconds. 0 if currently detected. */
  noFaceDuration: number;
  /** Optional: full landmark array for visualizer overlay (478 points). */
  landmarks?: FaceLandmark[];
}

/** Event map for the FaceTracker. */
export interface FaceTrackerEvents {
  /** Emitted every frame with the latest face state (whether or not detected). */
  'face:update': (state: FaceState) => void;
  /** Edge: face disappeared from view (after a stable absence window). */
  'face:lost': () => void;
  /** Edge: face re-appeared after a `face:lost`. */
  'face:back': () => void;
  /** Tracker error. */
  error: (e: Error) => void;
}

/**
 * MediaPipe Tasks Vision FaceLandmarker wrapper. Mirrors the HandTracker
 * lifecycle: lazy init from a user gesture, frame loop driven by
 * requestVideoFrameCallback, One-Euro smoothing on emitted scalars.
 *
 * Owned by `hand-tracker` agent (face tracking is a sibling module under
 * `src/face/` — see ARCHITECTURE.md "Head tracking").
 */
export interface FaceTracker {
  /** Wire the webcam stream and load the model. */
  init(videoEl: HTMLVideoElement): Promise<void>;
  /** Begin per-frame tracking. */
  start(): void;
  /** Stop tracking and release resources. */
  stop(): void;
  on<K extends keyof FaceTrackerEvents>(evt: K, cb: FaceTrackerEvents[K]): void;
  off<K extends keyof FaceTrackerEvents>(evt: K, cb: FaceTrackerEvents[K]): void;
}

// =============================================================================
// INTERACTION MAPPER
// =============================================================================

/**
 * Glue between hands → audio/music. Owns the gesture→parameter mapping and the
 * vibe selection state machine. Owned by `interaction-mapper` agent.
 */
export interface InteractionMapper {
  /**
   * Wire dependencies. Call once after all subsystems are constructed. The
   * `face` dependency is optional: if FaceTracker init fails or the user
   * declines, the mapper runs hand-only.
   */
  attach(deps: {
    audio: AudioEngine;
    music: MusicBrain;
    hands: HandTracker;
    face?: FaceTracker;
  }): void;
  /** Switch vibe — propagates to audio + music. */
  setVibe(vibe: VibePreset): void;
  /** Begin listening to gesture events and applying them. */
  start(): void;
  /** Detach listeners. */
  stop(): void;
}

// =============================================================================
// VISUALIZER
// =============================================================================

/**
 * p5.js (instance mode) FFT-driven visualization. Owned by `visualizer` agent.
 * Uses `audio.getAnalyser()` for FFT; reads `hands` state for cursor overlay;
 * optionally syncs to `music.onBeat`.
 */
export interface Visualizer {
  /** Mount the sketch onto a canvas with its dependencies. */
  mount(
    canvas: HTMLCanvasElement,
    deps: { audio: AudioEngine; hands: HandTracker; music: MusicBrain },
  ): void;
  /** Tear down. */
  unmount(): void;
}
