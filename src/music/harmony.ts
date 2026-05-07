// Owner: music-brain
//
// Harmony helpers. Wraps `@tonaljs/tonal` for chord parsing, voicing,
// inversion, and scale-aware note picking. Pure functions — no I/O, no state.
//
// Tonal quirks worth noting:
//  - `Chord.get(symbol).notes` returns pitch-class notes (no octave). We
//    octave-place them ourselves when building voicings.
//  - Tonal accepts both `'F#maj9'` and `'F# maj9'`. Vibe presets sometimes
//    have a stray space (e.g. `'Bb maj7'`); we normalize before parsing.
//  - Some chord queries return `notes: []` if the symbol is unknown. Any
//    function here treats an empty list as a hard failure and falls back to
//    the chord root or the scale tonic — never a wrong note.
//  - `Note.midi` returns null for invalid input; we coerce to a sensible
//    default (60 = C4) when comparing distances.

import { Chord, Note, Scale } from '@tonaljs/tonal';
import {
  CHORD_TONE_DEGREES,
  CONSONANT_TENSIONS,
  PITCH_CLASS_TO_CHROMA,
} from './theory-data';

export interface ScaleInfo {
  tonic: string;
  mode: string;
  /** Pitch-class notes in scientific spelling, e.g. ['F#','G#','A#','B','C#','D#','E#']. */
  notes: string[];
  /** Pitch-class chroma set (0..11) for fast lookup. */
  chromaSet: Set<number>;
}

const DEFAULT_OCTAVE = 4;
const MIDI_C4 = 60;

// ---------------------------------------------------------------------------
// Symbol normalisation
// ---------------------------------------------------------------------------

/**
 * Vibe presets sometimes contain stray spaces ("Bb maj7"). Tonal will parse
 * "Bbmaj7" cleanly; "Bb maj7" can be ambiguous. Normalize by collapsing the
 * space between root and quality.
 */
