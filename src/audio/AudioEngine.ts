// Owner: audio-engineer
//
// Single audio output. Owns Tone.js context, voices, FX chain, and the master
// analyser. Lazy-initialized from a user gesture (autoplay policy).
//
// Lifecycle:
//   1. Constructor: cheap — does NOT touch the audio context.
//   2. init() (must be called from a user gesture): awaits Tone.start(),
//      builds the master chain, instantiates the four voices, wires them in.
//   3. loadVibe / trigger* / setParams / setMute / triggerDrop are all safe
//      to call after init() resolves.
//
// All continuous parameter changes are smoothed (rampTo SMOOTH) to avoid
// zipper noise. This is enforced inside MasterChain.setParams().

import * as Tone from 'tone';
import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';
import { createMasterChain, type MasterChain } from './fx/master-chain';
import { PadEngine } from './voices/PadEngine';
import { LeadEngine } from './voices/LeadEngine';
import { BassEngine } from './voices/BassEngine';
import { PercEngine } from './voices/PercEngine';

const DEFAULT_STAB_NOTE = 'C5';

export class AudioEngineImpl implements AudioEngine {
  private master: MasterChain | null = null;
  private pad: PadEngine | null = null;
  private lead: LeadEngine | null = null;
  private bass: BassEngine | null = null;
  private perc: PercEngine | null = null;
  private ready = false;
  private initPromise: Promise<void> | null = null;
  private currentVibe: VibePreset | null = null;

  /**
   * Idempotent. Awaits Tone.start() (user-gesture context unlock), builds
   * master chain, instantiates voices. Safe to call multiple times — second
   * and subsequent calls return the same promise.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Audio robustness against main-thread stalls.
    //
    // The default Tone.js context targets low latency ('interactive',
    // ~0.1s lookahead) which is fine when the main thread is healthy.
    // On this app the main thread is busy with MediaPipe + p5; if it
    // stalls > 100ms the scheduler can't post events in time and the
    // listener hears a glitch / cutout. So we build the AudioContext
    // ourselves with `latencyHint: 'playback'` (longer output buffer,
    // glitch-resilient at the cost of ~150ms latency) and tell Tone to
    // use it via setContext() BEFORE the first audio operation.
    // latencyHint can ONLY be set at construction time on the underlying
    // AudioContext — assigning it later silently no-ops. We also bump
    // Tone's own lookahead to 0.3s so scheduled triggers are queued
    // well ahead of when they need to fire.
    try {
      // Numerical latencyHint asks the browser for an output buffer of AT
      // LEAST that many seconds. 0.2s is much bigger than 'playback'
      // (~0.15s on Chrome) and gives the renderer plenty of headroom for
      // GC pauses, MediaPipe inference spikes, and p5 draw stalls.
      const raw = new AudioContext({ latencyHint: 0.2 });
      const tuned = new Tone.Context(raw);
      // Lookahead 0.6s — Tone schedules each note this far ahead of its
      // target time. A 600ms main-thread freeze can pass without the
      // listener hearing anything because every imminent event is
      // already in the audio thread's queue.
      tuned.lookAhead = 0.6;
      Tone.setContext(tuned);
    } catch (e) {
      console.warn('[AudioEngine] context construction failed, falling back to defaults', e);
    }

    // Tone.start() must run in a user-gesture handler. The caller (UI
    // button) is responsible for that; we just await it. With our custom
    // context already installed, .start() simply resumes it.
    await Tone.start();

    this.master = await createMasterChain();
    const dest = this.master.input;

    this.pad = new PadEngine(dest);
    this.lead = new LeadEngine(dest);
    this.bass = new BassEngine(dest);
    this.perc = new PercEngine(dest);

    this.ready = true;
  }

  loadVibe(vibe: VibePreset): void {
    this.currentVibe = vibe;
    if (!this.ready || !this.master) {
      // Init not done yet — stash and apply when ready.
      // (We lose the async chain here intentionally; loadVibe is fire-and-
      // forget per the contract.)
      this.init()
        .then(() => this.applyVibeNow(vibe))
        .catch((e) => console.warn('[AudioEngine] loadVibe deferred init failed', e));
      return;
    }
    this.applyVibeNow(vibe);
  }

  private applyVibeNow(vibe: VibePreset): void {
    if (!this.master || !this.pad || !this.lead || !this.bass || !this.perc) {
      return;
    }
    this.master.applyVibe(vibe);
    this.pad.loadVibe(vibe);
    this.lead.loadVibe(vibe);
    this.bass.loadVibe(vibe);
    this.perc.loadVibe(vibe);
    // Tempo + swing live on the global Transport.
    Tone.getTransport().bpm.rampTo(vibe.bpm, 0.1);
    Tone.getTransport().swing = vibe.swing;
  }

  triggerLead(event: NoteEvent): void {
    if (!this.lead) return;
    this.lead.triggerNote(event);
  }

  triggerBass(event: NoteEvent): void {
    if (!this.bass) return;
    this.bass.triggerNote(event);
  }

  triggerChord(event: ChordEvent): void {
    if (!this.pad) return;
    this.pad.triggerChord(event);
  }

  triggerKick(time?: number | string): void {
    if (!this.perc) return;
    this.perc.triggerKick(time);
  }

  triggerHat(time?: number | string): void {
    if (!this.perc) return;
    this.perc.triggerHat(time);
  }

  triggerPerc(time?: number | string): void {
    if (!this.perc) return;
    this.perc.triggerPerc(time);
  }

  /**
   * One-shot stab triggered by the right-hand pinch gesture. Because the
   * AudioEngine itself doesn't know the current harmony, this defaults to
   * `DEFAULT_STAB_NOTE` ('C5'). For harmonically-aware stabs, the
   * InteractionMapper should call `triggerLead({ pitch, ... })` directly with
   * a chord-tone in the upper register instead of using this method.
   */
  triggerStab(): void {
    if (!this.lead) return;
    this.lead.triggerStab(DEFAULT_STAB_NOTE);
  }

