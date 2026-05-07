// Owner: music-brain
//
// Generative engines for lead, bass, and percussion.
//
// Lead: order-2 Markov on scale degrees → harmonic filter → contour bias →
// density gate → humanized output. Each step is independent, so they can be
// tuned/disabled in isolation.
//
// Bass: root-on-1, walking eighth-note pattern with chord-tone passing notes.
//
// Perc: Euclidean kick / hat / perc, pattern density biased by intensity.

import { Note } from '@tonaljs/tonal';
import type { NoteEvent } from '@contracts/contracts';
import {
  buildDefaultMarkovTable,
  sampleNextDegree,
  type MarkovTable,
  type ScaleDegree,
} from './markov';
import { euclideanRhythm } from './euclidean';
import {
  isConsonantTension,
  nearestChordTone,
  type ScaleInfo,
} from './harmony';

// ---------------------------------------------------------------------------
// Lead generator
// ---------------------------------------------------------------------------

export interface LeadGeneratorState {
  scale: ScaleInfo;
  currentChord: string;
  intensity: number; // 0..1
  /** 0..1 traversal of an 8-bar phrase arc. Drives register bias. */
  contourPhase: number;
  /** Last emitted scale degree (for Markov memory). */
  lastDegree: ScaleDegree;
  /** Degree before lastDegree, for order-2 lookup. */
  prevDegree: ScaleDegree;
  /** Last emitted MIDI for monotonic-leap avoidance. */
  lastMidi: number | null;
  /** Random source — pluggable for tests. */
  rng: () => number;
  /** Markov transition table. */
  markovTable: MarkovTable;
  /** Base octave the lead lives in. */
  baseOctave: number;
}

export function createLeadState(
  scale: ScaleInfo,
  currentChord: string,
  baseOctave = 4,
  rng: () => number = Math.random,
): LeadGeneratorState {
  return {
    scale,
    currentChord,
    intensity: 0.5,
    contourPhase: 0,
    lastDegree: 1,
    prevDegree: 1,
    lastMidi: null,
    rng,
    markovTable: buildDefaultMarkovTable(),
    baseOctave,
  };
}

/**
 * Density gate. Returns the divisor (steps per beat) — 1, 2, or 4 — that the
 * caller compares against. We map intensity to:
 *   [0,    0.33) → 1  (quarter notes)
 *   [0.33, 0.66) → 2  (eighths)
 *   [0.66, 1.0]  → 4  (sixteenths)
 */
export function densityForIntensity(intensity: number): 1 | 2 | 4 {
  if (intensity < 0.33) return 1;
  if (intensity < 0.66) return 2;
  return 4;
}

/**
 * Should the lead fire on this 16th-note step? `stepInBar` is 0..15.
 * Combines density (subdivision) with a skip probability based on intensity.
 */
export function shouldFireLead(
  stepInBar: number,
  intensity: number,
  rng: () => number,
): boolean {
  const div = densityForIntensity(intensity);
  // div=1 → fire on quarter notes (steps 0,4,8,12)
  // div=2 → fire on eighths (steps 0,2,4,6,...)
  // div=4 → every 16th
  const subdiv = 4 / div;
  if (stepInBar % subdiv !== 0) return false;
  // Skip probability — even within the grid, we sometimes leave space.
  const skipProb = (1 - intensity) * 0.4;
  return rng() >= skipProb;
}

const BEZIER_CONTROL_POINTS = [0, 0.7, 0.4, 1.0] as const;

/** Cubic Bezier for the contour shape. t in [0,1] → register bias 0..1. */
function contourCurve(t: number): number {
  const [p0, p1, p2, p3] = BEZIER_CONTROL_POINTS;
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
}

/** Map contour value 0..1 to an octave delta (-1, 0, +1). */
function octaveBiasFromContour(contour: number): number {
  if (contour < 0.33) return -1;
  if (contour < 0.66) return 0;
  return 1;
}

/**
 * Generate a lead note for a given step. Returns null if the density gate
 * decided to rest. Mutates state.lastDegree / lastMidi for the next call.
 */
export function generateLeadNote(
  state: LeadGeneratorState,
  beatIndex: number,
  stepInBar: number,
  scheduleTime: number | string,
): NoteEvent | null {
  if (!shouldFireLead(stepInBar, state.intensity, state.rng)) return null;

  // 1. Markov: pick the next scale degree.
  const degree = sampleNextDegree(
    state.markovTable,
    state.prevDegree,
    state.lastDegree,
    state.rng,
  );

  // 2. Contour bias — adjust octave (not degree) based on phrase arc.
  const contour = contourCurve(state.contourPhase);
  const octaveBias = octaveBiasFromContour(contour);
  const targetOctave = state.baseOctave + octaveBias;

  // 3. Map degree → pitch using the scale.
  const pcIdx = ((degree - 1) % state.scale.notes.length + state.scale.notes.length) %
    state.scale.notes.length;
  const pitchClass = state.scale.notes[pcIdx] ?? state.scale.tonic;
  let proposed = `${pitchClass}${targetOctave}`;

  // 4. Harmonic filter: chord tone or consonant tension; otherwise snap.
  const chordOk = isConsonantTension(proposed, state.currentChord);
  if (!chordOk) {
    proposed = nearestChordTone(proposed, state.currentChord);
  }

  // 5. Avoid monstrous leaps: if > 12 semitones from last note, pull back.
  const proposedMidi = Note.midi(proposed) ?? 60;
  if (state.lastMidi !== null) {
    const leap = Math.abs(proposedMidi - state.lastMidi);
    if (leap > 12) {
      const dir = Math.sign(proposedMidi - state.lastMidi);
      const pulled = Note.fromMidi(proposedMidi - dir * 12);
      proposed = pulled;
    }
  }

  // 6. Velocity humanization: base 0.7 ± 15%.
  const baseVel = 0.7;
  const velJitter = (state.rng() - 0.5) * 0.3;
  const velocity = clamp01(baseVel + velJitter);

  // 7. Time humanization: positive jitter only (never sound late, but never
  //    early either since negatives risk slipping behind the audio clock).
  //    We add up to +8 ms.
  const jitterMs = state.rng() * 8;
  const time = applyTimeJitter(scheduleTime, jitterMs);

  // 8. Duration is one subdivision of the current density.
  const div = densityForIntensity(state.intensity);
  const duration = div === 1 ? '8n' : div === 2 ? '16n' : '32n';

  // Update state for next call.
  state.prevDegree = state.lastDegree;
  state.lastDegree = degree;
  const finalMidi = Note.midi(proposed) ?? proposedMidi;
  state.lastMidi = finalMidi;

  void beatIndex; // currently unused; reserved for accent profile.

  return {
    pitch: proposed,
    duration,
    velocity,
    time,
  };
}

