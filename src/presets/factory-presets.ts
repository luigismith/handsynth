// Owner: ux-curator
//
// Factory preset bank for the SettingsPanel. Each preset is a curated set of
// knob values that paints a distinctive sonic character on top of whatever
// vibe the user has chosen. Vibes (in `vibes.ts`) decide harmony / tempo /
// voicing baseline; factory presets decide *timbre* — they tweak the FX
// chain AND, optionally, the oscillator + envelope of each pitched voice
// (see `voice` / VoiceShape). Without the voice overlay every preset would
// share the vibe's oscillator and they'd all sound the same — which is what
// users complained about, so post-fix every non-INIT preset ships a
// distinct VoiceShape.
//
// These are NOT user-savable; user patches live in `patches.ts` and a
// separate localStorage key. Factory presets ship in code so they can evolve
// with the synth and never go stale. They are applied as one-shots: clicking
// a chip pushes the params and updates the knob visuals, then the user is
// free to keep tweaking — there is no persistent "active preset" state.
//
// Tuning rules of thumb:
//   brightness       0..1     — wavetable position / wave shape morph
//   filterCutoff     200..16000 Hz (log)
//   filterResonance  0.5..14
//   saturatorDrive   0.5..3
//   reverbWet        0..1
//   delayFeedback    0..0.95
//   delayWet         0..1
//   masterDuck       0 (presets shouldn't duck)
//   bpm              optional — only set when tempo is part of the identity
//   voice            optional VoiceShape — see `src/audio/voice-shape.ts`

import type { AudioEngineParams } from '@contracts/contracts';
import type { VoiceShape } from '@audio/voice-shape';

export interface FactoryPreset {
  id: string;
  /** Short, uppercase-ready display name (e.g. 'LUSH', 'ACID', 'DUB'). */
  name: string;
  /** One-line tagline shown on hover. */
  tagline: string;
  /** Knob values. Missing keys are not changed when the preset is applied. */
  params: Partial<AudioEngineParams> & { bpm?: number };
  /**
   * Optional oscillator + envelope overlay applied AFTER `setParams`. Without
   * this every preset shares the current vibe's oscillator (which is why pre-
   * fix users reported "i preset sembrano tutti uguali"). Each non-INIT
   * preset below carries a distinct `voice` so its timbre identity is real.
   * INIT intentionally omits `voice` — the user wants to hear the unmodified
   * vibe defaults when they reset.
   */
  voice?: VoiceShape;
}

