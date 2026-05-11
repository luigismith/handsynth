// Owner: audio-engineer
//
// Lead voice — singing, vocal-flavored melodic line.
//
// Architecture:
//   * Two Tone.MonoSynths run side-by-side through a Tone.CrossFade. `mono`
//     (the A side) carries the vibe/VoiceShape oscillator — typically
//     `fmsawtooth`, `sawtooth`, or `fmsine`. `monoB` (the B side) is a
//     hard-coded `pulse` morph destination — a resonant, hollow tone that
//     contrasts the A side's harmonic richness. The `timbre` knob (0..1)
//     drives the crossfade: 0 = pure A, 1 = pure B, 0.5 = balanced mix.
//     Both MonoSynths receive every trigger so morphing mid-phrase
//     crossfades into already-sounding audio rather than starting from
//     silence.
//   * 12dB band-pass filter @ Q=4 sits AFTER the crossfade — adds a nasal-
//     but-focused character that helps the lead sit above the pad without
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

/** The hard-coded "morph destination" oscillator for the B side of the crossfade. */
const LEAD_MORPH_DESTINATION = 'pulse';

/**
 * Edge tolerance for the B-side trigger gate (see PadEngine — same idea).
 * When timbre is parked at 0 or 1 we fire only the dominant side; mid-morph
 * we fire both so a crossfade lands on live audio.
 */
const TIMBRE_EDGE_EPS = 0.02;

export class LeadEngine {
  private mono: Tone.MonoSynth;
  private monoB: Tone.MonoSynth;
  private xfade: Tone.CrossFade;
  private bp: Tone.Filter;
  private vibrato: Tone.Vibrato;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;
  private brightness = 0.5;
  private baseModIndex = 1.4;
  /**
   * PERF (v0.3.0 freeze fix): mirror of the xfade target so trigger() can
   * skip the inaudible MonoSynth at the timbre extremes. See triggerChord
   * in PadEngine for the rationale.
   */
  private currentTimbre = 0;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(0.85);

    this.mono = this.makeMono('fmsawtooth');
    this.monoB = this.makeMono(LEAD_MORPH_DESTINATION);

    this.xfade = new Tone.CrossFade(0); // default: 100% A (legacy behavior)

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

    this.mono.connect(this.xfade.a);
    this.monoB.connect(this.xfade.b);
    this.xfade.connect(this.vibrato);
    this.vibrato.connect(this.bp);
    this.bp.connect(this.out);

    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  private makeMono(oscType: string): Tone.MonoSynth {
    return new Tone.MonoSynth({
      // OmniOscillator accepts richer types ('fmsawtooth', 'fatsine', etc.)
      // than `ToneOscillatorType`, but the field type isn't exported.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oscillator: { type: oscType } as any,
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
    // B-side stays on the morph destination — vibe never overrides it.

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

  /** Trigger a single melodic note.
   *
   * PERF (v0.3.0 freeze fix): gate the inaudible MonoSynth when timbre is
   * parked at 0 or 1 — saves one note-on / note-off scheduling pair per
   * note on the common-case timbre extremes. Mid-morph values still fire
   * both so an in-flight crossfade lands on already-sounding audio.
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
      this.mono.triggerAttackRelease(note, duration, t, v);
    }
    if (tim > TIMBRE_EDGE_EPS) {
      this.monoB.triggerAttackRelease(note, duration, t, v);
    }
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
    this.monoB.set({
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
   *
   * `timbre` morphs the crossfade A↔B continuously; it does NOT need the
   * 30 ms fade gate because the crossfade itself is the fade.
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
      this.monoB.set({ envelope: { attack: a } });
    }
    if (typeof shape.release === 'number') {
      const r = Math.max(0.05, Math.min(6, shape.release));
      this.mono.set({ envelope: { release: r } });
      this.monoB.set({ envelope: { release: r } });
    }
    if (typeof shape.timbre === 'number') {
      this.setTimbre(shape.timbre);
    }
    if (willSwapType) {
      // Restore nominal lead level (0.85, matching the constructor default).
      this.out.gain.rampTo(0.85, 0.03);
    }
  }

  /**
   * Set the A↔B crossfade morph (0..1). 0 = 100% A (vibe/preset
   * oscillator); 1 = 100% B (pulse destination). Smoothed over 80 ms.
   */
  setTimbre(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.currentTimbre = v;
    this.xfade.fade.rampTo(v, 0.08);
  }

  dispose(): void {
    try {
      this.mono.dispose();
      this.monoB.dispose();
      this.xfade.dispose();
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
