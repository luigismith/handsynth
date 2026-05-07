// Owner: audio-engineer
//
// Single audio output. Owns Tone.js context, voices, FX chain, and the master
// analyser. Lazy-initialized from a user gesture (autoplay policy).

import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

export class AudioEngineImpl implements AudioEngine {
  init(): Promise<void> {
    throw new Error(NOT_IMPL);
  }
  loadVibe(_vibe: VibePreset): void {
    throw new Error(NOT_IMPL);
  }
  triggerLead(_event: NoteEvent): void {
    throw new Error(NOT_IMPL);
  }
  triggerBass(_event: NoteEvent): void {
    throw new Error(NOT_IMPL);
  }
  triggerChord(_event: ChordEvent): void {
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
  triggerStab(): void {
    throw new Error(NOT_IMPL);
  }
  setParams(_partial: Partial<AudioEngineParams>): void {
    throw new Error(NOT_IMPL);
  }
  setMute(_muted: boolean): void {
    throw new Error(NOT_IMPL);
  }
  triggerDrop(_active: boolean): void {
    throw new Error(NOT_IMPL);
  }
  getAnalyser(): AnalyserNode {
    throw new Error(NOT_IMPL);
  }
  isReady(): boolean {
    return false;
  }
}
