// Owner: audio-engineer
//
// AudioWorkletProcessor for soft-clip / waveshaping saturation. Runs on the
// audio render thread (~3ms quantum at 128 samples / 48 kHz).
//
// LOADING STRATEGY
// ----------------
// This file is imported by `master-chain.ts` via Vite's `?worker&url` query,
// which yields a stable module URL. That URL is passed to
// `AudioContext.audioWorklet.addModule(url)`. See ARCHITECTURE.md §5.
//
// If the worklet add fails for any reason at runtime, the AudioEngine
// substitutes Tone.Distortion (see master-chain.ts).
//
// IMPORTANT: this file runs in `AudioWorkletGlobalScope`, NOT the main thread.
// Do NOT import from anywhere that uses DOM APIs. Only the ambient globals
// declared below (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`,
// `currentTime`) are available.
//
// ALGORITHM
// ---------
// Soft clip: y = tanh(drive * x) / tanh(drive). Adding the normalisation
// preserves unity-gain at unity drive so we don't introduce a level surprise
// when modulating drive in real time. We then mix 80% wet / 20% dry so the
// effect is audible but never destroys transients. Stereo: process channels
// independently (no L/R cross-talk).

const NOT_IMPL = ''; // unused — kept for symmetry with original stub
void NOT_IMPL;

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

const WET = 0.8;
const DRY = 1 - WET;

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
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    void sampleRate; // referenced so it's not flagged unused; we don't need it.
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;

    const driveArr = parameters.drive;
    // k-rate: only the first sample is meaningful per quantum.
    const drive =
      driveArr && driveArr.length > 0 ? Math.max(0.0001, driveArr[0]!) : 1;
    // tanh(drive) is the normalisation factor that pins gain to ~unity at
    // x = 1.0. Using a clamped denominator avoids div-by-zero when drive→0.
    const norm = 1 / Math.max(1e-6, Math.tanh(drive));

    const channelCount = Math.min(input.length, output.length);
    for (let ch = 0; ch < channelCount; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;
      // If a channel is silent (input has 0 length), just write zeros.
      const len = outCh.length;
      if (inCh.length === 0) {
        for (let i = 0; i < len; i++) outCh[i] = 0;
        continue;
      }
      for (let i = 0; i < len; i++) {
        const x = inCh[i] ?? 0;
        const shaped = Math.tanh(drive * x) * norm;
        outCh[i] = WET * shaped + DRY * x;
      }
    }
    return true;
  }
}

registerProcessor('saturator', SaturatorProcessor);
