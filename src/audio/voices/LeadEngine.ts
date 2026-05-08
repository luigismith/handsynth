// Owner: audio-engineer
//
// Lead voice — singing, vocal-flavored melodic line.
//
// Architecture:
//   * Tone.MonoSynth (with FM oscillator when the vibe asks for FM, otherwise
//     a triangle/sawtooth). This gives us portamento + a built-in filter +
//     filter envelope for snappy phrasing.
//   * 12dB band-pass filter @ Q=4 sits AFTER the synth — adds a nasal-but-
//     focused character that helps the lead sit above the pad without
//     stepping on the bass.
//   * Vibrato @ 5.5Hz / 8 cents — Tone.Vibrato uses an internal LFO modulating
//     the delay time, which is what real instruments do.
//   * Portamento 0.05s — short enough to feel articulate, long enough to feel
//     human.
//
// Sound-design notes:
//   * Q=4 is a balance — higher (Q=8+) sounds resonant/synthy, lower (Q=2)
//     loses focus. 4 sits exactly where the lead "speaks".
//   * Vibrato depth in cents: 8 cents is subtle. Crank it past 25 and you get
//     seasick lead.

import * as Tone from 'tone';
import type { NoteEvent, VibePreset } from '@contracts/contracts';
import type { VoiceShape } from '../voice-shape';

const PORTAMENTO = 0.05;
const VIBRATO_HZ = 5.5;
const VIBRATO_DEPTH = 0.06; // 0..1; ~6% ≈ 8 cents on Tone.Vibrato
const FILTER_Q = 4;
const FILTER_FREQ = 1800;

export class LeadEngine {
  private mono: Tone.MonoSynth;
  private bp: Tone.Filter;
  private vibrato: Tone.Vibrato;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;
  private brightness = 0.5;
  private baseModIndex = 1.4;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(0.85);

    this.mono = new Tone.MonoSynth({
      // OmniOscillator accepts richer types ('fmsawtooth', 'fatsine', etc.)
      // than `ToneOscillatorType`, but the field type isn't exported.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oscillator: { type: 'fmsawtooth' } as any,
      envelope: {
        attack: 0.02,
        decay: 0.3,
        sustain: 0.5,
        release: 0.8,
      },
      filter: {
        type: 'lowpass',
        Q: 1,
        rolloff: -12,
      },
      filterEnvelope: {
        attack: 0.02,
        decay: 0.25,
        sustain: 0.5,
        release: 0.5,
        baseFrequency: 600,
        octaves: 3,
      },
      portamento: PORTAMENTO,
      volume: -8,
    });

    this.bp = new Tone.Filter({
      type: 'bandpass',
      frequency: FILTER_FREQ,
      Q: FILTER_Q,
      rolloff: -12,
    });

    this.vibrato = new Tone.Vibrato({
      frequency: VIBRATO_HZ,
      depth: VIBRATO_DEPTH,
    });

    this.mono.connect(this.vibrato);
    this.vibrato.connect(this.bp);
    this.bp.connect(this.out);

    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    // Pick an oscillator type per vibe. FM types color via fmRatio/modIndex.
    const synthType = vibe.lead.synthType;
    let oscType: string;
    if (synthType === 'fm') {
      oscType = 'fmsawtooth';
    } else if (synthType === 'mono') {
      // hopkins / floating-points get a 303-flavored sawtooth.
      oscType = 'sawtooth';
    } else {
      // wavetable — Tone doesn't ship a wavetable per se; mimic with fmsine
      // for a soft glassy lead (Tycho-y).
      oscType = 'fmsine';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mono.set({ oscillator: { type: oscType as any } });

    // Mod-index / harmonicity live on the OmniOscillator's FM variants. We
    // pass them as part of an `oscillator` patch — the `set()` machinery
    // ignores them gracefully on non-FM types (the underlying OmniOscillator
    // checks the active type before forwarding props).
    if (typeof vibe.lead.modIndex === 'number') {
      this.baseModIndex = vibe.lead.modIndex;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mono.set({ oscillator: { modulationIndex: vibe.lead.modIndex } as any });
    }
    if (typeof vibe.lead.fmRatio === 'number') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mono.set({ oscillator: { harmonicity: vibe.lead.fmRatio } as any });
    }

