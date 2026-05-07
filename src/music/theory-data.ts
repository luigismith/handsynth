// Owner: music-brain
//
// Static music-theory lookup tables. Pure data — kept separate from
// `harmony.ts` so the consonance / chord-tone / Markov logic can reference a
// single source of truth.

// ---------------------------------------------------------------------------
// Pitch-class chroma — covers the spellings seen in vibe presets, including
// double-sharps and B# / E# enharmonics. `@tonaljs/tonal` returns these
// correctly too, but a local map saves a few hundred lookups per second.
// ---------------------------------------------------------------------------

export const PITCH_CLASS_TO_CHROMA = new Map<string, number>([
  ['C', 0],
  ['C#', 1],
  ['Db', 1],
  ['D', 2],
  ['D#', 3],
  ['Eb', 3],
  ['E', 4],
  ['Fb', 4],
  ['E#', 5],
  ['F', 5],
  ['F#', 6],
  ['Gb', 6],
  ['G', 7],
  ['G#', 8],
  ['Ab', 8],
  ['A', 9],
  ['A#', 10],
  ['Bb', 10],
  ['B', 11],
  ['Cb', 11],
  ['B#', 0],
]);

// ---------------------------------------------------------------------------
// Consonance: which interval classes count as chord tones vs. tasteful
// extensions, indexed by chord quality.
// ---------------------------------------------------------------------------

/**
 * Intervals (semitones from root) that are unconditionally chord tones —
 * R, 3 (major or minor), 5, 7. The interval 5 (perfect 4) is intentionally
 * NOT in this set: over a major chord it clashes with the major 3, so we
 * treat it as a quality-dependent extension below.
 */
export const CHORD_TONE_DEGREES = new Set<number>([
  0, // root
  3, // minor 3
  4, // major 3
  7, // perfect 5
  10, // minor 7
  11, // major 7
]);

/**
 * Tasteful extensions per quality — intervals that are NOT chord tones but
 * sound consonant for that quality. Anything outside this set +
 * CHORD_TONE_DEGREES is treated as a clash and replaced by the nearest
 * chord tone.
 *
 * - 9 (2 semitones) is generally safe.
 * - 11 (5) collides with the major 3 — only allowed for minor / dominant
 *   sus contexts.
 * - 13 (9) is safe over major, minor, and dominant.
 * - b9 (1) and tritones (6) are excluded everywhere except dominant b9 /
 *   altered chords, which we don't synthesize from progressions in this
 *   version.
 */
export const CONSONANT_TENSIONS = {
  major: new Set<number>([2, 9]), // 9 and 13
  minor: new Set<number>([2, 5, 9]), // 9, 11, 13
  dominant: new Set<number>([2, 5, 9]), // 9, sus4, 13
};
