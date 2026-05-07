// Owner: interaction-mapper
//
// Glue layer: subscribes to HandTracker events, derives audio params + music
// inputs, applies them. Owns the gesture→param mapping table:
//
//     handsDistance  -> filterCutoff       (200..12000 Hz, exp curve)
//     meanHeight     -> intensity (0..1)
//     rightOpenness  -> reverbWet          (0..1)
//     leftOpenness   -> delayFeedback      (0..0.95)
//     pinch (R)      -> stab trigger
//     pinch (L)      -> chord advance
//     bothFists      -> drop (filter slam + perc roll)
//     bothAboveHead  -> mood = 'peak'
//     fingerCount    -> mood/intensity nudge
//     noHandsDuration -> mute / drone fallback
//
// See ARCHITECTURE.md "Gesture mapping" section.

import type {
  AudioEngine,
  HandTracker,
  InteractionMapper,
  MusicBrain,
  VibePreset,
} from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by interaction-mapper';

export class InteractionMapperImpl implements InteractionMapper {
  attach(_deps: { audio: AudioEngine; music: MusicBrain; hands: HandTracker }): void {
    throw new Error(NOT_IMPL);
  }
  setVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  start(): void {
    throw new Error(NOT_IMPL);
  }
  stop(): void {
    throw new Error(NOT_IMPL);
  }
}
