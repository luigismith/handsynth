// Owner: qa-listener / synthetic-player harness
//
// Shared types for the synthetic-player simulator. The simulator drives the
// live HandSynth subsystem chain (HandTracker → InteractionMapper → AudioEngine
// + MusicBrain) with a deterministic seeded stream of GestureState/FaceState
// snapshots and records everything that flows out the other side.
//
// All types are pure data (no behavior); the runtime parts live in
// `synthetic-player.ts`, `profiles.ts`, and `observer.ts`.

import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  FaceState,
  GestureState,
  MusicBrain,
  NoteEvent,
} from '@contracts/contracts';
import type { FakeFaceTracker, FakeHandTracker } from './fake-trackers';

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** Deterministic seeded PRNG factory (mulberry32). */
export type SeededRng = () => number;

// ---------------------------------------------------------------------------
// Recorded events
// ---------------------------------------------------------------------------

export interface ParamCall {
  /** Simulator time in seconds when the call happened. */
  t: number;
  /** The partial params that were pushed. */
  params: Partial<AudioEngineParams>;
}

export type NoteKind = 'lead' | 'bass' | 'chord' | 'kick' | 'hat' | 'perc' | 'stab';

export interface NoteCall {
  t: number;
  kind: NoteKind;
  /** Note or chord payload. `null` for percussion (no pitch). */
  event: NoteEvent | ChordEvent | null;
}

export interface VoiceShapeCall {
  t: number;
  kind: 'setVoiceWaveform' | 'setVoiceTimbre' | 'applyVoiceShape';
  payload: unknown;
}

export interface MusicStateCall {
  t: number;
  /** What changed — used for human-readable summaries. */
  kind: 'setVibe' | 'setKey' | 'setMode' | 'setScale' | 'clearScaleOverride';
  payload: unknown;
}

export interface ErrorRecord {
  t: number;
  source: string;
  message: string;
  stack?: string;
}

export interface PerSecondMetric {
  /** Whole-second bucket index (0-indexed). */
  second: number;
  paramCallCount: number;
  noteEventCount: number;
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Player dependencies + profile shape
// ---------------------------------------------------------------------------

export interface SyntheticPlayerDeps {
  /** Real or fake audio engine. Defaults to a tracking stub when omitted. */
  audio: AudioEngine;
  music: MusicBrain;
  hands: FakeHandTracker;
  face: FakeFaceTracker;
}

/**
 * A play profile generates the gesture stream a synthetic performer would
 * produce. The hand state is sampled at 24 Hz, the face at 8 Hz, matching the
 * real HandTracker/FaceTracker emit rates. `panelEvents` lets the profile fire
 * one-off UI-style events (preset clicks, key changes) at scripted times.
 */
export interface PlayProfile {
  /** Human-readable name shown in reports. */
  name: string;
  /** Generates a single GestureState given the simulator time + seeded RNG. */
  nextGestureState(t: number, rng: SeededRng): GestureState;
  /** Same for face. Returning `undefined` means "no face this tick". */
  nextFaceState(t: number, rng: SeededRng): FaceState | undefined;
  /** Sequence of preset / vibe / scale changes applied at scripted times. */
  panelEvents?: ReadonlyArray<{
    atSec: number;
    do: (engine: AudioEngine, music: MusicBrain) => void;
  }>;
  /** Default duration if no override is passed to `play()`. */
  defaultDurationSec?: number;
}

// Re-export the recorded-event types alias so test files can write one import
// to cover everything in the harness.
export type { ParamCall as RecordedParamCall };

// Re-export for downstream convenience.
export type {
  AudioEngine,
  AudioEngineParams,
  FaceState,
  GestureState,
  MusicBrain,
  NoteEvent,
  ChordEvent,
};
