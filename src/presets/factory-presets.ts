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
// As of the intelligent-voicing pass, each VoiceShape additionally carries
// per-voice `timbre` values 0..1 — the user-facing analog "WAVE" knob — so
// each preset has a sensible spot on the A↔B crossfade by default. The
// smart router then layers ±0.15 contextual nudges on top (see
// `src/audio/smart-voicing.ts`).
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
//   voice.{pad,lead,bass}.timbre  0..1 — crossfade A (oscillator) ↔ B
//                                      (sine / pulse / triangle morph dest)

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
  // Timbres lean toward B for pad/lead (sine/pulse glass) and stay near A
  // for bass (we want the square punch as the harmonic counterpart to all
  // that reverb wash).
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
    // DIFFERENTIATION FIX: timbre values lowered from 0.65/0.4/0.25 →
    // 0.20/0.10/0.10. With the B-side always being pure sine (pad),
    // pulse (lead), triangle (bass), high timbre defaults were washing
    // out the A-side characteristic waveform of every preset — making
    // them all sound like "sine pad + a hint of the original". Range
    // is now compressed to 0.0..0.4 so the A-side always dominates.
    voice: {
      pad: { waveform: 'fatsawtooth', detuneCents: 24, attack: 1.5, release: 4, timbre: 0.20 },
      lead: { oscType: 'fmsine', modIndex: 1.5, harmonicity: 1, attack: 0.05, release: 1.2, timbre: 0.10 },
      bass: { waveform: 'fatsquare', subLevel: 0.5, timbre: 0.10 },
    },
  },

  // rationale: 303 squelch. Low cutoff + sky-high Q yields the characteristic
  // resonant honk; mid drive adds bite without smashing. Low reverb keeps the
  // attack tight so the resonance reads as movement, not wash.
  // Voice: tight fatsquare pad (short attack — pad is more rhythmic than
  // ambient here), 303-style sawtooth lead with snappy envelope and high
  // mod index for a buzzy edge, square bass with light sub.
  // Timbres lean toward A across the board — we want the harmonic content
  // (saw / square) to feed the resonant filter. Pad slightly toward B for
  // a subtle inner sine to keep it readable through the screaming Q.
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
    // DIFFERENTIATION FIX: ACID wants raw buzz — pull every voice almost
    // entirely to A-side (the resonant filter feeds on the square/saw
    // harmonics; the sine B-side would only soften the 303 honk).
    voice: {
      pad: { waveform: 'fatsquare', detuneCents: 6, attack: 0.1, release: 0.6, timbre: 0.05 },
      lead: { oscType: 'sawtooth', modIndex: 8, harmonicity: 1, attack: 0.005, release: 0.3, timbre: 0.00 },
      bass: { waveform: 'square', subLevel: 0.3, timbre: 0.00 },
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
    // Timbres: pad and lead a touch toward B (the long delay tail wants a
    // round, low-harmonic body so the repeats don't pile up into mud); bass
    // stays near A so the fatsaw harmonic skeleton survives the wash.
    // DIFFERENTIATION FIX: DUB's fmsquare pad smear IS the character —
    // a tiny sine sweetening (0.25) helps the long delay tail stay round
    // without piling up, but 60% sine was washing the smear entirely.
    voice: {
      pad: { waveform: 'fmsquare', detuneCents: 18, attack: 0.8, release: 5, timbre: 0.25 },
      lead: { oscType: 'fmsine', modIndex: 2, harmonicity: 0.5, attack: 0.1, release: 1.5, timbre: 0.15 },
      bass: { waveform: 'fatsawtooth', subLevel: 0.85, timbre: 0.05 },
    },
  },

  // rationale: wide-open filter, low Q, high brightness — let the harmonics
  // breathe. Drive dipped below 1 to avoid saturating the now-loud top end.
  // Voice: shimmery supersaw pad with mid attack for "rising" feel,
  // high-modulation FM saw lead (clangy / metallic at modIndex 12,
  // harmonicity 2 puts the modulator an octave above), saw bass with a
  // small sub.
  // Timbres: all toward A — bright = harmonic-rich, we want the saws to
  // sing through the open filter without sine washing them out.
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
    // DIFFERENTIATION FIX: BRIGHT was already close to A-side at 0.2/0.2/
    // 0.25. Pull bass to 0.10 so the fatsawtooth body matches the lead's
    // harmonic openness. Keep everything saw-dominant; bright = harmonic.
    voice: {
      pad: { waveform: 'fatsawtooth', detuneCents: 14, attack: 0.4, release: 2, timbre: 0.05 },
      lead: { oscType: 'fmsawtooth', modIndex: 12, harmonicity: 2, attack: 0.01, release: 0.7, timbre: 0.05 },
      bass: { waveform: 'fatsawtooth', subLevel: 0.4, timbre: 0.10 },
    },
  },

  // rationale: opposite of BRIGHT — thunder under the feet. Low cutoff
  // smothers harmonics; warm drive (~1.4) adds tube-style weight without
  // resonance. Reverb low so it doesn't smear the low end into mud.
  // Voice: pure triangle pad (warm, no buzz), a soft FM-sine lead that
  // barely modulates (modIndex 0.8 ≈ subtle inharmonic shimmer), full-sub
  // fatsaw bass — dark = boomy, not just dim.
  // Timbres: heavy toward B for pad/lead (we want sine/pulse softness with
  // the closed filter); bass stays slightly toward A so the fatsaw harmonics
  // still poke through the low cutoff for definition.
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
    // DIFFERENTIATION FIX: triangle is already warm and round — the
    // previous 0.7 timbre was washing the triangle character entirely
    // into sine. Triangle vs sine is a subtle but real difference;
    // keep it readable. Lead is similar — fmsine A is already smooth,
    // 0.65 pure-sine wash was killing the modulator shimmer.
    voice: {
      pad: { waveform: 'triangle', detuneCents: 8, attack: 1.2, release: 5, timbre: 0.30 },
      lead: { oscType: 'fmsine', modIndex: 0.8, harmonicity: 1, attack: 0.15, release: 1.2, timbre: 0.25 },
      bass: { waveform: 'fatsawtooth', subLevel: 1.0, timbre: 0.10 },
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
    // Timbres: balanced near 0.5 — tape sound is the SUM of harmonics
    // (the saw) and a softening pole (saturation rolloff approximated by
    // partial morph toward B's sine/pulse).
    // DIFFERENTIATION FIX: TAPE's identity is the AM modulation (amsawtooth
    // pad) and the pulse-lead — both characteristics get destroyed by a
    // 50% B-side wash. The pulse lead at 0.5 is especially bad because
    // the B-side is ALSO pulse → no morph happens at all, the engine just
    // plays a louder pulse. Pull to 0.15-0.20 so the AM and pulse
    // characters dominate.
    voice: {
      pad: { waveform: 'amsawtooth', detuneCents: 12, attack: 0.6, release: 3, timbre: 0.20 },
      lead: { oscType: 'pulse', modIndex: 4, harmonicity: 1.5, attack: 0.02, release: 0.9, timbre: 0.15 },
      bass: { waveform: 'fatsquare', subLevel: 0.6, timbre: 0.20 },
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
    // Timbres: full toward B — sine/pulse/triangle on all three voices is
    // exactly the "vacuum" character; the user-set knob can still pull it
    // back toward A if they want more harmonic edge.
    // DIFFERENTIATION FIX: SPACE's A-side is already very smooth (fmsine,
    // amsine, sine) — high timbre toward pure sine adds little new but
    // washes the FM/AM shimmer that IS the SPACE character. Pulled back
    // to 0.40 average so the modulator-driven shimmer survives. Still
    // the most B-side-heavy preset (SPACE = drift = round), but not so
    // far that the FM/AM motion gets buried.
    voice: {
      pad: { waveform: 'fmsine', detuneCents: 28, attack: 2.5, release: 6, timbre: 0.40 },
      lead: { oscType: 'amsine', modIndex: 5, harmonicity: 0.75, attack: 0.4, release: 2.5, timbre: 0.35 },
      bass: { waveform: 'sine', subLevel: 0.95, timbre: 0.30 },
    },
  },
] as const;
