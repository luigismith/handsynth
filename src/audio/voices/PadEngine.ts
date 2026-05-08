// Owner: audio-engineer
//
// Pad voice — wide, slow-attack chord pad. Two layered PolySynths detuned
// ±7 cents for chorus-like width, fed through a 24dB low-pass with a slow
// LFO modulating the cutoff for a "breathing" feel.
//
// Sound-design notes:
//   * Layering two detuned Tone.PolySynth instances creates lush stereo width
//     without needing a separate chorus stage. Each layer uses the vibe's
//     waveform (`fatsawtooth`, `square`, `sawtooth`, etc.).
//   * The low-pass Q is intentionally low (~1) — high resonance turns the pad
//     buzzy and steals headroom from the lead.
//   * LFO @ 0.15Hz: full sweep takes ~6.6s, slower than the human breath but
//     fast enough that the listener perceives motion.
//   * Envelope: A=2.5, D=0.8, S=0.7, R=4 — cinematic.

import * as Tone from 'tone';
import type { ChordEvent, VibePreset } from '@contracts/contracts';
import type { VoiceShape } from '../voice-shape';

const ATTACK = 2.5;
const DECAY = 0.8;
const SUSTAIN = 0.7;
const RELEASE = 4.0;

const LFO_RATE = 0.15; // Hz
const LFO_LOW = 600; // Hz
const LFO_HIGH = 4500; // Hz
const FILTER_Q = 1;

// Detune offset between layer A and layer B (cents). +7 / -7 yields a stable
// "supersaw" feel without hard beating.
const DETUNE_CENTS = 7;

/**
 * The OmniOscillator type union accepted by Tone.Synth/PolySynth. Tone exports
 * `ToneOscillatorType` (sine/square/...) but NOT the wider OmniOscillatorType
 * union. We type our local helper as a string and cast at the boundary.
 */
type OscTypeStr = string;

// Helper: PolySynth.set takes a deep partial; we use a loosened cast so the
// 'fatsawtooth' / 'fmsine' literals — which are valid at runtime per
// OmniOscillator — type-check. (OmniOscillatorSynthOptions in Tone is a
// disjoint union that TS doesn't always narrow cleanly with object-literal
// inference.)
function setOscType(
  poly: Tone.PolySynth,
  type: OscTypeStr,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  poly.set({ oscillator: { type: type as any } });
}

export class PadEngine {
  private layerA: Tone.PolySynth;
  private layerB: Tone.PolySynth;
  private filter: Tone.Filter;
  private lfo: Tone.LFO;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;

  constructor(destination: Tone.ToneAudioNode | AudioNode) {
    this.out = new Tone.Gain(0.7); // pads sit a bit under unity to leave room
    this.filter = new Tone.Filter({
      type: 'lowpass',
      frequency: LFO_HIGH,
      Q: FILTER_Q,
      rolloff: -24,
    });

    this.layerA = this.makeLayer('fatsawtooth', +DETUNE_CENTS);
    this.layerB = this.makeLayer('fatsawtooth', -DETUNE_CENTS);

    this.lfo = new Tone.LFO({
      frequency: LFO_RATE,
      min: LFO_LOW,
      max: LFO_HIGH,
      type: 'sine',
    }).start();

    // LFO -> filter cutoff. (LFO outputs a Signal; .connect onto the
    // filter.frequency Param.)
    this.lfo.connect(this.filter.frequency);

    this.layerA.connect(this.filter);
    this.layerB.connect(this.filter);
    this.filter.connect(this.out);
    // Tone.connect accepts both ToneAudioNode and raw AudioNode destinations.
    Tone.connect(this.out, destination);
  }

  private makeLayer(waveform: OscTypeStr, detuneCents: number): Tone.PolySynth {
    const poly = new Tone.PolySynth(Tone.Synth, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oscillator: { type: waveform as any },
      envelope: {
        attack: ATTACK,
        decay: DECAY,
        sustain: SUSTAIN,
        release: RELEASE,
      },
      // -6 dB per layer (was -10) so the doubled stack lands around -3 dB
      // pre-FX — present enough to feel like a continuous bed without
      // dominating the lead.
      volume: -6,
    });
    poly.set({ detune: detuneCents });
    return poly;
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    const w = this.normalizeWaveform(vibe.pad.waveform);
    setOscType(this.layerA, w);
    setOscType(this.layerB, w);

    // Per-vibe LFO rate (use the preset value, but clamp to a sensible band).
    const rate = Math.max(0.05, Math.min(1.0, vibe.pad.lfoRate * 0.6));
    this.lfo.frequency.rampTo(rate, 0.2);

