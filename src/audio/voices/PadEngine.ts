// Owner: audio-engineer
//
// Pad voice — wide, slow-attack chord pad. Detuned multi-osc with LFO movement.
// Receives chord events from the AudioEngine.

import type { ChordEvent, VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class PadEngine {
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  triggerChord(_event: ChordEvent): void {
    throw new Error(NOT_IMPL);
  }
  dispose(): void {
    throw new Error(NOT_IMPL);
  }
}
