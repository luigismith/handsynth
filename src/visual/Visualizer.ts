// Owner: visualizer
//
// p5.js (instance mode) FFT-driven visualization. Reads the AudioEngine's
// master analyser, optionally syncs to MusicBrain `onBeat`, and draws a hand-
// cursor overlay using the HandTracker's gesture state.

import type { AudioEngine, HandTracker, MusicBrain, Visualizer } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by visualizer';

export class VisualizerImpl implements Visualizer {
  mount(
    _canvas: HTMLCanvasElement,
    _deps: { audio: AudioEngine; hands: HandTracker; music: MusicBrain },
  ): void {
    throw new Error(NOT_IMPL);
  }
  unmount(): void {
    throw new Error(NOT_IMPL);
  }
}
