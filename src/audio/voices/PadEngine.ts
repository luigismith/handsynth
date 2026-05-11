// Owner: audio-engineer
//
// Pad voice — wide, slow-attack chord pad. Two layered PolySynths detuned
// ±7 cents for chorus-like width, fed through a 24dB low-pass with a slow
// LFO modulating the cutoff for a "breathing" feel.
//
// As of the intelligent-voicing pass, the pad runs TWO complete A/B stacks —
// each a pair of detuned PolySynths — and mixes them through a Tone.CrossFade.
// The A side (layerA + layerB, the historical names) carries whatever waveform
// the vibe / VoiceShape sets; the B side (layerC + layerD) is a hard-coded
// `sine` morph destination — the clean, harmonic counterpart. The `timbre`
// knob (0..1) controls the crossfade: 0 = pure A, 1 = pure B, 0.5 = balanced
// equal-power mix. Continuous, never abrupt — the analog-synth "WAVE" feel.
// When `timbre` isn't set the CrossFade default of 0 leaves the pad sounding
// exactly as before this refactor.
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
// PERF FIX (live capture: V climbing 8→16→22 over 45 s + freezes after
// ~1 min sustained play): the previous 4 s release made notes from
// successive chord changes overlap heavily. With chord cycles ~1/s, up
// to 4 chords' worth of voices linger in the PolySynth pool → audio
// thread mixing cost climbs → freezes under cumulative MediaPipe load.
// 2 s release halves the overlap window without changing the pad's
// "smooth bloom" character meaningfully (the attack and decay
// dominate the perceived envelope). maxPolyphony cap was tried first
// but `poly.maxPolyphony = X` post-construction silences the synth
// in Tone.js 15.x — see commit f052fa0.
const RELEASE = 2.0;

const LFO_RATE = 0.15; // Hz
const LFO_LOW = 600; // Hz
const LFO_HIGH = 4500; // Hz
const FILTER_Q = 1;

// Detune offset between layer A and layer B (cents). +7 / -7 yields a stable
// "supersaw" feel without hard beating.
const DETUNE_CENTS = 7;

/** The hard-coded "morph destination" waveform for the B side of the crossfade. */
const PAD_MORPH_DESTINATION = 'sine';

/**
 * Edge tolerance for the B-side trigger gate. When |timbre - 0| or
 * |timbre - 1| is within this ε, only the dominant side fires on a note —
 * the other side is inaudible at the xfade and would only cost polyphony.
 * Mid-morph values (epsilon < timbre < 1-epsilon) fire both sides so an
 * in-flight crossfade lands on already-sounding audio.
 */