    // Detune from preset (cents). Layered ±half so total spread matches.
    const cents = Math.max(2, Math.min(24, vibe.pad.detuneCents)) / 2;
    this.layerA.set({ detune: +cents });
    this.layerB.set({ detune: -cents });
  }

  /**
   * Apply a factory-preset overlay on top of whatever the current vibe set.
   * Only the fields explicitly set on `shape` are applied — missing fields
   * leave the existing engine state alone. Called by AudioEngine after
   * `setParams` when a factory-preset chip is clicked.
   *
   * `detuneCents` is the TOTAL spread (both layers combined); the engine
   * splits it ±half. Clamped to [2..40] to avoid pathological detune.
   */
  applyVoiceShape(shape: VoiceShape['pad'] | undefined): void {
    if (!shape) return;
    // GLITCH MITIGATION: changing OmniOscillator type rebuilds the
    // underlying oscillator atomically — any in-flight voices snap to the
    // new waveform mid-cycle, producing an audible click. Brief fade-out
    // on the engine output Gain hides the discontinuity. 30 ms is short
    // enough to feel instant on a preset chip click; 30 ms ramp back up
    // restores the pad smoothly. Only ramp when waveform actually changes
    // (the only path that rebuilds the oscillator).
    const willSwapType = !!shape.waveform;
    if (willSwapType) {
      this.out.gain.cancelScheduledValues(0);
      this.out.gain.rampTo(0, 0.03);
    }
    if (shape.waveform) {
      const w = this.normalizeWaveform(shape.waveform);
      setOscType(this.layerA, w);
      setOscType(this.layerB, w);
    }
    if (typeof shape.detuneCents === 'number') {
      const c = Math.max(2, Math.min(40, shape.detuneCents)) / 2;
      this.layerA.set({ detune: +c });
      this.layerB.set({ detune: -c });
    }
    if (typeof shape.attack === 'number') {
      const a = Math.max(0.001, Math.min(6, shape.attack));
      this.layerA.set({ envelope: { attack: a } });
      this.layerB.set({ envelope: { attack: a } });
    }
    if (typeof shape.release === 'number') {
      const r = Math.max(0.05, Math.min(10, shape.release));
      this.layerA.set({ envelope: { release: r } });
      this.layerB.set({ envelope: { release: r } });
    }
    if (willSwapType) {
      // Fade back up to nominal pad level (0.7) after a brief silence.
      this.out.gain.rampTo(0.7, 0.03);
    }
  }

  /**
   * Trigger a chord. The caller passes voicing-aware notes (the MusicBrain
   * is responsible for choosing voicings; the pad just plays whatever it's
   * given). `time` is optional — defaults to "now".
   */
  triggerChord(event: ChordEvent): void {
    const t = event.time ?? Tone.now();
    // Slight humanizing — different velocity per layer for stereo "thickness"
    // (the layers have ±detune so they're not unison; varying velocity makes
    // the doubled hits feel less stiff).
    this.layerA.triggerAttackRelease(event.notes, event.duration, t, 0.65);
    this.layerB.triggerAttackRelease(event.notes, event.duration, t, 0.55);
  }

  private normalizeWaveform(w: string): OscTypeStr {
    // Some preset values use synthesised names like "square+sine" — Tone's
    // OmniOscillator doesn't support arbitrary stacks; we map to a fat
    // variant of the first component, which gives us a richer feel.
    if (w.includes('+')) {
      const first = w.split('+')[0];
      return first ? `fat${first}` : 'fatsawtooth';
    }
    const valid = [
      'sine',
      'square',
      'sawtooth',
      'triangle',
      'fatsawtooth',
      'fatsquare',
      'fatsine',
      'fattriangle',
      'amsawtooth',
      'amsine',
      'amsquare',
      'amtriangle',
      'fmsawtooth',
      'fmsine',
      'fmsquare',
      'fmtriangle',
    ];
    if (valid.includes(w)) return w;
    return 'fatsawtooth';
  }

  dispose(): void {
    try {
      this.lfo.stop();
      this.lfo.dispose();
      this.layerA.dispose();
      this.layerB.dispose();
      this.filter.dispose();
      this.out.dispose();
    } catch (e) {
      console.warn('[PadEngine] dispose error', e);
    }
  }

  /** Used in tests / introspection. */
  getCurrentVibe(): VibePreset | null {
    return this.currentVibe;
  }
}
