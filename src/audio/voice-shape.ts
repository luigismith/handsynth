// Owner: audio-engineer
//
// VoiceShape — a per-engine oscillator + envelope overlay that a factory preset
// can attach to its `params` so each preset has its own *timbre* identity, not
// just a different FX chain. Vibes (in `vibes.ts`) still own the baseline
// voicing for each engine; a VoiceShape applied AFTER `loadVibe` overrides
// only the fields that are explicitly set, so missing fields = leave the
// engine's current setting alone.
//
// We deliberately keep this file tiny and standalone (rather than extending
// `@contracts/contracts`) because the contracts file has another agent
// actively editing it; this avoids a merge dance.
//
// Field design notes:
//   * `waveform`/`oscType` are typed `string` (not `OmniOscillatorType`) on
//     purpose — Tone's narrow exported osc-type union doesn't include the
//     'fmsawtooth' / 'fatsquare' / 'amsine' literals that work fine at
//     runtime. Engine code casts these at the boundary (see PadEngine's
//     `setOscType` helper) so callers can write the natural literal here.
//   * `detuneCents` is the TOTAL spread between the two pad layers; the
//     engine internally splits it ±half. Matches the convention already used
//     by VibePreset.pad.detuneCents.
//   * `subLevel` is normalized 0..1 (mix knob feel), not dB. The engine maps
//     it to a dB curve (-Infinity at 0, 0 dB at 1).

/**
 * Per-engine oscillator + envelope overlay applied on top of whatever the
 * current vibe set. A factory preset attaches one of these to its `params`
 * to give each preset its own timbre identity (not just a different FX
 * chain). Missing fields = leave the engine's current setting alone.
 */
export interface VoiceShape {
  pad?: {
    /** OmniOscillator type: 'fatsawtooth' | 'fatsquare' | 'fmsine' | 'amsine' | 'pulse' | 'triangle' | 'sawtooth' | 'square' | etc. */
    waveform?: string;
    /** Per-layer detune in cents (overall spread = 2x this). */
    detuneCents?: number;
    /** Envelope attack in seconds (0.05..3). */
    attack?: number;
    /** Envelope release in seconds (0.5..6). */
    release?: number;
  };
  lead?: {
    /** OmniOscillator type. Common: 'fmsawtooth', 'fmsine', 'amsquare', 'pulse', 'sawtooth', 'square'. */
    oscType?: string;
    /** FM modulation index (0..20). Higher = more harmonics / clang. */
    modIndex?: number;
    /** FM harmonicity (0.5..4). Ratio between carrier and modulator. */
    harmonicity?: number;
    /** Envelope attack in seconds. */
    attack?: number;
    /** Envelope release in seconds. */
    release?: number;
  };
  bass?: {
    /** OmniOscillator type. 'fatsquare' | 'fatsawtooth' | 'square' | 'triangle' | 'sine'. */
    waveform?: string;
    /** Sub-oscillator gain 0..1 (mix of sine sub layer below the main waveform). */
    subLevel?: number;
  };
}