export const FACTORY_PRESETS: readonly FactoryPreset[] = [
  // rationale: a true neutral. Resets the FX chain to the panel's fallback
  // values so the user can hear the bare vibe again before exploring.
  {
    id: 'init',
    name: 'INIT',
    tagline: 'Neutral knobs — clean reset on top of the current vibe.',
    params: {
      filterCutoff: 8000,
      filterResonance: 1.0,
      brightness: 0.5,
      saturatorDrive: 1.0,
      reverbWet: 0.4,
      delayFeedback: 0.35,
      delayWet: 0.3,
      masterDuck: 0,
    },
  },

  // rationale: wide pad territory — drown the dry signal in verb, ease the
  // filter Q so resonant peaks don't sting, soften the brightness to roll
  // off the harsh top end. Drive is dialed back so the pad stays glassy.
  // Voice: huge supersaw pad with very long attack/release, sine-FM lead
  // for that glassy Tycho top, fatsquare bass with a moderate sub.
  {
    id: 'lush',
    name: 'LUSH',
    tagline: 'Wide pad — high reverb, smooth top end, low resonance.',
    params: {
      filterCutoff: 9000,
      filterResonance: 0.8,
      brightness: 0.4,
      saturatorDrive: 0.85,
      reverbWet: 0.85,
      delayFeedback: 0.3,
      delayWet: 0.35,
      masterDuck: 0,
    },
    voice: {
      pad: { waveform: 'fatsawtooth', detuneCents: 24, attack: 1.5, release: 4 },
      lead: { oscType: 'fmsine', modIndex: 1.5, harmonicity: 1, attack: 0.05, release: 1.2 },
      bass: { waveform: 'fatsquare', subLevel: 0.5 },
    },
  },

  // rationale: 303 squelch. Low cutoff + sky-high Q yields the characteristic
  // resonant honk; mid drive adds bite without smashing. Low reverb keeps the
  // attack tight so the resonance reads as movement, not wash.
  // Voice: tight fatsquare pad (short attack — pad is more rhythmic than
  // ambient here), 303-style sawtooth lead with snappy envelope and high
  // mod index for a buzzy edge, square bass with light sub.
  {
    id: 'acid',
    name: 'ACID',
    tagline: '303 squelch — low cutoff, screaming resonance, mid drive.',
    params: {
      filterCutoff: 1200,
      filterResonance: 11,
      brightness: 0.7,
      saturatorDrive: 1.8,
      reverbWet: 0.18,
      delayFeedback: 0.4,
      delayWet: 0.25,
      masterDuck: 0,
    },
    voice: {
      pad: { waveform: 'fatsquare', detuneCents: 6, attack: 0.1, release: 0.6 },
      lead: { oscType: 'sawtooth', modIndex: 8, harmonicity: 1, attack: 0.005, release: 0.3 },
      bass: { waveform: 'square', subLevel: 0.3 },
    },
  },

  // rationale: classic dub bus — feedback-saturated delay tail, dark filter,
  // long verb. Slower BPM is part of the identity. Drive stays moderate so
  // the repeats build into a cloud rather than collapse into mush.
  {
    id: 'dub',
    name: 'DUB',
    tagline: 'Echo chamber — huge delay feedback, dark filter, slow.',
    params: {
      filterCutoff: 1800,
      filterResonance: 1.5,
      brightness: 0.35,
      saturatorDrive: 1.2,
      reverbWet: 0.7,
      delayFeedback: 0.78,
      delayWet: 0.6,
      masterDuck: 0,
      bpm: 78,
    },
    // Voice: square-wave pad smeared by detune for that "stoned" feel,
    // soft FM-sine lead with sub-octave harmonicity (octave-down modulator)
    // for a deeper-than-it-looks tone, bold fatsawtooth bass with the sub
    // pushed near unity — dub is felt as much as heard.
    voice: {
      pad: { waveform: 'fmsquare', detuneCents: 18, attack: 0.8, release: 5 },
      lead: { oscType: 'fmsine', modIndex: 2, harmonicity: 0.5, attack: 0.1, release: 1.5 },
      bass: { waveform: 'fatsawtooth', subLevel: 0.85 },
    },
  },

  // rationale: wide-open filter, low Q, high brightness — let the harmonics
  // breathe. Drive dipped below 1 to avoid saturating the now-loud top end.
  // Voice: shimmery supersaw pad with mid attack for "rising" feel,
  // high-modulation FM saw lead (clangy / metallic at modIndex 12,
  // harmonicity 2 puts the modulator an octave above), saw bass with a
  // small sub.
  {
    id: 'bright',
    name: 'BRIGHT',
    tagline: 'Lights on — wide-open filter, airy top, low drive.',
    params: {
      filterCutoff: 12000,
      filterResonance: 0.7,
      brightness: 0.85,
      saturatorDrive: 0.8,
      reverbWet: 0.35,
      delayFeedback: 0.25,
      delayWet: 0.25,
      masterDuck: 0,
    },
    voice: {
      pad: { waveform: 'fatsawtooth', detuneCents: 14, attack: 0.4, release: 2 },
      lead: { oscType: 'fmsawtooth', modIndex: 12, harmonicity: 2, attack: 0.01, release: 0.7 },
      bass: { waveform: 'fatsawtooth', subLevel: 0.4 },
    },
  },

  // rationale: opposite of BRIGHT — thunder under the feet. Low cutoff
  // smothers harmonics; warm drive (~1.4) adds tube-style weight without
  // resonance. Reverb low so it doesn't smear the low end into mud.
  // Voice: pure triangle pad (warm, no buzz), a soft FM-sine lead that
  // barely modulates (modIndex 0.8 ≈ subtle inharmonic shimmer), full-sub
  // fatsaw bass — dark = boomy, not just dim.
  {
    id: 'dark',
    name: 'DARK',
    tagline: 'Smothered — low cutoff, warm drive, sparse reverb.',
    params: {
      filterCutoff: 600,
      filterResonance: 1.2,
      brightness: 0.2,
      saturatorDrive: 1.4,
      reverbWet: 0.2,
      delayFeedback: 0.3,
      delayWet: 0.2,
      masterDuck: 0,
    },
    voice: {
      pad: { waveform: 'triangle', detuneCents: 8, attack: 1.2, release: 5 },
      lead: { oscType: 'fmsine', modIndex: 0.8, harmonicity: 1, attack: 0.15, release: 1.2 },
      bass: { waveform: 'fatsawtooth', subLevel: 1.0 },
    },
  },

  // rationale: vintage tape — moderate drive for analog warmth, mid reverb
  // for room ambience, slight brightness lift to mimic tape's high-end
  // sparkle. Faster BPM bias suits the up-tempo character of tape-loop
  // genres.
  {
    id: 'tape',
    name: 'TAPE',
    tagline: 'Analog warmth — saturated drive, mid verb, tape sparkle.',
    params: {
      filterCutoff: 7500,
      filterResonance: 1.0,
      brightness: 0.6,
      saturatorDrive: 1.6,
      reverbWet: 0.45,
      delayFeedback: 0.45,
      delayWet: 0.35,
      masterDuck: 0,
      bpm: 105,
    },
    // Voice: AM-modulated saw pad (the AM tremolo evokes tape wow), pulse
    // lead with FM modulation for that "out-of-tune chorused tape head"
    // wobble (harmonicity 1.5), fatsquare bass with mid sub. Pulse leads
    // were a 70s-tape-era staple — Genesis / Floyd territory.
    voice: {
      pad: { waveform: 'amsawtooth', detuneCents: 12, attack: 0.6, release: 3 },
      lead: { oscType: 'pulse', modIndex: 4, harmonicity: 1.5, attack: 0.02, release: 0.9 },
      bass: { waveform: 'fatsquare', subLevel: 0.6 },
    },
  },

  // rationale: let everything ring out. Maximum reverb, slowed-down tempo,
  // moderate brightness so the wash has motion. Filter wide-ish so high
  // overtones survive into the tail.
  {
    id: 'space',
    name: 'SPACE',
    tagline: 'Vacuum drift — max reverb, slow tempo, ringing tail.',
    params: {
      filterCutoff: 9500,
      filterResonance: 0.9,
      brightness: 0.55,
      saturatorDrive: 0.9,
      reverbWet: 1.0,
      delayFeedback: 0.5,
      delayWet: 0.45,
      masterDuck: 0,
      bpm: 82,
    },
    // Voice: airy FM-sine pad with massive detune for choral width and a
    // 2.5s attack so chord changes drift in like wind, AM-sine lead for a
    // breathy tremolo-vocal feel, sine bass with near-full sub for
    // sub-rumble — SPACE is all about the low end you feel through the
    // floor.
    voice: {
      pad: { waveform: 'fmsine', detuneCents: 28, attack: 2.5, release: 6 },
      lead: { oscType: 'amsine', modIndex: 5, harmonicity: 0.75, attack: 0.4, release: 2.5 },
      bass: { waveform: 'sine', subLevel: 0.95 },
    },
  },
] as const;