    // Per-vibe vibrato tuning: floating-points + tycho want subtle, hopkins a
    // touch wider for that uneasy feel.
    if (vibe.id === 'hopkins') {
      this.vibrato.frequency.rampTo(6.5, 0.2);
      this.vibrato.depth.rampTo(0.09, 0.2);
    } else if (vibe.id === 'floating-points') {
      this.vibrato.frequency.rampTo(5.0, 0.2);
      this.vibrato.depth.rampTo(0.04, 0.2);
    } else {
      this.vibrato.frequency.rampTo(VIBRATO_HZ, 0.2);
      this.vibrato.depth.rampTo(VIBRATO_DEPTH, 0.2);
    }
  }

  /** Trigger a single melodic note. */
  trigger(
    note: string,
    duration: string,
    velocity: number,
    time?: number | string,
  ): void {
    const v = Math.max(0.01, Math.min(1, velocity));
    const t = time ?? Tone.now();
    this.mono.triggerAttackRelease(note, duration, t, v);
  }

  /** Convenience — accept a NoteEvent. */
  triggerNote(event: NoteEvent): void {
    this.trigger(event.pitch, event.duration, event.velocity, event.time);
  }

  /**
   * One-shot stab. Caller passes the note (the AudioEngine doesn't know the
   * harmony). InteractionMapper will typically pick a chord-tone and call
   * trigger() directly with full velocity instead.
   */
  triggerStab(note: string = 'C5', time?: number | string): void {
    this.trigger(note, '8n', 0.95, time);
  }

  /** Brightness 0..1 — modulates filter cutoff via filter env octaves and
   * scales the modulation index. */
  setBrightness(b: number): void {
    this.brightness = Math.max(0, Math.min(1, b));
    // Map 0..1 to 600..3500 base, 1..4 octaves.
    const baseFreq = 400 + this.brightness * 1400;
    const oct = 1.5 + this.brightness * 2.5;
    this.mono.set({
      filterEnvelope: {
        baseFrequency: baseFreq,
        octaves: oct,
      },
    });
    // Also scale band-pass cutoff for a subtle "open up" feel.
    this.bp.frequency.rampTo(1200 + this.brightness * 2400, 0.05);
  }

  setModIndex(value: number): void {
    this.baseModIndex = value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.mono.set({ oscillator: { modulationIndex: value } as any });
  }

  /**
   * Apply a factory-preset overlay on top of whatever the current vibe set.
   * Only the fields explicitly set on `shape` are applied. modIndex /
   * harmonicity flow through OmniOscillator's set() for FM/AM types and are
   * silently ignored on plain types — no need to gate by oscType here.
   */
  applyVoiceShape(shape: VoiceShape['lead'] | undefined): void {
    if (!shape) return;
    // GLITCH MITIGATION: same reason as PadEngine — Tone.OmniOscillator
    // rebuilds its underlying node when `type` changes; if a note is
    // sustaining when a preset chip is clicked, the user hears a click
    // as the wave snaps mid-cycle. Fade out → swap → fade back up
    // (30 ms each side) hides the discontinuity. Only when type swaps;
    // modIndex / harmonicity / envelope changes don't recreate nodes.
    const willSwapType = !!shape.oscType;
    if (willSwapType) {
      this.out.gain.cancelScheduledValues(0);
      this.out.gain.rampTo(0, 0.03);
    }
    if (shape.oscType) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mono.set({ oscillator: { type: shape.oscType as any } });
    }
    if (typeof shape.modIndex === 'number') {
      const m = Math.max(0, Math.min(20, shape.modIndex));
      this.baseModIndex = m;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mono.set({ oscillator: { modulationIndex: m } as any });
    }
    if (typeof shape.harmonicity === 'number') {
      const h = Math.max(0.25, Math.min(8, shape.harmonicity));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.mono.set({ oscillator: { harmonicity: h } as any });
    }
    if (typeof shape.attack === 'number') {
      const a = Math.max(0.001, Math.min(4, shape.attack));
      this.mono.set({ envelope: { attack: a } });
    }
    if (typeof shape.release === 'number') {
      const r = Math.max(0.05, Math.min(6, shape.release));
      this.mono.set({ envelope: { release: r } });
    }
    if (willSwapType) {
      // Restore nominal lead level (0.85, matching the constructor default).
      this.out.gain.rampTo(0.85, 0.03);
    }
  }

  dispose(): void {
    try {
      this.mono.dispose();
      this.bp.dispose();
      this.vibrato.dispose();
      this.out.dispose();
    } catch (e) {
      console.warn('[LeadEngine] dispose error', e);
    }
  }

  getCurrentVibe(): VibePreset | null {
    return this.currentVibe;
  }
}
