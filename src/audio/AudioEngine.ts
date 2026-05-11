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
//
// Intelligent voicing (smart router):
//   Each pitched voice (pad/lead/bass) now runs TWO oscillator stacks through
//   a Tone.CrossFade. The user-set `timbre` axis (0..1) controls the
//   crossfade — analog-synth "WAVE" knob style, continuous, never abrupt.
//   On top of that the `smartVoicing` toggle (default ON) lets the engine
//   nudge each voice's effective timbre by ±0.15 based on the running FX
//   state: low cutoff → bias toward sine destinations, high drive → bias
//   toward square/pulse, high reverb → bias pad toward fmsine glassy. The
//   router runs every time `setParams` is called; if smartVoicing is false
//   the nudges collapse to zero and only the user-set timbre applies.

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
import type { VoiceShape } from './voice-shape';
import {
  computeSmartTimbre,
  type SmartVoiceParams,
  type VoiceKey,
} from './smart-voicing';

const DEFAULT_STAB_NOTE = 'C5';

/** Default per-voice user-set timbre when nothing else has been said. */
const DEFAULT_TIMBRE = 0.5;

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
   * Last brightness value forwarded to the lead voice. The InteractionMapper
   * already throttles its setParams pushes via diffParams (ε=0.005 on
   * brightness), but EVERY brightness push fans out into lead.setBrightness
   * which itself schedules TWO operations (filterEnvelope set + bp.rampTo).
   * Using a wider ε here (0.02) means a wave-LFO wobble or a slowly-decaying
   * gesture pulse no longer triggers a fresh filter-env reschedule on the
   * lead per frame — the master filter still rides every change but the
   * lead voice is updated only when the brightness moves audibly on it.
   */
  private lastLeadBrightness: number | null = null;

  // ---------------------------------------------------------------------
  // Smart-voicing state
  // ---------------------------------------------------------------------

  /** Master toggle. Default ON so out-of-the-box the engine feels alive. */
  private smartVoicing = true;

  /** User-set timbre per voice (the SettingsPanel knob value). */
  private userTimbre: Record<VoiceKey, number> = {
    pad: DEFAULT_TIMBRE,
    lead: DEFAULT_TIMBRE,
    bass: DEFAULT_TIMBRE,
  };

  /**
   * User-picked waveform per voice (the SettingsPanel dropdown value). `null`
   * means "no explicit user choice — the active vibe / factory preset wins".
   * Once the user opens the VOCE dropdown the choice is sticky for the
   * lifetime of the engine: switching factory presets DOES still override
   * (preset chips are full one-shot applies), but every other path that calls
   * `setParams` or `setVoiceTimbre` leaves the user waveform alone.
   */
  private userWaveform: Record<VoiceKey, string | null> = {
    pad: null,
    lead: null,
    bass: null,
  };

  /** Mirror of the FX params the smart router watches. Updated by setParams. */
  private smartInput: SmartVoiceParams = {
    filterCutoff: 8000,
    filterResonance: 1,
    saturatorDrive: 1,
    reverbWet: 0.4,
  };

  /**
   * PERF (v0.3.0 freeze fix): cache the last SmartVoiceParams snapshot the
   * router actually evaluated. The mapper drives setParams at ~24 Hz fanned
   * out across multiple per-finger axes, but the smart-voicing rules only
   * care about (cutoff, drive, Q, reverb) and use threshold predicates with
   * fairly wide deadbands (rule 1 at 800 Hz, rule 3 at drive 2.0, etc.).
   * Re-evaluating the router on every setParams pushes ~432 ops/sec of
   * branch-heavy work into the audio scheduler when the inputs haven't
   * moved enough to actually flip any rule. We skip the router pass when
   * every watched input is within its per-axis ε of the last evaluation —
   * the resulting nudges would be byte-identical, so the rampTo's would
   * collapse anyway, but we save the comparisons + the per-voice clamp
   * arithmetic up the chain.
   *
   * The ε values are deliberately a bit wider than PARAM_EPS in the mapper:
   * the router's rules are threshold predicates, so we only need to detect
   * meaningful crossings rather than perceptual jnds. A 50 Hz cutoff or
   * 0.05 drive nudge cannot cross any rule threshold from far away — and
   * near a threshold the diff WILL exceed ε, re-running the router.
   */
  private lastSmartInputEvaluated: SmartVoiceParams | null = null;

  /**
   * Last value we actually pushed to each voice's CrossFade. We skip
   * re-pushing when the effective timbre hasn't moved more than 0.005 to
   * avoid scheduling churn on every gesture frame — the rampTo cost is
   * tiny per call but the cumulative re-schedules add up when intensity is
   * being driven continuously by the InteractionMapper.
   */
  private lastEffectiveTimbre: Record<VoiceKey, number> = {
    pad: NaN,
    lead: NaN,
    bass: NaN,
  };

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
      // LEAST that many seconds. 0.15s is bigger than the 'playback' hint
      // default (~0.1–0.15s depending on browser) and gives the renderer
      // headroom for GC pauses + MediaPipe inference spikes without the
      // queue-depth side-effects of a 0.2 s buffer.
      const raw = new AudioContext({ latencyHint: 0.15 });
      const tuned = new Tone.Context(raw);
      // Lookahead 0.4 s. Was 0.6 s; that was too aggressive — Tone queued
      // up many minutes' worth of scheduled rampTo events per second
      // (continuous gesture-driven setParams plus the deeper queue) and
      // the audio thread's event list grew unbounded, eventually
      // freezing the page. 0.4 s still survives a fairly long main-
      // thread stall while keeping Tone's per-tick work bounded.
      tuned.lookAhead = 0.4;
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
    // GLITCH FIX (audio audit): vibe switch was clicking because the
    // cascade of voice loadVibe() calls below each potentially recreates
    // their OmniOscillator on type swap. Dip the master output for ~200 ms
    // around the cascade so the user hears one smooth transition instead
    // of N voice-level clicks.
    this.master.dipForTransition();
    this.master.applyVibe(vibe);
    this.pad.loadVibe(vibe);
    this.lead.loadVibe(vibe);
    this.bass.loadVibe(vibe);
    this.perc.loadVibe(vibe);
    // Tempo + swing live on the global Transport.
    Tone.getTransport().bpm.rampTo(vibe.bpm, 0.1);
    Tone.getTransport().swing = vibe.swing;
    // Loading a vibe is a full reset of the voice oscillators — clear the
    // per-voice user-pick cache so the SettingsPanel dropdown re-syncs from
    // the vibe defaults on the next read. (Same intent as a factory preset
    // chip click: the user is picking a whole sonic identity, not preserving
    // a per-voice override across it.)
    this.userWaveform.pad = null;
    this.userWaveform.lead = null;
    this.userWaveform.bass = null;
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
    // smartVoicing is a non-audio toggle — handle BEFORE the master check so
    // the UI can flip it pre-init and we'll respect it post-init.
    let smartFlagChanged = false;
    if (typeof partial.smartVoicing === 'boolean') {
      if (partial.smartVoicing !== this.smartVoicing) smartFlagChanged = true;
      this.smartVoicing = partial.smartVoicing;
    }
    if (!this.master) {
      // Even pre-init we still want to ingest the watched-params snapshot
      // so the FIRST post-init router pass sees the right baseline.
      this.ingestSmartInput(partial);
      return;
    }
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
      // GLITCH MITIGATION: gate the lead.setBrightness fan-out behind a
      // wider ε (0.02) than the master ε (0.005). lead.setBrightness
      // schedules a filterEnvelope.set + a bp.frequency.rampTo per call;
      // when the wave LFO or a decaying gesture pulse nudges brightness
      // by ~0.005/frame the master can ramp inaudibly, but the lead's
      // dual-op reschedule is comparatively expensive and audibly
      // identical between deltas <0.02. Master still gets every frame.
      if (
        this.lastLeadBrightness === null ||
        Math.abs(b - this.lastLeadBrightness) >= 0.02
      ) {
        this.lead?.setBrightness(b);
        this.lastLeadBrightness = b;
      }
    }
    if (typeof partial.masterDuck === 'number')
      mapped.duck = clamp(partial.masterDuck, 0, 1);
    this.master.setParams(mapped);

    // Smart router fires AFTER the master FX params are pushed — it reads
    // whatever just changed and re-evaluates each voice's effective timbre.
    //
    // PERF (v0.3.0 freeze fix): skip the router pass when none of the
    // watched inputs (cutoff, drive, Q, reverb) moved more than its per-
    // axis ε since the last evaluation. The rules use threshold predicates
    // with wide deadbands, so sub-ε deltas can never flip a rule and the
    // resulting nudges would be byte-identical. Callers that aren't gated
    // by setParams (setVoiceTimbre, applyVoiceShape) still force a full
    // router pass — see applySmartRouter() for the no-arg path.
    this.ingestSmartInput(partial);
    if (smartFlagChanged || this.smartInputChangedEnough()) {
      this.lastSmartInputEvaluated = { ...this.smartInput };
      this.applySmartRouter();
    }
  }

  /**
   * Returns true iff any watched input in `smartInput` has moved more than
   * its per-axis ε from the last evaluation. The first call (cache=null)
   * always returns true so the initial router pass runs.
   *
   * Per-axis ε:
   *   - filterCutoff: 25 Hz — rule thresholds at 800 / 10 000 Hz; a 25 Hz
   *     step can never cross either from far away, and right at the
   *     boundary the difference rapidly exceeds this so the router
   *     re-evaluates as the user sweeps through.
   *   - saturatorDrive: 0.03 — rule thresholds at 1.0 / 2.0; the smallest
   *     drive change the mapper emits is the PARAM_EPS=0.01 jnd, but the
   *     router rules don't care about jnd-level moves.
   *   - filterResonance: 0.25 — rule threshold at Q=8.
   *   - reverbWet: 0.02 — rule threshold at 0.7.
   */
  private smartInputChangedEnough(): boolean {
    const prev = this.lastSmartInputEvaluated;
    if (!prev) return true;
    const cur = this.smartInput;
    return (
      Math.abs(cur.filterCutoff - prev.filterCutoff) > 25 ||
      Math.abs(cur.saturatorDrive - prev.saturatorDrive) > 0.03 ||
      Math.abs(cur.filterResonance - prev.filterResonance) > 0.25 ||
      Math.abs(cur.reverbWet - prev.reverbWet) > 0.02
    );
  }

  /** Update the watched-params snapshot used by the smart router. */
  private ingestSmartInput(partial: Partial<AudioEngineParams>): void {
    if (typeof partial.filterCutoff === 'number')
      this.smartInput.filterCutoff = clamp(partial.filterCutoff, 50, 20000);
    if (typeof partial.filterResonance === 'number')
      this.smartInput.filterResonance = clamp(partial.filterResonance, 0, 20);
    if (typeof partial.saturatorDrive === 'number')
      this.smartInput.saturatorDrive = clamp(partial.saturatorDrive, 0.5, 3);
    if (typeof partial.reverbWet === 'number')
      this.smartInput.reverbWet = clamp(partial.reverbWet, 0, 1);
  }

  /**
   * Set the user-side timbre for a single voice (0..1). This is the value
   * the SettingsPanel "PAD/LEAD/BASS TIMBRE" knobs write to. The actual
   * value pushed to the CrossFade is `userTimbre + smartNudge(voice)`,
   * clamped to [0..1]. We re-run the router immediately so the change is
   * audible without waiting for the next setParams frame.
   */
  setVoiceTimbre(voice: VoiceKey, value: number): void {
    const v = clamp(value, 0, 1);
    this.userTimbre[voice] = v;
    this.applySmartRouter();
  }

  /** Read-only snapshot for tests and the SettingsPanel restore path. */
  getVoiceTimbre(voice: VoiceKey): number {
    return this.userTimbre[voice];
  }

  /** Read the smartVoicing flag. */
  getSmartVoicing(): boolean {
    return this.smartVoicing;
  }

  /**
   * Explicitly pick the A-side oscillator type for one of the three pitched
   * voices. This is the "real" waveform picker — independent of the morph
   * knob, which only crossfades A↔B. Re-uses the engine-level fade-down /
   * oscillator swap / fade-up path inside `applyVoiceShape`, so no audible
   * click even when a note is sustaining.
   *
   * Pre-init: caches the choice and returns. The next `applyVibeNow` or
   * preset-shape application would normally seed the engines from the vibe;
   * the user pick takes precedence post-init via the cache below.
   *
   * No-op for empty / non-string `type`. We deliberately do NOT validate
   * against `WAVEFORM_OPTION_IDS` here — the engines accept any
   * OmniOscillator literal at runtime and we'd rather let an experiment
   * succeed than guard against the dropdown contract drifting.
   */
  setVoiceWaveform(voice: VoiceKey, type: string): void {
    if (typeof type !== 'string' || type.length === 0) return;
    this.userWaveform[voice] = type;
    if (!this.pad || !this.lead || !this.bass) return;
    switch (voice) {
      case 'pad':
        this.pad.applyVoiceShape({ waveform: type });
        break;
      case 'lead':
        // Lead uses `oscType`, not `waveform`, per VoiceShape.
        this.lead.applyVoiceShape({ oscType: type });
        break;
      case 'bass':
        this.bass.applyVoiceShape({ waveform: type });
        break;
    }
  }

  /**
   * Read the currently-set waveform for a voice, or `null` if the user has
   * not made an explicit pick (i.e. the vibe / factory preset is in charge).
   * Used by the SettingsPanel to seed the dropdown.
   */
  getVoiceWaveform(voice: VoiceKey): string | null {
    return this.userWaveform[voice];
  }

  /**
   * Recompute each voice's effective timbre from user-set + smart nudge,
   * push to the CrossFade. Cheap — three multiplications + three rampTo
   * calls at most. Guarded by lastEffectiveTimbre so identical pushes are
   * dropped.
   */
  private applySmartRouter(): void {
    if (!this.pad && !this.lead && !this.bass) return;
    for (const v of ['pad', 'lead', 'bass'] as const) {
      const eff = clamp(
        this.userTimbre[v] +
          (this.smartVoicing ? computeSmartTimbre(v, this.smartInput) : 0),
        0,
        1,
      );
      const last = this.lastEffectiveTimbre[v];
      if (Number.isFinite(last) && Math.abs(eff - last) < 0.005) continue;
      this.lastEffectiveTimbre[v] = eff;
      // Defensive `typeof` guard: in tests the engine fields can be
      // partially mocked (a minimal lead stub may omit setTimbre). The
      // optional chain on the field doesn't help once the field is set —
      // we have to check the method exists too.
      switch (v) {
        case 'pad':
          if (this.pad && typeof this.pad.setTimbre === 'function')
            this.pad.setTimbre(eff);
          break;
        case 'lead':
          if (this.lead && typeof this.lead.setTimbre === 'function')
            this.lead.setTimbre(eff);
          break;
        case 'bass':
          if (this.bass && typeof this.bass.setTimbre === 'function')
            this.bass.setTimbre(eff);
          break;
      }
    }
  }

  /**
   * Fan a per-engine voice-shape overlay out to the three pitched voices.
   * Called by SettingsPanel.applyFactoryPreset after `setParams` so a factory
   * preset can carry its own *timbre* identity (oscillators + envelopes), not
   * just an FX-chain identity. Missing fields leave the engine alone — i.e.
   * preset INIT (no `voice` field) cleanly reverts to vibe defaults.
   *
   * If the shape carries a per-voice `timbre` field, also write through the
   * AudioEngine's userTimbre cache so the smart router and the knob mirrors
   * stay coherent.
   *
   * Pre-init: no-op (voices not yet built; the next preset click after init
   * will apply them).
   */
  applyVoiceShape(shape: VoiceShape | undefined): void {
    if (!shape) return;
    this.pad?.applyVoiceShape(shape.pad);
    this.lead?.applyVoiceShape(shape.lead);
    this.bass?.applyVoiceShape(shape.bass);
    // Cache the user-set timbre so subsequent smart-router passes use the
    // preset's baseline instead of stale 0.5 defaults.
    if (typeof shape.pad?.timbre === 'number')
      this.userTimbre.pad = clamp(shape.pad.timbre, 0, 1);
    if (typeof shape.lead?.timbre === 'number')
      this.userTimbre.lead = clamp(shape.lead.timbre, 0, 1);
    if (typeof shape.bass?.timbre === 'number')
      this.userTimbre.bass = clamp(shape.bass.timbre, 0, 1);
    // Mirror the preset's waveform into the user-pick cache so the
    // SettingsPanel dropdown reflects what's actually playing. A factory
    // preset is a one-shot full apply — clicking a chip overrides the user's
    // previous manual choice. Only the (rarer) per-voice waveform dropdown
    // path that calls setVoiceWaveform persists across preset clicks.
    if (typeof shape.pad?.waveform === 'string' && shape.pad.waveform.length > 0)
      this.userWaveform.pad = shape.pad.waveform;
    if (typeof shape.lead?.oscType === 'string' && shape.lead.oscType.length > 0)
      this.userWaveform.lead = shape.lead.oscType;
    if (typeof shape.bass?.waveform === 'string' && shape.bass.waveform.length > 0)
      this.userWaveform.bass = shape.bass.waveform;
    // Run the router so any smart nudges layered on the preset's timbre
    // are applied without waiting for the next gesture frame.
    this.applySmartRouter();
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
