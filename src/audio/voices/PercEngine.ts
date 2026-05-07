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

    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, // 50ms pitch sweep — classic short kick
      octaves: 4, // ~80Hz → ~40Hz
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.4,
        sustain: 0.01,
        release: 1.4,
        attackCurve: 'exponential',
      },
      volume: -3,
    });

    this.hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.06,
        sustain: 0,
        release: 0.02,
      },
      volume: -16,
    });
    this.hatFilter = new Tone.Filter({
      type: 'highpass',
      frequency: 8000,
      Q: 0.7,
      rolloff: -24,
    });

    this.perc = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.002,
        decay: 0.2,
        sustain: 0,
        release: 0.05,
      },
      volume: -14,
    });
    this.percFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 4000,
      Q: 2,
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

  triggerKick(time?: number | string): void {
    const t = time ?? Tone.now();
    // 'C2' is the conventional MembraneSynth kick pitch.
    this.kick.triggerAttackRelease('C2', '8n', t);
  }

  triggerHat(time?: number | string): void {
    const t = time ?? Tone.now();
    this.hat.triggerAttackRelease('32n', t);
  }

  triggerPerc(time?: number | string): void {
    const t = time ?? Tone.now();
    this.perc.triggerAttackRelease('16n', t);
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
