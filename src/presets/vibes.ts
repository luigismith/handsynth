// Owner: architect (data only — audio interpretation owned by audio-engineer & music-brain)
import type { VibeId, VibePreset } from '@contracts/contracts';

/**
 * Built-in vibe presets. Each entry is a complete `VibePreset`: tempo, scale,
 * chord progressions, voice defaults, and FX levels. Two alternative
 * progressions per vibe so the MusicBrain can rotate or pick.
 *
 * Chord symbols use `@tonaljs/tonal` notation. Scales use `tonal/scale` mode
 * names (`'lydian'`, `'dorian'`, `'phrygian'`, `'mixolydian'`, ...).
 */
export const VIBES: Record<VibeId, VibePreset> = {
  tycho: {
    id: 'tycho',
    displayName: 'Tycho — sunset drift',
    bpm: 92,
    scale: { tonic: 'F#', mode: 'lydian' },
    progressions: [
      ['F#maj9', 'Eadd9', 'B6/9', 'C#sus2'],
      ['F#maj7', 'A#m11', 'D#m9', 'G#7sus4'],
    ],
    pad: { waveform: 'fatsawtooth', lfoRate: 0.2, detuneCents: 8 },
    lead: { synthType: 'wavetable' },
    bass: { waveform: 'sine', sub: true },
    reverbWet: 0.5,
    delayWet: 0.25,
    saturatorDrive: 0.9,
    swing: 0.0,
  },
  bonobo: {
    id: 'bonobo',
    displayName: 'Bonobo — dusty downtempo',
    bpm: 86,
    scale: { tonic: 'D', mode: 'dorian' },
    progressions: [
      ['Dm9', 'Gmaj7', 'Cmaj9', 'Am11'],
      ['Dm7', 'F6/9', 'Bb maj7', 'Am9'],
    ],
    pad: { waveform: 'square+sine', lfoRate: 0.15, detuneCents: 4 },
    lead: { synthType: 'fm', fmRatio: 2, modIndex: 1.4 },
    bass: { waveform: 'triangle', sub: true },
    reverbWet: 0.35,
    delayWet: 0.3,
    saturatorDrive: 1.2,
    swing: 0.18,
  },
  hopkins: {
    id: 'hopkins',
    displayName: 'Hopkins — granular dystopia',
    bpm: 110,
    scale: { tonic: 'A', mode: 'phrygian' },
    progressions: [
      ['Am', 'Bb maj7', 'Fmaj7', 'Em7'],
      ['Am9', 'Bb6', 'Dm7', 'E7b9'],
    ],
    pad: { waveform: 'amsawtooth', lfoRate: 0.6, detuneCents: 16 },
    lead: { synthType: 'mono' },
    bass: { waveform: 'sawtooth', sub: false },
    reverbWet: 0.6,
    delayWet: 0.4,
    saturatorDrive: 1.8,
    swing: 0.05,
  },
  'floating-points': {
    id: 'floating-points',
    displayName: 'Floating Points — bright deep house',
    bpm: 120,
    scale: { tonic: 'C', mode: 'mixolydian' },
    progressions: [
      ['Cmaj7', 'Bb maj7', 'F/A', 'Gm9'],
      ['C9', 'F maj7', 'Am7', 'G7sus4'],
    ],
    pad: { waveform: 'sawtooth', lfoRate: 0.3, detuneCents: 6 },
    lead: { synthType: 'mono' /* acid 303-flavored mono */ },
    bass: { waveform: 'sawtooth', sub: true },
    reverbWet: 0.3,
    delayWet: 0.35,
    saturatorDrive: 1.4,
    swing: 0.0,
  },
};

/** Default vibe loaded on first launch. */
export const DEFAULT_VIBE: VibeId = 'tycho';

/** Convenience array form for iteration in UI code. */
export const VIBE_LIST: readonly VibePreset[] = Object.values(VIBES);
