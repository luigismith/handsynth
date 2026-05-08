// Owner: audio-engineer
//
// Bass voice — warm, present, woofer-friendly.
//
// Architecture:
//   * Tone.MonoSynth (fatsquare or sawtooth per vibe) — the harmonic top
//     layer.
//   * Tone.MonoSynth as a sub layer one octave below — sine wave so it's
//     felt, not heard. Only enabled when `vibe.bass.sub === true`.
//   * Each MonoSynth has its own LPF with envelope-modulated cutoff for that
//     classic acid/dub bass "thump → resonant tail" feel.
//   * 30Hz high-pass at the engine output protects subwoofers from DC and
//     ultra-low rumble.
//
// Sound-design notes:
//   * Glide (portamento) 0.08s — feels articulate without slurring like a 303.
//   * Filter env: A=0.005, D=0.4, S=0.3 — fast attack, fat decay tail.
//   * Sub layer is intentionally quiet (-12 dB below main) — too loud and it
//     muds the mix.

import * as Tone from 'tone';
import type { NoteEvent, VibePreset } from '@contracts/contracts';
import type { VoiceShape } from '../voice-shape';

const PORTAMENTO = 0.08;
const HPF_FREQ = 30;

export class BassEngine {
  private main: Tone.MonoSynth;
  private sub: Tone.MonoSynth;
  private hpf: Tone.Filter;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;
  private subEnabled = true;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(0.9);

    this.hpf = new Tone.Filter({
      type: 'highpass',
      frequency: HPF_FREQ,
      Q: 0.5,
      rolloff: -24,
    });

    this.main = new Tone.MonoSynth({
      // 'fatsquare' is part of OmniOscillator's runtime union but not exported
      // in a narrower type. Cast the literal to the field's expected type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oscillator: { type: 'fatsquare' } as any,
      envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
      filter: { type: 'lowpass', Q: 1.2, rolloff: -24 },
      filterEnvelope: {
        attack: 0.005,
        decay: 0.4,
        sustain: 0.3,
        release: 0.4,
        baseFrequency: 80,
        octaves: 4,
      },
      portamento: PORTAMENTO,
      volume: -6,
    });

    this.sub = new Tone.MonoSynth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.005,
        decay: 0.3,
        sustain: 0.6,
        release: 0.4,
      },
      filter: { type: 'lowpass', frequency: 200, Q: 0.3 },
      filterEnvelope: {
        attack: 0.005,
        decay: 0.2,
        sustain: 1,
        release: 0.4,
        baseFrequency: 200,
        octaves: 0,
      },
      portamento: PORTAMENTO,
      volume: -12,
    });

    this.main.connect(this.hpf);
    this.sub.connect(this.hpf);
    this.hpf.connect(this.out);

    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    // Map preset waveforms to a fat variant for body. "sine" gets pure sine.
    const w = vibe.bass.waveform;
    let mainOsc: string;
    switch (w) {
      case 'sine':
        mainOsc = 'sine';
        break;
      case 'triangle':
        mainOsc = 'fattriangle';
        break;
      case 'sawtooth':
        mainOsc = 'fatsawtooth';
        break;
      case 'square':
        mainOsc = 'fatsquare';
        break;
      default:
        mainOsc = 'fatsquare';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.main.set({ oscillator: { type: mainOsc as any } });

    this.subEnabled = vibe.bass.sub;
    // We don't tear down the sub voice; we just gate its output via volume.
    this.sub.volume.rampTo(this.subEnabled ? -12 : -Infinity, 0.1);

    // Per-vibe envelope flavor. Hopkins wants a snappier, drier bass; FP
    // wants longer sustain.
    if (vibe.id === 'hopkins') {
      this.main.set({
        envelope: { attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.2 },
      });
    } else if (vibe.id === 'floating-points') {
      this.main.set({
        envelope: { attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
      });
    } else {
      this.main.set({
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
      });
    }
  }

  /**
   * Apply a factory-preset overlay. `subLevel` is normalized 0..1 and maps
   * non-linearly to dB (1 → 0 dB, ~0.5 → -12 dB, 0 → -Infinity / silent).
   * Setting subLevel to 0 also disables the sub trigger so we don't waste
   * voices on a muted layer.
   */
  applyVoiceShape(shape: VoiceShape['bass'] | undefined): void {
    if (!shape) return;
    if (shape.waveform) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.main.set({ oscillator: { type: shape.waveform as any } });
    }
    if (typeof shape.subLevel === 'number') {
      const s = Math.max(0, Math.min(1, shape.subLevel));
      this.subEnabled = s > 0;
      // Non-linear curve: 0 -> -Infinity, 1 -> 0 dB. Approximate with
      // 24*log10(s); guard the s=0 case explicitly.
      const db = s > 0 ? 24 * Math.log10(s) : -Infinity;
      this.sub.volume.rampTo(db, 0.1);
    }
  }

  trigger(
    note: string,
    duration: string,
    velocity: number,
    time?: number | string,
  ): void {
    const v = Math.max(0.01, Math.min(1, velocity));
    const t = time ?? Tone.now();
    this.main.triggerAttackRelease(note, duration, t, v);
    if (this.subEnabled) {
      // Sub plays one octave down. Use Tone.Frequency to shift safely.
      const subNote = Tone.Frequency(note).transpose(-12).toNote();
      this.sub.triggerAttackRelease(subNote, duration, t, v * 0.9);
    }
  }

  /** Convenience — accept a NoteEvent. */
  triggerNote(event: NoteEvent): void {
    this.trigger(event.pitch, event.duration, event.velocity, event.time);
  }

  dispose(): void {
    try {
      this.main.dispose();
      this.sub.dispose();
      this.hpf.dispose();
      this.out.dispose();
    } catch (e) {
      console.warn('[BassEngine] dispose error', e);
    }
  }

  getCurrentVibe(): VibePreset | null {
    return this.currentVibe;
  }
}