export function normalizeChordSymbol(symbol: string): string {
  return symbol.replace(/^([A-G][#b]?)\s+/, '$1');
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

export function getScale(tonic: string, mode: string): ScaleInfo {
  const scale = Scale.get(`${tonic} ${mode}`);
  // Scale.get returns notes as pitch classes (no octave) for a tonic+mode.
  const notes = scale.notes.length > 0 ? scale.notes : [tonic];
  const chromaSet = new Set<number>();
  for (const n of notes) {
    const chroma = pitchClassChroma(n);
    if (chroma >= 0) chromaSet.add(chroma);
  }
  return { tonic, mode, notes, chromaSet };
}

export function isInScale(note: string, scale: ScaleInfo): boolean {
  const chroma = Note.chroma(stripOctave(note));
  if (typeof chroma !== 'number' || Number.isNaN(chroma)) return false;
  return scale.chromaSet.has(chroma);
}

export function nearestScaleNote(note: string, scale: ScaleInfo): string {
  const targetMidi = noteMidi(note);
  let best = scale.notes[0] ?? scale.tonic;
  let bestDist = Number.POSITIVE_INFINITY;
  // Search ±2 octaves around the target so nearestScaleNote can return any
  // octave. We pick the closest actual MIDI distance.
  const targetOct = octaveOf(note);
  for (let oct = targetOct - 1; oct <= targetOct + 1; oct++) {
    for (const pc of scale.notes) {
      const candidate = `${pc}${oct}`;
      const cMidi = noteMidi(candidate);
      const dist = Math.abs(cMidi - targetMidi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Chord tones
// ---------------------------------------------------------------------------

/**
 * Pitch-class chord tones from a chord symbol. Returns spelled notes (no
 * octave). Falls back to the chord root if Tonal returns nothing.
 */
export function getChordTones(chordSymbol: string): string[] {
  const sym = normalizeChordSymbol(chordSymbol);
  const c = Chord.get(sym);
  if (c.notes.length > 0) return c.notes;
  // Defensive fallback — empty notes means parse failure.
  if (c.tonic) return [c.tonic];
  // Last-resort: try to extract a leading note name.
  const m = /^([A-G][#b]?)/.exec(sym);
  return m && m[1] ? [m[1]] : ['C'];
}

export function nearestChordTone(note: string, chordSymbol: string): string {
  const tones = getChordTones(chordSymbol);
  if (tones.length === 0) return note;
  const targetMidi = noteMidi(note);
  const targetOct = octaveOf(note);
  let best = `${tones[0]}${targetOct}`;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let oct = targetOct - 1; oct <= targetOct + 1; oct++) {
    for (const pc of tones) {
      const candidate = `${pc}${oct}`;
      const cMidi = noteMidi(candidate);
      const dist = Math.abs(cMidi - targetMidi);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Approximate consonance check: chord tones (R, 3, 5, 7) plus tasteful
 * extensions (9, 13). The 11 over a major chord is intentionally NOT
 * consonant — it clashes with the major 3. b9 is also avoided over major.
 */
export function isConsonantTension(note: string, chordSymbol: string): boolean {
  const sym = normalizeChordSymbol(chordSymbol);
  const c = Chord.get(sym);
  if (!c.tonic) return false;
  const noteChroma = pitchClassChroma(note);
  if (noteChroma < 0) return false;
  const rootChroma = pitchClassChroma(c.tonic);
  if (rootChroma < 0) return false;
  const interval = (noteChroma - rootChroma + 12) % 12;
  // Always consonant — chord tones.
  if (CHORD_TONE_DEGREES.has(interval)) return true;
  // Quality-aware tensions.
  const isMajorish = c.quality === 'Major' || /maj|M(?!i)/i.test(c.aliases[0] ?? c.type);
  const isMinor = c.quality === 'Minor';
  // Major-flavored chords admit 9 (2) and 13 (9). Avoid 11 (5) and b9 (1).
  if (isMajorish) {
    if (CONSONANT_TENSIONS.major.has(interval)) return true;
    return false;
  }
  // Minor chords admit 9, 11, 13. Avoid b9.
  if (isMinor) {
    if (CONSONANT_TENSIONS.minor.has(interval)) return true;
    return false;
  }
  // Dominant or unknown — admit 9, 13. b9 only if explicitly named.
  if (CONSONANT_TENSIONS.dominant.has(interval)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Voicings
// ---------------------------------------------------------------------------

export type VoicingStyle = 'drop2' | 'quartal' | 'open';
export type Register = 'low' | 'mid' | 'high';

export interface VoicingOpts {
  register: Register;
  voicingStyle: VoicingStyle;
}

const REGISTER_OCTAVE: Record<Register, number> = {
  low: 2,
  mid: 4,
  high: 5,
};

/**
 * Build a voicing for a chord. Never returns a block (root-position) chord —
 * voicings are always spread to avoid mud. Avoids root in low register if the
 * caller asked for mid/high (the bass takes the root).
 */
export function buildVoicing(chordSymbol: string, opts: VoicingOpts): string[] {
  const tones = getChordTones(chordSymbol);
  if (tones.length === 0) return [];
  const baseOctave = REGISTER_OCTAVE[opts.register];

  switch (opts.voicingStyle) {
    case 'drop2':
      return drop2Voicing(tones, baseOctave);
    case 'quartal':
      return quartalVoicing(tones, baseOctave);
    case 'open':
      return openVoicing(tones, baseOctave);
    default:
      return drop2Voicing(tones, baseOctave);
  }
}

/**
 * Drop-2: from a closed chord (e.g. R 3 5 7), drop the second-from-top voice
 * down an octave. Yields an open spread that sits well in the mid-register.
 * For triads (3 voices) we treat it as drop the 2nd voice.
 */
function drop2Voicing(tones: string[], baseOctave: number): string[] {
  let placed = stackAscending(tones, baseOctave);
  // Some symbols (e.g. unrecognized slash chords) yield only the root from
  // tonal. Guarantee at least two voices by adding the octave above so the
  // pad never collapses to a single note.
  if (placed.length === 1) {
    const only = placed[0];
    if (only) placed = [only, transposeOctaves(only, 1)];
  }
  if (placed.length < 2) return placed;
  const idxFromTop = 1; // second from top
  const dropIdx = placed.length - 1 - idxFromTop;
  const target = placed[dropIdx];
  if (!target) return placed;
  const dropped = transposeOctaves(target, -1);
  const result = [...placed];
  result[dropIdx] = dropped;
  result.sort((a, b) => noteMidi(a) - noteMidi(b));
  return result;
}

/** Quartal: stack perfect fourths from the chord's 5th, 9th, 3rd. */
function quartalVoicing(tones: string[], baseOctave: number): string[] {
  const root = tones[0];
  if (!root) return [];
  const pcs = [
    tones[1] ?? root, // 3rd-ish
    tones[2] ?? root, // 5th-ish
    tones[3] ?? tones[1] ?? root, // 7th/9th
  ];
  // Place pcs so each is at least a perfect fourth above the previous.
  const out: string[] = [];
  let prevMidi = MIDI_C4 + (baseOctave - DEFAULT_OCTAVE) * 12;
  for (const pc of pcs) {
    let candidate = `${pc}${baseOctave}`;
    let candidateMidi = noteMidi(candidate);
    while (candidateMidi - prevMidi < 5) {
      // less than perfect fourth
      candidate = transposeOctaves(candidate, 1);
      candidateMidi = noteMidi(candidate);
    }
    out.push(candidate);
    prevMidi = candidateMidi;
  }
  return out;
}

/** Open voicing: R - 5 - 9 - 3, register-aware. Skips root for mid/high. */
function openVoicing(tones: string[], baseOctave: number): string[] {
  const root = tones[0];
  if (!root) return [];
  const fifth = tones[2] ?? tones[1] ?? root;
  const third = tones[1] ?? root;
  const seventhOrNine = tones[3] ?? tones[1] ?? root;
  const includeRoot = baseOctave <= 3;
  const pcs = includeRoot
    ? [root, fifth, third, seventhOrNine]
    : [fifth, seventhOrNine, third];
  return stackAscending(pcs, baseOctave);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Place a list of pitch classes in ascending order starting from baseOctave.
 * If two pitch classes would collide or step backwards, bump up an octave.
 */
function stackAscending(pcs: string[], baseOctave: number): string[] {
  const result: string[] = [];
  let oct = baseOctave;
  let lastMidi = -Infinity;
  for (const pc of pcs) {
    let candidate = `${pc}${oct}`;
    let midi = noteMidi(candidate);
    while (midi <= lastMidi) {
      oct++;
      candidate = `${pc}${oct}`;
      midi = noteMidi(candidate);
    }
    result.push(candidate);
    lastMidi = midi;
  }
  return result;
}

function transposeOctaves(note: string, octaves: number): string {
  const oct = octaveOf(note);
  const pc = stripOctave(note);
  return `${pc}${oct + octaves}`;
}

/** Strip the trailing octave digit(s) from a note like 'C#4' → 'C#'. */
export function stripOctave(note: string): string {
  return note.replace(/-?\d+$/, '');
}

/** Octave of a note; defaults to DEFAULT_OCTAVE if unspecified. */
export function octaveOf(note: string): number {
  const m = /(-?\d+)$/.exec(note);
  return m && m[1] ? parseInt(m[1], 10) : DEFAULT_OCTAVE;
}

/** Note's MIDI number; defaults to MIDI_C4 if invalid. */
export function noteMidi(note: string): number {
  const m = Note.midi(note);
  if (typeof m === 'number') return m;
  // Fall back to assuming default octave.
  const m2 = Note.midi(`${stripOctave(note)}${DEFAULT_OCTAVE}`);
  return typeof m2 === 'number' ? m2 : MIDI_C4;
}

/** Pitch-class chroma (0..11) using a small canonical lookup. */
function pitchClassChroma(note: string): number {
  const pc = stripOctave(note);
  const direct = PITCH_CLASS_TO_CHROMA.get(pc);
  if (typeof direct === 'number') return direct;
  const chroma = Note.chroma(pc);
  return typeof chroma === 'number' ? chroma : -1;
}
