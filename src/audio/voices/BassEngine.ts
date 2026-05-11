// Owner: audio-engineer
//
// Bass voice — warm, present, woofer-friendly.
//
// Architecture:
//   * Two Tone.MonoSynths run side-by-side through a Tone.CrossFade. `main`
//     (A side) carries the vibe/VoiceShape waveform (fatsquare / fatsawtooth /
//     etc.). `mainB` (B side) is a hard-coded `triangle` morph destination —
//     warm and woody, the natural counterpart to A's harmonic edge.
//   * Tone.MonoSynth as a sub layer one octave below — sine wave so it's
//     felt, not heard. Only enabled when `vibe.bass.sub === true`. The sub
//     stays OUT of the crossfade (it's always sine and always present) —
//     it's the "felt" component, not the "heard" timbre.
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

/** The hard-coded "morph destination" waveform for the B side of the crossfade. */
const BASS_MORPH_DESTINATION = 'triangle';

/**
 * Edge tolerance for the B-side trigger gate (see PadEngine — same idea).
 * When timbre is parked at 0 or 1 we fire only the dominant side; mid-morph
 * we fire both so a crossfade lands on live audio.
 */
const TIMBRE_EDGE_EPS = 0.02;

export class BassEngine {
  private main: Tone.MonoSynth;
  private mainB: Tone.MonoSynth;
  private xfade: Tone.CrossFade;
  private sub: Tone.MonoSynth;
  private hpf: Tone.Filter;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;
  private subEnabled = true;
  /**
   * PERF (v0.3.0 freeze fix): mirror of the xfade target so trigger() can
   * skip the inaudible MonoSynth at the timbre extremes. See PadEngine
   * for the rationale.
   */
  private currentTimbre = 0;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(0.9);

    this.hpf = new Tone.Filter({
      type: 'highpass',
      frequency: HPF_FREQ,
      Q: 0.5,
      rolloff: -24,
    });

    this.main = this.makeMain('fatsquare');
    this.mainB = this.makeMain(BASS_MORPH_DESTINATION);
    this.xfade = new Tone.CrossFade(0); // default: 100% A (legacy behavior)

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

    this.main.connect(this.xfade.a);
    this.mainB.connect(this.xfade.b);
    this.xfade.connect(this.hpf);
    this.sub.connect(this.hpf);
    this.hpf.connect(this.out);

    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  private makeMain(waveform: string): Tone.MonoSynth {
    return new Tone.MonoSynth({
      // 'fatsquare' is part of OmniOscillator's runtime union but not exported
      // in a narrower type. Cast the literal to the field's expected type.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oscillator: { type: waveform } as any,
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
    // B side stays on the morph destination — vibe never overrides it.

    this.subEnabled = vibe.bass.sub;
    // We don't tear down the sub voice; we just gate its output via volume.
    this.sub.volume.rampTo(this.subEnabled ? -12 : -Infinity, 0.1);

    // Per-vibe envelope flavor. Hopkins wants a snappier, drier bass; FP
    // wants longer sustain.
    if (vibe.id === 'hopkins') {
      this.main.set({
        envelope: { attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.2 },
      });
      this.mainB.set({
        envelope: { attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.2 },
      });
    } else if (vibe.id === 'floating-points') {
      this.main.set({
        envelope: { attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
      });
      this.mainB.set({
        envelope: { attack: 0.005, decay: 0.25, sustain: 0.5, release: 0.35 },
      });
    } else {
      this.main.set({
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
      });
      this.mainB.set({
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
      });
    }
  }

  /**
   * Apply a factory-preset overlay. `subLevel` is normalized 0..1 and maps
   * non-linearly to dB (1 → 0 dB, ~0.5 → -12 dB, 0 → -Infinity / silent).
   * Setting subLevel to 0 also disables the sub trigger so we don't waste
   * voices on a muted layer.
   *
   * `timbre` morphs the crossfade A↔B continuously; it does NOT need the
   * 50 ms fade gate because the crossfade itself is the fade.
   */
  applyVoiceShape(shape: VoiceShape['bass'] | undefined): void {
    if (!shape) return;
    // GLITCH MITIGATION: same as Pad/Lead — OmniOscillator type swap
    // produces a click on sustaining bass notes. 50 ms fade-out around
    // the swap hides it. subLevel changes (sub.volume.rampTo) already
    // smooth themselves; only the main waveform swap needs the gate.
    const willSwapType = !!shape.waveform;
    if (willSwapType) {
      this.out.gain.cancelScheduledValues(0);
      this.out.gain.rampTo(0, 0.05);
    }
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
    if (typeof shape.timbre === 'number') {
      this.setTimbre(shape.timbre);
    }
    if (willSwapType) {
      // Restore nominal bass level (0.9, matching the constructor default).
      this.out.gain.rampTo(0.9, 0.05);
    }
  }

  /**
   * Set the A↔B crossfade morph (0..1). 0 = 100% A (vibe/preset waveform);
   * 1 = 100% B (triangle destination). Smoothed over 80 ms.
   */
  setTimbre(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.currentTimbre = v;
    this.xfade.fade.rampTo(v, 0.08);
  }

  /**
   * PERF (v0.3.0 freeze fix): gate the inaudible MonoSynth when timbre is
   * parked at 0 or 1. The sub layer stays on its own gate (subEnabled) —
   * it's outside the crossfade. See PadEngine.triggerChord for rationale.
   */
  trigger(
    note: string,
    duration: string,
    velocity: number,
    time?: number | string,
  ): void {
    const v = Math.max(0.01, Math.min(1, velocity));
    const t = time ?? Tone.now();
    const tim = this.currentTimbre;
    if (tim < 1 - TIMBRE_EDGE_EPS) {
      this.main.triggerAttackRelease(note, duration, t, v);
    }
    if (tim > TIMBRE_EDGE_EPS) {
      this.mainB.triggerAttackRelease(note, duration, t, v);
    }
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
      this.mainB.dispose();
      this.xfade.dispose();
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
