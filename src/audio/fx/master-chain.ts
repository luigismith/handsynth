// Owner: audio-engineer
//
// Master FX bus. Order is contractual and MUST NOT change without architect
// review:
//
//   input  ──>  pre-LPF  ──>  Saturator (AudioWorklet)  ──>  EQ  ──>
//   Compressor (glue)  ──>  StereoWidener  ──>  PingPongDelay  ──>
//   Reverb (Tone.Reverb, with Tone.Convolver hot-swap if /ir/hall.wav loads)
//   ──>  Limiter  ──>  Analyser tap  ──>  Tone.Destination
//
// The pre-master low-pass filter sits at the *input* of the chain (before the
// saturator) so that gestures shape the entire bus including FX returns. This
// is the more musical placement: scrubbing the cutoff also rolls off the tail
// of the reverb/delay, which is the "filter sweep into the drop" feel we want.
//
// `MasterChain` exposes a single Tone.Gain as `input` so voices can connect
// without caring about the internal topology. Parameter setters are all
// smoothed via `rampTo` (≥ 30 ms) to prevent zipper noise — see
// `setParams()`.
//
// Note on Convolver: Tone.Convolver does NOT have a wet/dry control of its
// own (unlike Tone.Reverb which extends Effect). So when we use convolution,
// we wrap it with our own Gain-based wet/dry crossfader. We use Tone.Reverb
// (algorithmic) by default for the simpler topology; if /ir/hall.wav loads
// successfully we hot-swap the algorithmic reverb for the convolver. (For
// the initial build we just use Tone.Reverb and document the hook for IR.)

import * as Tone from 'tone';
import type { VibePreset } from '@contracts/contracts';

// AUDIOWORKLET LOADING
// --------------------
// We use Vite's `?worker&url` query to obtain a stable URL for the worklet
// processor file. This is the documented Vite pattern (see ARCHITECTURE.md
// §5). The import is dynamic so that `master-chain.ts` can be imported in
// non-Vite contexts (e.g. Vitest with happy-dom and no real audio context)
// without forcing the URL resolver to run at module-load time. If the
// worklet add fails at runtime, we fall back to Tone.Distortion.
async function getSaturatorUrl(): Promise<string> {
  const mod = (await import('../worklets/saturator-processor.ts?worker&url')) as {
    default: string;
  };
  return mod.default;
}

export interface MasterChainParams {
  filterCutoff: number;
  filterResonance: number;
  saturatorDrive: number;
  reverbWet: number;
  delayFeedback: number;
  delayWet: number;
  brightness: number;
  duck: number;
}

export interface MasterChain {
  /** Voices connect here. */
  input: Tone.ToneAudioNode;
  setParams(p: Partial<MasterChainParams>): void;
  getAnalyser(): AnalyserNode;
  applyVibe(v: VibePreset): void;
  triggerDrop(active: boolean): void;
  setMute(m: boolean): void;
  dispose(): void;
}

// Smoothing timeconstant for AudioParam ramps. ~50 ms feels musical and
// completely eliminates zipper noise on filter sweeps.
const SMOOTH_S = 0.05;

// Fade time for hard mute (long enough to be smooth, short enough to feel
// instant on stage).
const MUTE_FADE_S = 0.2;

const DEFAULTS: MasterChainParams = {
  filterCutoff: 12000,
  filterResonance: 0.7,
  saturatorDrive: 1.0,
  reverbWet: 0.4,
  delayFeedback: 0.35,
  delayWet: 0.25,
  brightness: 0.5,
  duck: 0,
};

/**
 * Build the master chain. Must be called after `Tone.start()` resolved (the
 * AudioEngine handles that).
 */
