// Owner: audio-engineer
//
// Master FX bus. Order is contractual and MUST NOT change without architect
// review:
//
//     voices ──> filter (LP) ──> saturator (AudioWorklet) ──> delay
//                                                              │
//                                                              ▼
//                              ◄── compressor ◄── reverb ◄────┘
//                                       │
//                                       ▼
//                                   analyser ──> destination
//
// `master-chain.ts` exposes a single `MasterChain` class that the AudioEngine
// instantiates and routes voices through. Parameter setters are smoothed.

import type { AudioEngineParams } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class MasterChain {
  /** Build the chain. Call after Tone.start() resolves. */
  build(): Promise<void> {
    throw new Error(NOT_IMPL);
  }

  /** The node that voices should connect into. */
  get input(): AudioNode {
    throw new Error(NOT_IMPL);
  }

  /** Master analyser for the visualizer. */
  getAnalyser(): AnalyserNode {
    throw new Error(NOT_IMPL);
  }

  setParams(_p: Partial<AudioEngineParams>): void {
    throw new Error(NOT_IMPL);
  }

  setMute(_muted: boolean): void {
    throw new Error(NOT_IMPL);
  }

  triggerDrop(_active: boolean): void {
    throw new Error(NOT_IMPL);
  }

  dispose(): void {
    throw new Error(NOT_IMPL);
  }
}
