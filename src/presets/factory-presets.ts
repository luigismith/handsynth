// Owner: ux-curator
//
// Factory preset bank for the SettingsPanel. Each preset is a curated set of
// knob values that paints a distinctive sonic character on top of whatever
// vibe the user has chosen. Vibes (in `vibes.ts`) decide harmony / tempo /
// voicing; factory presets decide *timbre* — they tweak the FX chain only.
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

import type { AudioEngineParams } from '@contracts/contracts';

export interface FactoryPreset {
  id: string;
  /** Short, uppercase-ready display name (e.g. 'LUSH', 'ACID', 'DUB'). */
  name: string;
  /** One-line tagline shown on hover. */
  tagline: string;
  /** Knob values. Missing keys are not changed when the preset is applied. */
  params: Partial<AudioEngineParams> & { bpm?: number };
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
  },

  // rationale: 303 squelch. Low cutoff + sky-high Q yields the characteristic
  // resonant honk; mid drive adds bite without smashing. Low reverb keeps the
  // attack tight so the resonance reads as movement, not wash.
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
  },

  // rationale: wide-open filter, low Q, high brightness — let the harmonics
  // breathe. Drive dipped below 1 to avoid saturating the now-loud top end.
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
  },

  // rationale: opposite of BRIGHT — thunder under the feet. Low cutoff
  // smothers harmonics; warm drive (~1.4) adds tube-style weight without
  // resonance. Reverb low so it doesn't smear the low end into mud.
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
  },
] as const;