  setParams(partial: Partial<AudioEngineParams>): void {
    if (!this.master) return;
    // Map AudioEngineParams (contract) to MasterChainParams. Naming is mostly
    // 1:1; `masterDuck` → `duck`.
    const mapped: Partial<{
      filterCutoff: number;
      filterResonance: number;
      saturatorDrive: number;
      reverbWet: number;
      delayFeedback: number;
      delayWet: number;
      brightness: number;
      duck: number;
    }> = {};
    if (typeof partial.filterCutoff === 'number')
      mapped.filterCutoff = clamp(partial.filterCutoff, 50, 20000);
    if (typeof partial.filterResonance === 'number')
      mapped.filterResonance = clamp(partial.filterResonance, 0, 20);
    if (typeof partial.saturatorDrive === 'number')
      mapped.saturatorDrive = clamp(partial.saturatorDrive, 0.5, 3);
    if (typeof partial.reverbWet === 'number')
      mapped.reverbWet = clamp(partial.reverbWet, 0, 1);
    if (typeof partial.delayFeedback === 'number')
      mapped.delayFeedback = clamp(partial.delayFeedback, 0, 0.95);
    if (typeof partial.delayWet === 'number')
      mapped.delayWet = clamp(partial.delayWet, 0, 1);
    if (typeof partial.brightness === 'number') {
      const b = clamp(partial.brightness, 0, 1);
      mapped.brightness = b;
      // Lead voice gets brightness too — it modulates filter env octaves.
      this.lead?.setBrightness(b);
    }
    if (typeof partial.masterDuck === 'number')
      mapped.duck = clamp(partial.masterDuck, 0, 1);
    this.master.setParams(mapped);
  }

  setMute(muted: boolean): void {
    this.master?.setMute(muted);
  }

  triggerDrop(active: boolean): void {
    this.master?.triggerDrop(active);
  }

  getAnalyser(): AnalyserNode {
    if (!this.master) {
      // Pre-init: return a dummy disconnected AnalyserNode so the visualizer
      // doesn't crash. The visualizer should poll until isReady() anyway.
      const ctx = Tone.getContext().rawContext as AudioContext;
      return ctx.createAnalyser();
    }
    return this.master.getAnalyser();
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Internal: get the current vibe. Useful for tests. */
  getCurrentVibe(): VibePreset | null {
    return this.currentVibe;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
