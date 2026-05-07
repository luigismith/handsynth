// Owner: music-brain
//
// Generative engine. Owns the transport clock, current chord index, scale, and
// note generation. Emits note/chord/drum events to subscribers (the AudioEngine
// is the primary consumer; the Visualizer may subscribe to onBeat).

import type {
  MusicBrain,
  MusicBrainEvents,
  MusicBrainInput,
} from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by music-brain';

export class MusicBrainImpl implements MusicBrain {
  start(): void {
    throw new Error(NOT_IMPL);
  }
  stop(): void {
    throw new Error(NOT_IMPL);
  }
  setInput(_input: MusicBrainInput): void {
    throw new Error(NOT_IMPL);
  }
  advanceChord(): void {
    throw new Error(NOT_IMPL);
  }
  on(_events: MusicBrainEvents): void {
    throw new Error(NOT_IMPL);
  }
  off(_events: MusicBrainEvents): void {
    throw new Error(NOT_IMPL);
  }
}
