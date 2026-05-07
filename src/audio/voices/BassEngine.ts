// Owner: audio-engineer
//
// Bass voice — sub + harmonic layer for low-end. Side-chained against the kick.

import type { NoteEvent, VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class BassEngine {
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  triggerNote(_event: NoteEvent): void {
    throw new Error(NOT_IMPL);
  }
  dispose(): void {
    throw new Error(NOT_IMPL);
  }
}
