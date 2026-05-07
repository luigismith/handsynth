// Owner: music-brain
//
// Higher-level generative state machine: chord-progression rotation, lead-line
// motif memory, fill triggering. Reads from the active VibePreset.

import type { VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by music-brain';

export class Generator {
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  /** Returns the current chord symbol. */
  currentChord(): string {
    throw new Error(NOT_IMPL);
  }
  /** Advance to the next chord, looping the active progression. */
  advance(): void {
    throw new Error(NOT_IMPL);
  }
}
