// Owner: music-brain
//
// Orchestrator. Fulfils the `MusicBrain` contract by composing:
//   - sequencer       — Tone.Transport tick at 16th-note resolution
//   - generator       — lead/bass/perc note synthesis
//   - harmony         — scale + voicing utilities
//   - markov          — order-2 transitions for the lead
//
// Subscribers register via `on()` and receive NoteEvent / ChordEvent / drum
// triggers. We do NOT call AudioEngine — the InteractionMapper wires our
// callbacks to it in Phase 3. When no subscriber is registered we console.log
// each event with an `[MusicBrain]` prefix (per project spec for early
// integration testing).

import * as Tone from 'tone';
import type {
  ChordEvent,
  Mood,
  MusicBrain,
  MusicBrainEvents,
  MusicBrainInput,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';
import {
  buildVoicing,
  getChordTones,
  getScale,
  normalizeChordSymbol,
  stripOctave,
  type Register,
  type ScaleInfo,
  type VoicingStyle,
} from './harmony';
import {
  buildPercPatterns,
  createBassState,
  createLeadState,
  generateBassNote,
  generateLeadNote,
  type BassGeneratorState,
  type LeadGeneratorState,
  type PercPatterns,
} from './generator';
import { createSequencer, STEPS_PER_BAR_VALUE } from './sequencer';
import type { Sequencer, StepInfo } from './sequencer-types';

const BARS_PER_PROGRESSION = 16;

interface MoodBias {
  /** Multiplier applied on top of user intensity, clamped to [0,1]. */
  intensityScale: number;
  /** Velocity range. */
  velMin: number;
  velMax: number;
  /** Whether the mood prefers held / sparse leads. */
  sparseLead: boolean;
}

const MOOD_BIASES: Record<Mood, MoodBias> = {
  calm: { intensityScale: 0.5, velMin: 0.5, velMax: 0.65, sparseLead: true },
  rising: { intensityScale: 0.8, velMin: 0.65, velMax: 0.8, sparseLead: false },
  peak: { intensityScale: 1.0, velMin: 0.75, velMax: 0.9, sparseLead: false },
  release: { intensityScale: 0.6, velMin: 0.55, velMax: 0.7, sparseLead: true },
};

const VIBE_VOICING_STYLE: Record<string, VoicingStyle> = {
  tycho: 'drop2',
  bonobo: 'drop2',
  hopkins: 'quartal',
  'floating-points': 'open',
};

export class MusicBrainImpl implements MusicBrain {
  private events: MusicBrainEvents | null = null;
  private sequencer: Sequencer = createSequencer();
  private input: MusicBrainInput | null = null;
  private vibe: VibePreset | null = null;
  private scale: ScaleInfo | null = null;
  private currentProgression: string[] = [];
  private currentChordIndex = 0;
  private barsPerChord = 4;
  private leadState: LeadGeneratorState | null = null;
  private bassState: BassGeneratorState | null = null;
  private perc: PercPatterns = { kick: [], hat: [], perc: [] };
  private isStarted = false;
  /** Stable RNG; pluggable in tests via setRng. */
  private rng: () => number = Math.random;

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  start(): void {
    if (this.isStarted) return;
    if (!this.input) {
      console.warn('[MusicBrain] start() called without setInput');
      return;
    }
    this.isStarted = true;
    this.applyVibe(this.input.vibe, /*hardReset*/ true);
    this.scheduleChord(0);
    this.sequencer.on({
      onStep: (info) => this.onStep(info),
      onBeat: (beat, time) => {
        this.events?.onBeat?.(beat);
        void time;
      },
      onBar: (bar) => this.onBar(bar),
    });
    const swing = this.vibe?.swing ?? 0;
    this.sequencer.setSwing(swing);
    this.sequencer.setBPM(this.input.bpm ?? this.vibe?.bpm ?? 100);
    this.sequencer.start();
  }

  stop(): void {
    if (!this.isStarted) return;
    this.isStarted = false;
    this.sequencer.stop();
    this.currentChordIndex = 0;
  }

  setInput(input: MusicBrainInput): void {
    const prevVibeId = this.vibe?.id;
    this.input = input;

    if (input.vibe.id !== prevVibeId) {
      this.applyVibe(input.vibe, /*hardReset*/ false);
    }
    if (this.leadState) this.leadState.intensity = clamp01(input.intensity);
    if (this.bassState) this.bassState.intensity = clamp01(input.intensity);
    this.perc = buildPercPatterns(this.effectiveIntensity());

    if (this.isStarted) {
      const bpm = input.bpm ?? input.vibe.bpm;
      // Smooth BPM ramp (rampTo handled by sequencer wrapper).
      this.sequencer.setBPM(bpm);
      this.sequencer.setSwing(input.vibe.swing);
    }
  }

  advanceChord(): void {
    if (!this.input || this.currentProgression.length === 0) return;
    this.currentChordIndex =
      (this.currentChordIndex + 1) % this.currentProgression.length;
    this.scheduleChord(this.currentChordIndex);
  }

  on(events: MusicBrainEvents): void {
    this.events = events;
  }

  off(events: MusicBrainEvents): void {
    if (this.events === events) this.events = null;
  }

  /** Test hook: replace the RNG for deterministic generation. */
  setRng(rng: () => number): void {
    this.rng = rng;
    if (this.leadState) this.leadState.rng = rng;
    if (this.bassState) this.bassState.rng = rng;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private applyVibe(vibe: VibePreset, hardReset: boolean): void {
    this.vibe = vibe;
    this.scale = getScale(vibe.scale.tonic, vibe.scale.mode);
    this.pickProgression();
    if (hardReset) this.currentChordIndex = 0;
    const chord = this.currentChordSymbol();
    const chordTones = getChordTones(chord);
    if (!this.leadState) {
      this.leadState = createLeadState(this.scale, chord, 4, this.rng);
    } else {
      this.leadState.scale = this.scale;
      this.leadState.currentChord = chord;
    }
    if (!this.bassState) {
      this.bassState = createBassState(chord, chordTones, 2, this.rng);
    } else {
      this.bassState.currentChord = chord;
      this.bassState.chordTones = chordTones;
      this.bassState.currentRoot =
        chordTones[0] ?? stripOctave(this.scale.tonic);
    }
    if (this.input) {
      this.leadState.intensity = clamp01(this.input.intensity);
      this.bassState.intensity = clamp01(this.input.intensity);
    }
    this.perc = buildPercPatterns(this.effectiveIntensity());
  }

  private pickProgression(): void {
    if (!this.vibe) return;
    const progressions = this.vibe.progressions;
    if (progressions.length === 0) {
      this.currentProgression = ['C'];
      return;
    }
    const idx = Math.floor(this.rng() * progressions.length);
    this.currentProgression = progressions[idx] ?? progressions[0] ?? ['C'];
    // Alternate 4 vs 8 bars per chord across re-picks for variety.
    this.barsPerChord = this.rng() < 0.5 ? 4 : 8;
  }

  private currentChordSymbol(): string {
    const sym = this.currentProgression[this.currentChordIndex];
    return normalizeChordSymbol(sym ?? 'C');
  }

  private effectiveIntensity(): number {
    if (!this.input) return 0;
    const moodBias = MOOD_BIASES[this.input.mood] ?? MOOD_BIASES.calm;
    return clamp01(this.input.intensity * moodBias.intensityScale);
  }

  private onStep(info: StepInfo): void {
    if (!this.input || !this.leadState || !this.bassState || !this.scale) return;
    const stepInBar = info.stepInBar;

    // Update phrase-arc contour (8-bar arc).
    const totalSteps = STEPS_PER_BAR_VALUE * 8;
    const arcStep = info.stepIndex % totalSteps;
    this.leadState.contourPhase = arcStep / totalSteps;

    // Lead — gated by mood-aware intensity.
    const moodBias = MOOD_BIASES[this.input.mood];
    const leadIntensity = clamp01(
      this.input.intensity * moodBias.intensityScale,
    );
    if (moodBias.sparseLead) {
      // Only fire on beat-aligned steps.
      if (stepInBar % 4 !== 0) {
        // skip — fall through to bass/perc
      } else {
        this.leadState.intensity = leadIntensity;
        this.leadState.currentChord = this.currentChordSymbol();
        const lead = generateLeadNote(
          this.leadState,
          info.beatIndex,
          stepInBar,
          info.time,
        );
        if (lead) this.emitLead(applyVelocity(lead, moodBias));
      }
    } else {
      this.leadState.intensity = leadIntensity;
      this.leadState.currentChord = this.currentChordSymbol();
      const lead = generateLeadNote(
        this.leadState,
        info.beatIndex,
        stepInBar,
        info.time,
      );
      if (lead) this.emitLead(applyVelocity(lead, moodBias));
    }

    // Bass.
    this.bassState.intensity = leadIntensity;
    this.bassState.currentChord = this.currentChordSymbol();
    const bassChordTones = getChordTones(this.currentChordSymbol());
    this.bassState.chordTones = bassChordTones;
    this.bassState.currentRoot = bassChordTones[0] ?? this.bassState.currentRoot;
    const bass = generateBassNote(this.bassState, stepInBar, info.time);
    if (bass) this.emitBass(applyVelocity(bass, moodBias));

    // Perc — Euclidean lookup.
    if (this.perc.kick[stepInBar]) this.emitKick(info.time);
    if (this.perc.hat[stepInBar]) this.emitHat(info.time);
    if (this.perc.perc[stepInBar]) this.emitPerc(info.time);
  }

  private onBar(barIndex: number): void {
    if (this.currentProgression.length === 0) return;
    if (barIndex === 0) return; // first bar already scheduled in start()
    if (barIndex % this.barsPerChord === 0) {
      const next = (this.currentChordIndex + 1) % this.currentProgression.length;
      this.currentChordIndex = next;
      this.scheduleChord(next);
    }
    // Re-pick progression every 16 bars to introduce variation.
    if (barIndex % BARS_PER_PROGRESSION === 0) {
      this.pickProgression();
      this.currentChordIndex = 0;
      this.scheduleChord(0);
    }
  }

  private scheduleChord(index: number): void {
    if (!this.vibe) return;
    const sym = normalizeChordSymbol(
      this.currentProgression[index] ?? 'C',
    );
    const style: VoicingStyle = VIBE_VOICING_STYLE[this.vibe.id] ?? 'drop2';
    const register: Register = 'mid';
    const notes = buildVoicing(sym, { register, voicingStyle: style });
    if (notes.length === 0) return;
    const duration = `${this.barsPerChord}m`; // bars in Tone notation
    const event: ChordEvent = {
      notes,
      duration,
      time: Tone.getTransport().state === 'started' ? '+0.001' : 0,
    };
    this.emitChord(event);
    // Update generator chord context immediately so the next steps see it.
    if (this.leadState) this.leadState.currentChord = sym;
    if (this.bassState) {
      this.bassState.currentChord = sym;
      const tones = getChordTones(sym);
      this.bassState.chordTones = tones;
      this.bassState.currentRoot = tones[0] ?? this.bassState.currentRoot;
    }
  }

  // -------------------------------------------------------------------------
  // Event emission. Falls back to console.log when no subscriber.
  // -------------------------------------------------------------------------

  private emitLead(event: NoteEvent): void {
    if (this.events) this.events.onLead(event);
    else logEvent('lead', event);
  }
  private emitBass(event: NoteEvent): void {
    if (this.events) this.events.onBass(event);
    else logEvent('bass', event);
  }
  private emitChord(event: ChordEvent): void {
    if (this.events) this.events.onChord(event);
    else logEvent('chord', event);
  }
  private emitKick(time: number | string): void {
    if (this.events) this.events.onKick(time);
    else logEvent('kick', { time });
  }
  private emitHat(time: number | string): void {
    if (this.events) this.events.onHat(time);
    else logEvent('hat', { time });
  }
  private emitPerc(time: number | string): void {
    if (this.events) this.events.onPerc(time);
    else logEvent('perc', { time });
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function applyVelocity(event: NoteEvent, mood: MoodBias): NoteEvent {
  const v = Math.max(mood.velMin, Math.min(mood.velMax, event.velocity));
  return { ...event, velocity: v };
}

function logEvent(kind: string, payload: unknown): void {
  console.info(`[MusicBrain] ${kind}`, payload);
}

export function createMusicBrain(): MusicBrain {
  return new MusicBrainImpl();
}
