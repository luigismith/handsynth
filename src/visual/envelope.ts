// Owner: visualizer
//
// Audio-style ADSR envelope used by the visual layer for beat-synced effects.
// We model attack/decay/release in seconds; sustain is 0 (the beat is a
// trigger, not a held note). Trigger() restarts the envelope at a target peak.
//
// Why ADSR vs the previous `pulse *= 0.92` per frame:
//   - Frame-rate independent: the previous decay was tied to 60fps.
//     If the renderer dipped to 30fps, the beat would last twice as long.
//   - Attack > 0 means a beat ramps in over ~30ms instead of jumping. This
//     is much more pleasing on the eye when chained with bloom — the glow
//     blooms in/out rather than punching.
//   - Reused for: finger string brightness, vignette intensity, background
//     flash, hand ring pulse.

export interface Envelope {
  /** Current value, 0..peak. Updated by step(). */
  value: number;
  /** Reset to the attack stage with the given peak. */
  trigger(peak?: number): void;
  /** Advance the envelope by `dt` seconds. Returns the new value. */
  step(dt: number): number;
  /** True if the envelope is contributing anything (above epsilon). */
  active(): boolean;
}

interface EnvelopeOptions {
  /** Attack time in seconds. Default 0.030 (30ms). */
  attack?: number;
  /** Decay time in seconds. Default 0.200 (200ms). */
  decay?: number;
  /**
   * Release time in seconds — decay continues from the decay floor down to 0.
   * Since we use sustain=0, decay and release effectively chain. Default 0.100.
   */
  release?: number;
  /** Floor value the decay stage decays to. Default 0. */
  decayFloor?: number;
}

const EPSILON = 0.001;

export function createEnvelope(opts: EnvelopeOptions = {}): Envelope {
  const attack = opts.attack ?? 0.030;
  const decay = opts.decay ?? 0.200;
  const release = opts.release ?? 0.100;
  const decayFloor = opts.decayFloor ?? 0;

  let stage: 'idle' | 'attack' | 'decay' | 'release' = 'idle';
  let elapsed = 0;
  let peak = 0;
  let stageStartValue = 0;

  const env: Envelope = {
    value: 0,
    trigger(p = 1): void {
      peak = p;
      stage = 'attack';
      elapsed = 0;
      stageStartValue = env.value; // ramp from current value, not from 0
    },
    step(dt: number): number {
      if (stage === 'idle') {
        env.value = 0;
        return 0;
      }
      elapsed += dt;
      if (stage === 'attack') {
        const t = Math.min(1, elapsed / Math.max(attack, EPSILON));
        env.value = stageStartValue + (peak - stageStartValue) * t;
        if (t >= 1) {
          stage = 'decay';
          elapsed = 0;
          stageStartValue = env.value;
        }
      } else if (stage === 'decay') {
        const t = Math.min(1, elapsed / Math.max(decay, EPSILON));
        env.value = stageStartValue + (decayFloor - stageStartValue) * t;
        if (t >= 1) {
          stage = decayFloor > EPSILON ? 'release' : 'idle';
          elapsed = 0;
          stageStartValue = env.value;
          if (stage === 'idle') env.value = 0;
        }
      } else if (stage === 'release') {
        const t = Math.min(1, elapsed / Math.max(release, EPSILON));
        env.value = stageStartValue * (1 - t);
        if (t >= 1) {
          stage = 'idle';
          env.value = 0;
        }
      }
      return env.value;
    },
    active(): boolean {
      return stage !== 'idle' || env.value > EPSILON;
    },
  };
  return env;
}
