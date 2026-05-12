// Owner: audio-engineer
//
// Percussion / drums. Three voices: kick, hat, perc.
//
// Sound-design notes:
//   * Kick uses Tone.MembraneSynth — pitch envelope built-in, gives a clean
//     thump from ~80Hz down to ~40Hz in ~50ms (controlled by `octaves` and
//     `pitchDecay`). MembraneSynth is the right tool here; rolling our own
//     pitch env is unnecessary complexity.
//   * Hat: NoiseSynth (white) → HPF @ 8kHz → fast envelope (attack 1ms,
//     decay 60ms). Filter must be aggressive — anything below 8kHz on a hat
//     fights with the snare/perc.
//   * Perc: NoiseSynth (pink) → BPF @ 4kHz Q=2 → 200ms decay. The pink noise
//     gives a softer, more wood-like character than white.

import * as Tone from 'tone';
import type { VibePreset } from '@contracts/contracts';

export class PercEngine {
  private kick: Tone.MembraneSynth;
  private hat: Tone.NoiseSynth;
  private hatFilter: Tone.Filter;
  private perc: Tone.NoiseSynth;
  private percFilter: Tone.Filter;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(1);

    // DRUM REDESIGN: tighter envelopes + small randomized accent per hit
    // for organic feel. Previously kick lingered too long (decay 0.4 +
    // release 1.4) — tail competed with the next chord; pulled to 0.18/
    // 0.35 for a modern tight kick. Hat sharper. Perc shorter + more
    // focused BPF.
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.035, // 35 ms pitch sweep — snappier impact
      octaves: 5,        // ~90 Hz → ~28 Hz, more sub
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.18,
        sustain: 0.001,
        release: 0.35,
        attackCurve: 'exponential',
      },
      volume: -2,        // a touch louder, mix-pre
    });

    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.04,
        sustain: 0,
        release: 0.012,
      },
      volume: -18,       // sat under the kick + perc, lets it tick rather than splash
    });
    this.hatFilter = new Tone.Filter({
      type: 'highpass',
      frequency: 9000,
      Q: 0.9,
      rolloff: -24,
    });

    this.perc = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.002,
        decay: 0.13,
        sustain: 0,
        release: 0.04,
      },
      volume: -12,       // bumped from -14, more presence
    });
    this.percFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 4200,
      Q: 2.6,            // more focused: tighter wood-like tick
      rolloff: -12,
    });

    this.kick.connect(this.out);
    this.hat.connect(this.hatFilter);
    this.hatFilter.connect(this.out);
    this.perc.connect(this.percFilter);
    this.percFilter.connect(this.out);

    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    // Per-vibe perc tuning: hopkins gets a slightly higher hat (more
    // brittle), bonobo more dusty (lower BPF on perc).
    if (vibe.id === 'hopkins') {
      this.hatFilter.frequency.rampTo(9500, 0.1);
      this.percFilter.frequency.rampTo(3500, 0.1);
    } else if (vibe.id === 'bonobo') {
      this.hatFilter.frequency.rampTo(7500, 0.1);
      this.percFilter.frequency.rampTo(2800, 0.1);
    } else if (vibe.id === 'floating-points') {
      this.hatFilter.frequency.rampTo(8500, 0.1);
      this.percFilter.frequency.rampTo(4500, 0.1);
    } else {
      this.hatFilter.frequency.rampTo(8000, 0.1);
      this.percFilter.frequency.rampTo(4000, 0.1);
    }
  }

  // FREEZE FIX: see LeadEngine.trigger for the full explanation. All
  // percussion triggers wrapped in try/catch to prevent a Tone scheduler
  // refusal from escaping back through Transport's tick loop and
  // corrupting its _timeline.

  /**
   * Velocity humanization: ±VEL_JITTER around 1.0 per hit. Without this every
   * percussion hit lands at identical velocity → machine-stiff feel. ±0.12
   * gives a barely-perceptible organic looseness without breaking the
   * groove.
   */
  private static readonly VEL_JITTER = 0.12;
  private humanVel(base: number = 1): number {
    const j = (Math.random() * 2 - 1) * PercEngine.VEL_JITTER;
    return Math.max(0.2, Math.min(1, base + j));
  }

  triggerKick(time?: number | string): void {
    const now = Tone.now();
    const t = typeof time === 'number' ? Math.max(time, now) : time ?? now;
    try { this.kick.triggerAttackRelease('C2', '8n', t, this.humanVel(0.95)); }
    catch (e) { console.warn('[perc] kick refused', e); }
  }

  triggerHat(time?: number | string): void {
    const now = Tone.now();
    const t = typeof time === 'number' ? Math.max(time, now) : time ?? now;
    try { this.hat.triggerAttackRelease('32n', t, this.humanVel(0.85)); }
    catch (e) { console.warn('[perc] hat refused', e); }
  }

  triggerPerc(time?: number | string): void {
    const now = Tone.now();
    const t = typeof time === 'number' ? Math.max(time, now) : time ?? now;
    try { this.perc.triggerAttackRelease('16n', t, this.humanVel(0.9)); }
    catch (e) { console.warn('[perc] perc refused', e); }
  }

  dispose(): void {
    try {
      this.kick.dispose();
      this.hat.dispose();
      this.hatFilter.dispose();
      this.perc.dispose();
      this.percFilter.dispose();
      this.out.dispose();
    } catch (e) {
      console.warn('[PercEngine] dispose error', e);
    }
  }

  getCurrentVibe(): VibePreset | null {
    return this.currentVibe;
  }
}