const TIMBRE_EDGE_EPS = 0.1;

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
  // A side — owns the "current" waveform set by vibe / VoiceShape.
  private layerA: Tone.PolySynth;
  private layerB: Tone.PolySynth;
  // B side of the crossfade — hard-coded sine morph destination.
  private layerC: Tone.PolySynth;
  private layerD: Tone.PolySynth;
  private aBus: Tone.Gain;
  private bBus: Tone.Gain;
  private xfade: Tone.CrossFade;
  private filter: Tone.Filter;
  private lfo: Tone.LFO;
  private out: Tone.Gain;
  private currentVibe: VibePreset | null = null;
  /**
   * PERF (v0.3.0 freeze fix): track the current xfade target so triggerChord
   * can skip the inaudible side. With four PolySynths firing every chord,
   * the audio-thread cost of the layered pad nearly doubled in v0.3.0 vs
   * v0.2.0. When timbre is parked at 0 (pure A) or 1 (pure B) — the case
   * for the vast majority of presets — there's no need to schedule four
   * voices' worth of polyphony, two of them inaudible. We still fire both
   * sides when mid-morph (0 < timbre < 1) so an in-flight crossfade lands
   * on already-sounding audio rather than swelling in from silence.
   */
  private currentTimbre = 0;

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
    this.layerC = this.makeLayer(PAD_MORPH_DESTINATION, +DETUNE_CENTS);
    this.layerD = this.makeLayer(PAD_MORPH_DESTINATION, -DETUNE_CENTS);

    // Per-side bus so each layer pair can be addressed as a single signal at
    // the CrossFade input. Two PolySynths → Gain → CrossFade.a (or .b).
    this.aBus = new Tone.Gain(1);
    this.bBus = new Tone.Gain(1);
    this.xfade = new Tone.CrossFade(0); // default: 100% A (legacy behavior)

    this.lfo = new Tone.LFO({
      frequency: LFO_RATE,
      min: LFO_LOW,
      max: LFO_HIGH,
      type: 'sine',
    }).start();

    // LFO -> filter cutoff. (LFO outputs a Signal; .connect onto the
    // filter.frequency Param.)
    this.lfo.connect(this.filter.frequency);

    this.layerA.connect(this.aBus);
    this.layerB.connect(this.aBus);
    this.layerC.connect(this.bBus);
    this.layerD.connect(this.bBus);
    this.aBus.connect(this.xfade.a);
    this.bBus.connect(this.xfade.b);
    this.xfade.connect(this.filter);
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
    // NOTE: tried `poly.maxPolyphony = 6` here to cap voice-pool
    // overflow during sustained play. RESULT: pad went completely
    // silent (V=0 in DIAG, user confirmed no audio). Tone.js 15.x
    // appears not to honor maxPolyphony setter after construction —
    // or honors it in a way that disposes existing voices. Reverted;
    // the voice-climb issue is real but this isn't the way to fix it.
    return poly;
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    const w = this.normalizeWaveform(vibe.pad.waveform);
    setOscType(this.layerA, w);
    setOscType(this.layerB, w);
    // B-side morph destination stays on `sine` — vibe never overrides it.

    // Per-vibe LFO rate (use the preset value, but clamp to a sensible band).
    const rate = Math.max(0.05, Math.min(1.0, vibe.pad.lfoRate * 0.6));
    this.lfo.frequency.rampTo(rate, 0.2);

    // Detune from preset (cents). Layered ±half so total spread matches.
    const cents = Math.max(2, Math.min(24, vibe.pad.detuneCents)) / 2;
    this.layerA.set({ detune: +cents });
    this.layerB.set({ detune: -cents });
    this.layerC.set({ detune: +cents });
    this.layerD.set({ detune: -cents });
  }

  /**
   * Apply a factory-preset overlay on top of whatever the current vibe set.
   * Only the fields explicitly set on `shape` are applied — missing fields
   * leave the existing engine state alone. Called by AudioEngine after
   * `setParams` when a factory-preset chip is clicked.
   *
   * `detuneCents` is the TOTAL spread (both layers combined); the engine
   * splits it ±half. Clamped to [2..40] to avoid pathological detune.
   *
   * `timbre` is the continuous A/B crossfade morph; it ramps smoothly so it
   * does NOT need the 50 ms fade gate (the crossfade IS the fade).
   */
  applyVoiceShape(shape: VoiceShape['pad'] | undefined): void {
    if (!shape) return;
    // GLITCH MITIGATION: changing OmniOscillator type rebuilds the
    // underlying oscillator atomically — any in-flight voices snap to the
    // new waveform mid-cycle, producing an audible click. Brief fade-out
    // on the engine output Gain hides the discontinuity. 50 ms is short
    // enough to feel instant on a preset chip click; 50 ms ramp back up
    // restores the pad smoothly. Only ramp when waveform actually changes
    // (the only path that rebuilds the oscillator).
    const willSwapType = !!shape.waveform;
    if (willSwapType) {
      this.out.gain.cancelScheduledValues(0);
      this.out.gain.rampTo(0, 0.05);
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
      this.layerC.set({ detune: +c });
      this.layerD.set({ detune: -c });
    }
    if (typeof shape.attack === 'number') {
      const a = Math.max(0.001, Math.min(6, shape.attack));
      this.layerA.set({ envelope: { attack: a } });
      this.layerB.set({ envelope: { attack: a } });
      this.layerC.set({ envelope: { attack: a } });
      this.layerD.set({ envelope: { attack: a } });
    }
    if (typeof shape.release === 'number') {
      const r = Math.max(0.05, Math.min(10, shape.release));
      this.layerA.set({ envelope: { release: r } });
      this.layerB.set({ envelope: { release: r } });
      this.layerC.set({ envelope: { release: r } });
      this.layerD.set({ envelope: { release: r } });
    }
    if (typeof shape.timbre === 'number') {
      this.setTimbre(shape.timbre);
    }
    if (willSwapType) {
      // Fade back up to nominal pad level (0.7) after a brief silence.
      this.out.gain.rampTo(0.7, 0.05);
    }
  }

  /**
   * Set the A↔B crossfade morph (0..1). 0 = 100% A (the vibe/preset
   * waveform); 1 = 100% B (sine destination). Tone.CrossFade uses
   * equal-power curves so 0.5 = balanced mix. Smoothed over 80 ms so the
   * morph is audible-as-motion, not a click.
   */
  setTimbre(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    this.currentTimbre = v;
    this.xfade.fade.rampTo(v, 0.08);
  }

  /**
   * Trigger a chord. The caller passes voicing-aware notes (the MusicBrain
   * is responsible for choosing voicings; the pad just plays whatever it's
   * given). `time` is optional — defaults to "now".
   *
   * PERF (v0.3.0 freeze fix): gate the inaudible side of the crossfade.
   *   - timbre <= TIMBRE_EDGE_EPS  → pure A; skip layerC + layerD
   *   - timbre >= 1 - TIMBRE_EDGE_EPS → pure B; skip layerA + layerB
   *   - otherwise (mid-morph) → fire both so the crossfade lands on
   *     already-sounding audio rather than swelling from silence
   * Saves roughly 50% of pad polyphony cost when timbre is parked at a
   * preset default (which is the common case). The TIMBRE_EDGE_EPS of
   * 0.02 mirrors the lead-brightness ε so a wave-LFO wobble doesn't flap
   * the gate.
   */
  triggerChord(event: ChordEvent): void {
    // FREEZE FIX: see LeadEngine.trigger for the full explanation. Clamp
    // time to max(time, now) and wrap each trigger in try/catch so a Tone
    // refusal can't escape and corrupt Transport's _timeline.
    const now = Tone.now();
    const eventTime = event.time;
    const t = typeof eventTime === 'number' ? Math.max(eventTime, now) : eventTime ?? now;
    const v = this.currentTimbre;
    const fireA = v < 1 - TIMBRE_EDGE_EPS;
    const fireB = v > TIMBRE_EDGE_EPS;
    if (fireA) {
      try { this.layerA.triggerAttackRelease(event.notes, event.duration, t, 0.65); }
      catch (e) { console.warn('[pad] layerA trigger refused', e); }
      try { this.layerB.triggerAttackRelease(event.notes, event.duration, t, 0.55); }
      catch (e) { console.warn('[pad] layerB trigger refused', e); }
    }
    if (fireB) {
      try { this.layerC.triggerAttackRelease(event.notes, event.duration, t, 0.65); }
      catch (e) { console.warn('[pad] layerC trigger refused', e); }
      try { this.layerD.triggerAttackRelease(event.notes, event.duration, t, 0.55); }
      catch (e) { console.warn('[pad] layerD trigger refused', e); }
    }
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
      'pulse',
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
      this.layerC.dispose();
      this.layerD.dispose();
      this.aBus.dispose();
      this.bBus.dispose();
      this.xfade.dispose();
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
