// Owner: audio-engineer
//
// Lead voice — wavetable / FM / mono depending on vibe. Carries the melody from
// the MusicBrain.

import type { NoteEvent, VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class LeadEngine {
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  triggerNote(_event: NoteEvent): void {
    throw new Error(NOT_IMPL);
  }
  triggerStab(): void {
    throw new Error(NOT_IMPL);
  }
  dispose(): void {
    throw new Error(NOT_IMPL);
  }
}
