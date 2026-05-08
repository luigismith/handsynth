// Owner: ux-curator (data only — consumed by SettingsPanel + MusicBrain)
//
// Curated list of scales/modes shown in the SettingsPanel "SCALE" dropdown.
// Each `id` is a string accepted by `@tonaljs/tonal`'s Scale.get and by our
// own getScale() in `src/music/harmony.ts`. The ids were verified against
// tonal at the time of writing — see harmony.test.ts walk-the-list test.
//
// `vibe` is a grouping hint for future UI affordances (we currently just
// list them in the order below, but the field lets us colour-code or sub-
// section the dropdown without recompiling its source-of-truth).

export type ScaleVibe = 'bright' | 'dark' | 'tense' | 'mysterious' | 'neutral';

export interface ScaleOption {
  /** Mode string passed to `getScale(tonic, mode)` — must be tonal-compatible. */
  id: string;
  /** Display label shown in the dropdown. */
  displayName: string;
  /** Grouping hint. */
  vibe: ScaleVibe;
}

export const SCALE_OPTIONS: readonly ScaleOption[] = [
  { id: 'major',            displayName: 'Major (Ionian)',      vibe: 'bright' },
  { id: 'minor',            displayName: 'Minor (Aeolian)',     vibe: 'dark' },
  { id: 'harmonic minor',   displayName: 'Harmonic Minor',      vibe: 'mysterious' },
  { id: 'melodic minor',    displayName: 'Melodic Minor',       vibe: 'tense' },
  { id: 'dorian',           displayName: 'Dorian',              vibe: 'neutral' },
  { id: 'phrygian',         displayName: 'Phrygian',            vibe: 'dark' },
  { id: 'lydian',           displayName: 'Lydian',              vibe: 'bright' },
  { id: 'mixolydian',       displayName: 'Mixolydian',          vibe: 'neutral' },
  { id: 'locrian',          displayName: 'Locrian',             vibe: 'tense' },
  { id: 'major pentatonic', displayName: 'Pentatonic Major',    vibe: 'bright' },
  { id: 'minor pentatonic', displayName: 'Pentatonic Minor',    vibe: 'dark' },
  { id: 'blues',            displayName: 'Blues',               vibe: 'tense' },
  { id: 'chromatic',        displayName: 'Chromatic (no snap)', vibe: 'neutral' },
] as const;

/** Convenience set for cheap O(1) validation. */
export const SCALE_OPTION_IDS: ReadonlySet<string> = new Set(
  SCALE_OPTIONS.map((s) => s.id),
);

/** Pick a display label by id; falls back to the id itself. */
export function scaleDisplayName(id: string): string {
  return SCALE_OPTIONS.find((s) => s.id === id)?.displayName ?? id;
}
