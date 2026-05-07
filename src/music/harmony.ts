// Owner: music-brain
//
// Harmony helpers. Wraps `@tonaljs/tonal` for chord parsing, voicing,
// inversion, and scale-aware note picking. Pure functions — no I/O, no state.

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by music-brain';

/** Expand a chord symbol to a voicing within an octave range. */
export function voiceChord(_symbol: string, _octave = 4): string[] {
  throw new Error(NOT_IMPL);
}

/** Pick a scale-degree note for the lead, biased by intensity. */
export function pickScaleNote(
  _scale: { tonic: string; mode: string },
  _intensity: number,
): string {
  throw new Error(NOT_IMPL);
}

/** Bass note for a chord — usually the root, sometimes the 5th or 3rd. */
export function bassNoteFor(_symbol: string): string {
  throw new Error(NOT_IMPL);
}
