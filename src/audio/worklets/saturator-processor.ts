// Owner: audio-engineer
//
// AudioWorkletProcessor for soft-clip / waveshaping saturation. Runs on the
// audio render thread (~3ms quantum at 128 samples / 48 kHz).
//
// LOADING: this file is imported by the AudioEngine via Vite's
// `?worker&url` query, which yields a URL passed to
// `AudioContext.audioWorklet.addModule(url)`. See ARCHITECTURE.md.
//
// IMPORTANT: this file runs in a worklet global scope (`AudioWorkletGlobalScope`),
// not the main thread. Do NOT import from anywhere that uses DOM APIs.

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by audio-engineer';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;

class SaturatorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): Array<{
    name: string;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    automationRate: 'a-rate' | 'k-rate';
  }> {
    return [
      {
        name: 'drive',
        defaultValue: 1,
        minValue: 0.5,
        maxValue: 3,
        automationRate: 'k-rate',
      },
    ];
  }

  override process(
    _inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    // Real implementation: tanh / softclip with `drive` shaping.
    void NOT_IMPL;
    void sampleRate;
    return true;
  }
}

registerProcessor('saturator', SaturatorProcessor);
