// Owner: ux-curator (data only — consumed by SettingsPanel + MusicBrain)
//
// Twelve chromatic keys used as the SettingsPanel "KEY" dropdown options.
// `id` is the sharp-form spelling (used by tonal for scale construction);
// `displayName` shows the flat alternative for the five accidentals so
// players who think in flats aren't confused.

export interface KeyOption {
  /** Tonic note used by tonal — sharp form. */
  id: string;
  /** Display label shown to the user. */
  displayName: string;
}

export const KEY_OPTIONS: readonly KeyOption[] = [
  { id: 'C',  displayName: 'C' },
  { id: 'C#', displayName: 'C# / Db' },
  { id: 'D',  displayName: 'D' },
  { id: 'D#', displayName: 'D# / Eb' },
  { id: 'E',  displayName: 'E' },
  { id: 'F',  displayName: 'F' },
  { id: 'F#', displayName: 'F# / Gb' },
  { id: 'G',  displayName: 'G' },
  { id: 'G#', displayName: 'G# / Ab' },
  { id: 'A',  displayName: 'A' },
  { id: 'A#', displayName: 'A# / Bb' },
  { id: 'B',  displayName: 'B' },
] as const;

/** Convenience set for cheap O(1) validation. */
export const KEY_OPTION_IDS: ReadonlySet<string> = new Set(
  KEY_OPTIONS.map((k) => k.id),
);

/**
 * Normalize a tonic into the canonical sharp form used as a `KeyOption.id`.
 * Vibe presets sometimes spell tonics with flats (`'Bb'`, `'Eb'`); we map
 * them so the dropdown can highlight the right option even when the active
 * vibe spells its scale flat.
 */
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

export function normalizeKeyId(tonic: string): string {
  if (KEY_OPTION_IDS.has(tonic)) return tonic;
  const flat = FLAT_TO_SHARP[tonic];
  if (flat) return flat;
  // Strip an octave number if a fully-spelled note slipped through.
  const stripped = tonic.replace(/-?\d+$/, '');
  if (KEY_OPTION_IDS.has(stripped)) return stripped;
  const fallback = FLAT_TO_SHARP[stripped];
  if (fallback) return fallback;
  return tonic;
}
