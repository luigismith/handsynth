// Owner: qa-listener / synthetic-player harness
//
// A drop-in AudioEngine that records every public call to the Observer and
// otherwise no-ops. Suitable for the fast bug-hunt suite — we don't need real
// Tone.js to validate the InteractionMapper's parameter shape, music-event
// fan-out, and the smart-voicing router contract.
//
// The brief asks us to support BOTH "real AudioEngine + happy-dom" and a fast
// stub; the real engine works under happy-dom for unit tests too but is much
// heavier. For the simulator we exclusively use this recorder — it lets us run
// minutes of simulated time in milliseconds and still surface bugs in the
// upstream subsystems (mapper, music brain, gesture interpreter).

import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';
import type { VoiceShape } from '@audio/voice-shape';
import type { VoiceKey } from '@audio/smart-voicing';
import type { Observer } from './observer';

export interface RecordingAudioOpts {
  /** Source of the current simulator time (seconds). */
  now: () => number;
}

export class RecordingAudioEngine implements AudioEngine {
  private ready = false;
  private vibe: VibePreset | null = null;

  constructor(
    private observer: Observer,
    private opts: RecordingAudioOpts,
  ) {}

  async init(): Promise<void> {
    this.ready = true;
  }

  loadVibe(vibe: VibePreset): void {
    this.vibe = vibe;
    // Vibe loads can blow up smart-voicing caches; we record them so the
    // observer can correlate any post-loadVibe param bursts.
    this.observer.recordVoiceShape({
      t: this.opts.now(),
      kind: 'applyVoiceShape',
      payload: { vibeId: vibe.id },
    });
  }

  triggerLead(event: NoteEvent): void {
    this.observer.recordNote({ t: this.opts.now(), kind: 'lead', event });
  }
  triggerBass(event: NoteEvent): void {
    this.observer.recordNote({ t: this.opts.now(), kind: 'bass', event });
  }
  triggerChord(event: ChordEvent): void {
    this.observer.recordNote({ t: this.opts.now(), kind: 'chord', event });
  }
  triggerKick(time?: number | string): void {
    this.observer.recordNote({
      t: this.opts.now(),
      kind: 'kick',
      event: null,
    });
    void time;
  }
  triggerHat(time?: number | string): void {
    this.observer.recordNote({
      t: this.opts.now(),
      kind: 'hat',
      event: null,
    });
    void time;
  }
  triggerPerc(time?: number | string): void {
    this.observer.recordNote({
      t: this.opts.now(),
      kind: 'perc',
      event: null,
    });
    void time;
  }
  triggerStab(): void {
    this.observer.recordNote({ t: this.opts.now(), kind: 'stab', event: null });
  }
  setParams(partial: Partial<AudioEngineParams>): void {
    this.observer.recordParam(this.opts.now(), partial);
  }
  setMute(_muted: boolean): void {
    void _muted;
  }
  triggerDrop(_active: boolean): void {
    void _active;
  }
  getAnalyser(): AnalyserNode {
    // The contract requires returning *something* — happy-dom provides
    // AnalyserNode via the AudioContext shim. We never actually call methods
    // on the analyser in the simulator, so a minimal stub works.
    return {} as AnalyserNode;
  }
  isReady(): boolean {
    return this.ready;
  }

  /** Extras matching the real AudioEngineImpl surface. */
  setVoiceTimbre(voice: VoiceKey, value: number): void {
    this.observer.recordVoiceShape({
      t: this.opts.now(),
      kind: 'setVoiceTimbre',
      payload: { voice, value },
    });
  }
  setVoiceWaveform(voice: VoiceKey, type: string): void {
    this.observer.recordVoiceShape({
      t: this.opts.now(),
      kind: 'setVoiceWaveform',
      payload: { voice, type },
    });
  }
  applyVoiceShape(shape: VoiceShape | undefined): void {
    this.observer.recordVoiceShape({
      t: this.opts.now(),
      kind: 'applyVoiceShape',
      payload: shape ?? null,
    });
  }
  getCurrentVibe(): VibePreset | null {
    return this.vibe;
  }
}
