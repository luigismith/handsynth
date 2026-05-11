// Owner: ux-curator (data only — consumed by SettingsPanel + AudioEngine)
//
// Curated list of OmniOscillator types shown in the PATCH editor's VOCE
// section as the explicit "pick a waveform" dropdown per voice (pad / lead /
// bass). Each `id` is a literal string accepted by Tone's OmniOscillator
// (passed through to `set({oscillator: {type: <id>}})`); `displayName` is
// the terminal-style label rendered in the dropdown.
//
// Why a curated subset and not every OmniOscillator literal: the full union
// also includes `am*`, `fm*`, `fat*` of every base wave plus the "partials"
// form. Most of those are interesting variants; we ship the 13 musically
// distinct ones below so the dropdown stays scannable. The audio engine
// itself still accepts any string at runtime (the engines' setOscType
// helpers cast at the boundary), so future additions only need to land here.

export interface WaveformOption {
  /** OmniOscillator type literal — passed to Tone .set({oscillator:{type}}). */
  id: string;
  /** Display label (uppercase, terminal-style). */
  displayName: string;
}

export const WAVEFORM_OPTIONS: readonly WaveformOption[] = [
  { id: 'sine',        displayName: 'SINE' },
  { id: 'triangle',    displayName: 'TRIANGLE' },
  { id: 'sawtooth',    displayName: 'SAWTOOTH' },
  { id: 'square',      displayName: 'SQUARE' },
  { id: 'pulse',       displayName: 'PULSE' },
  { id: 'fatsine',     displayName: 'FAT SINE' },
  { id: 'fattriangle', displayName: 'FAT TRIANGLE' },
  { id: 'fatsawtooth', displayName: 'FAT SAWTOOTH' },
  { id: 'fatsquare',   displayName: 'FAT SQUARE' },
  { id: 'fmsine',      displayName: 'FM SINE' },
  { id: 'fmsawtooth',  displayName: 'FM SAWTOOTH' },
  { id: 'amsine',      displayName: 'AM SINE' },
  { id: 'amsawtooth',  displayName: 'AM SAWTOOTH' },
] as const;

/** Convenience set for cheap O(1) validation. */
export const WAVEFORM_OPTION_IDS: ReadonlySet<string> = new Set(
  WAVEFORM_OPTIONS.map((o) => o.id),
);