// ---------------------------------------------------------------------------
// Bass generator
// ---------------------------------------------------------------------------

export interface BassGeneratorState {
  currentChord: string;
  /** Pitch-class root extracted from chord on chord change. */
  currentRoot: string;
  /** Optional chord-tone array for walking; recomputed on chord change. */
  chordTones: string[];
  intensity: number;
  baseOctave: number;
  rng: () => number;
}

export function createBassState(
  currentChord: string,
  chordTones: string[],
  baseOctave = 2,
  rng: () => number = Math.random,
): BassGeneratorState {
  const root = chordTones[0] ?? 'C';
  return {
    currentChord,
    currentRoot: root,
    chordTones,
    intensity: 0.5,
    baseOctave,
    rng,
  };
}

/**
 * Bass note for a given 16th-note step. Strategy:
 *  - Step 0 (downbeat): root, accented.
 *  - Step 8 (beat 3): root or 5th.
 *  - Other 8th-note slots (steps 2,4,6,10,12,14): chord-tone walk.
 *  - 16th-note upbeats: only if intensity > 0.6 and rng allows.
 */
export function generateBassNote(
  state: BassGeneratorState,
  stepInBar: number,
  scheduleTime: number | string,
): NoteEvent | null {
  const isDownbeat = stepInBar === 0;
  const isBeat3 = stepInBar === 8;
  const isEighth = stepInBar % 2 === 0;

  // High-intensity sync on upbeats.
  if (!isEighth) {
    if (state.intensity < 0.6) return null;
    if (state.rng() > state.intensity * 0.5) return null;
  } else {
    // Eighth-note slots — gate by intensity for low values.
    if (state.intensity < 0.25 && !isDownbeat && !isBeat3) return null;
  }

  let pitchClass: string;
  let velocity = 0.65;
  if (isDownbeat) {
    pitchClass = state.currentRoot;
    velocity = 0.85;
  } else if (isBeat3) {
    pitchClass = state.chordTones[2] ?? state.currentRoot; // 5th if available
    velocity = 0.75;
  } else {
    // Walk: pick a random chord tone.
    const idx = Math.floor(state.rng() * state.chordTones.length);
    pitchClass = state.chordTones[idx] ?? state.currentRoot;
    velocity = 0.6 + state.rng() * 0.1;
  }

  const pitch = `${pitchClass}${state.baseOctave}`;

  return {
    pitch,
    duration: '8n',
    velocity,
    time: scheduleTime,
  };
}

// ---------------------------------------------------------------------------
// Euclidean percussion
// ---------------------------------------------------------------------------

export interface PercPatterns {
  kick: boolean[];
  hat: boolean[];
  perc: boolean[];
}

/** Build the three Euclidean patterns for the current intensity. */
export function buildPercPatterns(intensity: number): PercPatterns {
  if (intensity < 0.25) {
    return {
      kick: euclideanRhythm(3, 16, 0),
      hat: euclideanRhythm(7, 16, 2),
      perc: euclideanRhythm(0, 16, 0),
    };
  }
  if (intensity < 0.7) {
    return {
      kick: euclideanRhythm(4, 16, 0),
      hat: euclideanRhythm(11, 16, 2),
      perc: euclideanRhythm(5, 16, 5),
    };
  }
  return {
    kick: euclideanRhythm(5, 16, 0),
    hat: euclideanRhythm(13, 16, 2),
    perc: euclideanRhythm(7, 16, 5),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Add positive jitter (in ms) to a scheduleTime. If the time is a Tone.js
 * notation string we tack on a `+0.00x` suffix; if it's a number we add
 * directly.
 */
function applyTimeJitter(
  scheduleTime: number | string,
  jitterMs: number,
): number | string {
  const sec = jitterMs / 1000;
  if (sec <= 0) return scheduleTime;
  if (typeof scheduleTime === 'number') return scheduleTime + sec;
  // For Tone notation strings, only append jitter if it looks safely additive
  // (no embedded '+' that would produce a doubly-additive expression).
  if (scheduleTime.includes('+')) return scheduleTime;
  return `${scheduleTime}+${sec.toFixed(4)}`;
}

// Re-export euclideanRhythm so callers (and tests) import from the agent's
// public surface rather than reaching into euclidean.ts directly.
export { euclideanRhythm };
