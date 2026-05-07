// Owner: music-brain
//
// Drum / arp pattern bank. Maps `(intensity, mood)` to drum patterns and
// arpeggio shapes. Called by the MusicBrain on every 16th-note tick.

import type { Mood } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by music-brain';

export type StepHit = { kick: boolean; hat: boolean; perc: boolean };

export function drumPattern(_intensity: number, _mood: Mood): StepHit[] {
  throw new Error(NOT_IMPL);
}

export function arpShape(_intensity: number, _mood: Mood): number[] {
  throw new Error(NOT_IMPL);
}
