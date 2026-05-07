// Owner: audio-engineer
//
// Percussion / drums — kick, hat, perc. Triggered by the MusicBrain on the
// transport grid.

import type { VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class PercEngine {
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  triggerKick(_time?: number | string): void {
    throw new Error(NOT_IMPL);
  }
  triggerHat(_time?: number | string): void {
    throw new Error(NOT_IMPL);
  }
  triggerPerc(_time?: number | string): void {
    throw new Error(NOT_IMPL);
  }
  dispose(): void {
    throw new Error(NOT_IMPL);
  }
}