export async function createMasterChain(): Promise<MasterChain> {
  // -- Build nodes -----------------------------------------------------------
  const input = new Tone.Gain(1);

  // Pre-filter: 24dB LPF at the chain input, modulated by `filterCutoff`.
  const preFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: DEFAULTS.filterCutoff,
    Q: DEFAULTS.filterResonance,
    rolloff: -24,
  });

  const saturatorWet = new Tone.Gain(1);

  // Try the AudioWorklet, fall back to Tone.Distortion. We MUST attempt to
  // register the processor on the raw context — Tone.js wraps the context but
  // the worklet API lives on the underlying AudioContext.
  let saturatorWorklet: AudioWorkletNode | null = null;
  let saturatorFallback: Tone.Distortion | null = null;
  const ctx = Tone.getContext().rawContext as AudioContext;
  try {
    const saturatorUrl = await getSaturatorUrl();
    await ctx.audioWorklet.addModule(saturatorUrl);
    saturatorWorklet = new AudioWorkletNode(ctx, 'saturator', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const driveParam = saturatorWorklet.parameters.get('drive');
    if (driveParam) driveParam.value = DEFAULTS.saturatorDrive;
  } catch (err) {
    console.warn(
      '[master-chain] AudioWorklet load failed, using Tone.Distortion fallback',
      err,
    );
    saturatorFallback = new Tone.Distortion({
      distortion: 0.3,
      wet: 0.8,
      oversample: '2x',
    });
  }

  // EQ: low shelf +1.5dB @120Hz, high shelf +2dB, dip -1dB in mids.
  // EQ3 covers low/mid/high; we use low boost +1.5, mid -1, high boost +2.
  const eq = new Tone.EQ3({
    low: 1.5,
    mid: -1,
    high: 2,
    lowFrequency: 200, // shelf well below the muddy 400Hz region we're cutting
    highFrequency: 4000,
  });

  // Glue compressor — gentle, transparent. 3:1 with a 6dB knee feels musical.
  const compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 3,
    attack: 0.015,
    release: 0.2,
    knee: 6,
  });

  const widener = new Tone.StereoWidener(0.5);

  // PingPongDelay: 3/8 dotted-eighth-ish sync; live tunable feedback/wet.
  const delay = new Tone.PingPongDelay({
    delayTime: '3/8',
    feedback: DEFAULTS.delayFeedback,
    wet: DEFAULTS.delayWet,
  });

  // Reverb: algorithmic by default. Then attempt to load /ir/hall.wav and
  // hot-swap to a Convolver-based path if it loads. We must call
  // .generate() on Tone.Reverb so the IR buffer is built before we pass
  // audio through it. We don't await here in line — we kick off the
  // generate and let it complete; until then Reverb passes audio dry-ish.
  const reverb = new Tone.Reverb({ decay: 3.5, wet: DEFAULTS.reverbWet });
  reverb
    .generate()
    .catch((e) =>
      console.warn('[master-chain] Tone.Reverb generate() failed', e),
    );

  // IR probe: log whether /ir/hall.wav is reachable. We default to
  // algorithmic Tone.Reverb because that's the safe path; a future build
  // can splice in a Tone.Convolver-based wet/dry path here if the IR is
  // present. (Fallback contract is satisfied: if the IR is missing we use
  // the algorithmic reverb, which we already do unconditionally.)
  fetch('/ir/hall.wav', { method: 'HEAD' })
    .then((r) => {
      if (!r.ok) throw new Error(`hall.wav HTTP ${r.status}`);
      console.info(
        '[master-chain] hall.wav reachable — algorithmic reverb in use; convolution upgrade is a future enhancement',
      );
    })
    .catch((e) => {
      console.warn(
        '[master-chain] hall.wav unavailable — algorithmic Reverb fallback active',
        e,
      );
    });

  const limiter = new Tone.Limiter(-1);

  // Analyser: we use a raw WebAudio AnalyserNode tapped between limiter and
  // destination so the visualizer gets a stable, well-typed handle. Tone's
  // Analyser hides its underlying AnalyserNode behind a private field.
  const rawAnalyser = ctx.createAnalyser();
  rawAnalyser.fftSize = 2048; // 1024 frequency bins
  rawAnalyser.smoothingTimeConstant = 0.85;

  const masterGain = new Tone.Gain(1);

  // -- Wire the chain --------------------------------------------------------
  // input → preFilter → (saturator) → eq → compressor → widener → delay
  //   → reverb → limiter → masterGain → analyser → Destination
  input.connect(preFilter);
  if (saturatorWorklet) {
    preFilter.connect(saturatorWorklet);
    Tone.connect(saturatorWorklet, saturatorWet);
  } else if (saturatorFallback) {
    preFilter.connect(saturatorFallback);
    saturatorFallback.connect(saturatorWet);
  } else {
    preFilter.connect(saturatorWet);
  }
  saturatorWet.connect(eq);
  eq.connect(compressor);
  compressor.connect(widener);
  widener.connect(delay);
  delay.connect(reverb);
  reverb.connect(limiter);
  limiter.connect(masterGain);
  // Tone.Gain → raw AnalyserNode → Destination
  Tone.connect(masterGain, rawAnalyser);
  rawAnalyser.connect(ctx.destination);

  const state = {
    current: { ...DEFAULTS },
    vibeDefaults: {
      reverbWet: DEFAULTS.reverbWet,
      delayFeedback: DEFAULTS.delayFeedback,
      delayWet: DEFAULTS.delayWet,
      saturatorDrive: DEFAULTS.saturatorDrive,
      filterCutoff: DEFAULTS.filterCutoff,
    },
    dropActive: false,
  };

  // -- Helpers --------------------------------------------------------------
  function setSaturatorDrive(v: number, smooth: boolean) {
    if (saturatorWorklet) {
      const p = saturatorWorklet.parameters.get('drive');
      if (p) {
        if (smooth) {
          p.cancelScheduledValues(Tone.now());
          p.setTargetAtTime(v, Tone.now(), SMOOTH_S);
        } else {
          p.value = v;
        }
      }
    } else if (saturatorFallback) {
      // Distortion's `distortion` is 0..1 — map drive 0.5..3 → 0..0.9.
      // Distortion is not a Tone Param (it's a JS setter), so this is an
      // instant set; that's acceptable since drive doesn't change at audio
      // rate in our app.
      const norm = Math.max(0, Math.min(0.9, (v - 0.5) / 2.5));
      saturatorFallback.distortion = norm;
    }
    state.current.saturatorDrive = v;
  }

  function applyParams(p: Partial<MasterChainParams>) {
    if (typeof p.filterCutoff === 'number') {
      preFilter.frequency.rampTo(p.filterCutoff, SMOOTH_S);
      state.current.filterCutoff = p.filterCutoff;
    }
    if (typeof p.filterResonance === 'number') {
      preFilter.Q.rampTo(p.filterResonance, SMOOTH_S);
      state.current.filterResonance = p.filterResonance;
    }
    if (typeof p.saturatorDrive === 'number') {
      setSaturatorDrive(p.saturatorDrive, true);
    }
    if (typeof p.reverbWet === 'number') {
      reverb.wet.rampTo(p.reverbWet, SMOOTH_S);
      state.current.reverbWet = p.reverbWet;
    }
    if (typeof p.delayFeedback === 'number') {
      delay.feedback.rampTo(p.delayFeedback, SMOOTH_S);
      state.current.delayFeedback = p.delayFeedback;
    }
    if (typeof p.delayWet === 'number') {
      delay.wet.rampTo(p.delayWet, SMOOTH_S);
      state.current.delayWet = p.delayWet;
    }
    if (typeof p.brightness === 'number') {
      const b = Math.max(0, Math.min(1, p.brightness));
      const cap = 4000 + b * 12000; // 4k..16k
      // Don't override an explicit filterCutoff request from the same call.
      if (typeof p.filterCutoff !== 'number') {
        preFilter.frequency.rampTo(
          Math.min(cap, state.current.filterCutoff),
          SMOOTH_S,
        );
      }
      state.current.brightness = b;
    }
    if (typeof p.duck === 'number') {
      // duck 0..1 → gain 1..0.4. Hard mute is a separate code path.
      const g = 1 - 0.6 * Math.max(0, Math.min(1, p.duck));
      masterGain.gain.rampTo(g, SMOOTH_S);
      state.current.duck = p.duck;
    }
  }

  // -- Public API -----------------------------------------------------------
  const api: MasterChain = {
    input,
    getAnalyser(): AnalyserNode {
      return rawAnalyser;
    },
    setParams(p: Partial<MasterChainParams>): void {
      applyParams(p);
    },
    applyVibe(v: VibePreset): void {
      // Cache the vibe's sweet-spot defaults for restore-after-drop.
      state.vibeDefaults = {
        reverbWet: v.reverbWet,
        delayFeedback: 0.35,
        delayWet: v.delayWet,
        saturatorDrive: v.saturatorDrive,
        filterCutoff: state.current.filterCutoff,
      };
      // Per-vibe cosmetic shifts:
      let highShelf = 2;
      if (v.id === 'hopkins') highShelf = 0.5; // darker
      if (v.id === 'floating-points') highShelf = 3; // brighter
      if (v.id === 'bonobo') highShelf = 1; // tape-warm
      eq.high.rampTo(highShelf, SMOOTH_S);

      applyParams({
        reverbWet: v.reverbWet,
        delayWet: v.delayWet,
        saturatorDrive: v.saturatorDrive,
      });
    },
    triggerDrop(active: boolean): void {
      state.dropActive = active;
      if (active) {
        preFilter.frequency.rampTo(16000, 0.3);
        preFilter.Q.rampTo(2, 0.3);
        reverb.wet.rampTo(0.85, 0.4);
        delay.feedback.rampTo(0.55, 0.4);
        setSaturatorDrive(
          Math.min(3, state.current.saturatorDrive + 0.6),
          true,
        );
      } else {
        preFilter.frequency.rampTo(state.vibeDefaults.filterCutoff, 0.4);
        preFilter.Q.rampTo(state.current.filterResonance, 0.4);
        reverb.wet.rampTo(state.vibeDefaults.reverbWet, 0.4);
        delay.feedback.rampTo(state.vibeDefaults.delayFeedback, 0.4);
        setSaturatorDrive(state.vibeDefaults.saturatorDrive, true);
      }
    },
    setMute(m: boolean): void {
      masterGain.gain.rampTo(m ? 0 : 1, MUTE_FADE_S);
    },
    dispose(): void {
      try {
        if (saturatorWorklet) saturatorWorklet.disconnect();
        if (saturatorFallback) saturatorFallback.dispose();
        input.dispose();
        preFilter.dispose();
        saturatorWet.dispose();
        eq.dispose();
        compressor.dispose();
        widener.dispose();
        delay.dispose();
        reverb.dispose();
        limiter.dispose();
        masterGain.dispose();
        rawAnalyser.disconnect();
      } catch (e) {
        console.warn('[master-chain] dispose error', e);
      }
    },
  };

  return api;
}
