// Owner: audio-engineer
//
// Smoke tests for the AudioEngine. Tone.js requires a real AudioContext to
// fully initialize, which `happy-dom` doesn't provide. Rather than stub all of
// Tone.js, we assert the engine class shape, defaults, and that calling
// trigger methods before init() doesn't throw (no-op safety).
//
// qa-listener owns the deeper integration tests; these are just safety nets
// against the most obvious regressions inside `src/audio/`.

import { describe, it, expect } from 'vitest';
import { AudioEngineImpl } from './AudioEngine';
import { FACTORY_PRESETS } from '@presets/factory-presets';

describe('AudioEngineImpl (smoke)', () => {
  it('exports a constructable class', () => {
    expect(typeof AudioEngineImpl).toBe('function');
    const eng = new AudioEngineImpl();
    expect(eng).toBeInstanceOf(AudioEngineImpl);
  });

  it('reports not-ready before init()', () => {
    const eng = new AudioEngineImpl();
    expect(eng.isReady()).toBe(false);
  });

  it('returns the same promise for repeated init() calls (idempotency)', () => {
    const eng = new AudioEngineImpl();
    // We don't await — happy-dom can't run a real audio context, but the
    // promise references should be identical regardless of whether they
    // resolve.
    const p1 = eng.init();
    const p2 = eng.init();
    expect(p1).toBe(p2);
    // Swallow rejection so the test runner doesn't flag unhandled rejection.
    p1.catch(() => undefined);
  });

  it('setParams does not throw on extreme or partial values pre-init', () => {
    const eng = new AudioEngineImpl();
    expect(() => eng.setParams({ filterCutoff: 1e9 })).not.toThrow();
    expect(() => eng.setParams({ filterCutoff: -1 })).not.toThrow();
    expect(() => eng.setParams({ saturatorDrive: 100 })).not.toThrow();
    expect(() => eng.setParams({ masterDuck: -5 })).not.toThrow();
    expect(() => eng.setParams({})).not.toThrow();
  });

  it('trigger methods are no-ops pre-init (do not throw)', () => {
    const eng = new AudioEngineImpl();
    expect(() => eng.triggerKick()).not.toThrow();
    expect(() => eng.triggerHat()).not.toThrow();
    expect(() => eng.triggerPerc()).not.toThrow();
    expect(() => eng.triggerStab()).not.toThrow();
    expect(() =>
      eng.triggerLead({
        pitch: 'C4',
        duration: '8n',
        velocity: 0.8,
        time: 0,
      }),
    ).not.toThrow();
    expect(() =>
      eng.triggerBass({
        pitch: 'C2',
        duration: '4n',
        velocity: 0.8,
        time: 0,
      }),
    ).not.toThrow();
    expect(() =>
      eng.triggerChord({
        notes: ['C4', 'E4', 'G4'],
        duration: '2n',
        time: 0,
      }),
    ).not.toThrow();
    expect(() => eng.setMute(true)).not.toThrow();
    expect(() => eng.setMute(false)).not.toThrow();
    expect(() => eng.triggerDrop(true)).not.toThrow();
    expect(() => eng.triggerDrop(false)).not.toThrow();
  });

  it('exposes applyVoiceShape and is a no-op pre-init', () => {
    const eng = new AudioEngineImpl();
    expect(typeof eng.applyVoiceShape).toBe('function');
    // Should not throw before init() (voices are null) for any input shape.
    expect(() => eng.applyVoiceShape(undefined)).not.toThrow();
    expect(() => eng.applyVoiceShape({})).not.toThrow();
    expect(() =>
      eng.applyVoiceShape({
        pad: { waveform: 'fmsine', detuneCents: 24, attack: 1, release: 3 },
        lead: { oscType: 'fmsawtooth', modIndex: 8, harmonicity: 2 },
        bass: { waveform: 'fatsquare', subLevel: 0.5 },
      }),
    ).not.toThrow();
  });

  it('applyVoiceShape(undefined) does not crash the impl', () => {
    const eng = new AudioEngineImpl();
    expect(() => eng.applyVoiceShape(undefined)).not.toThrow();
  });

  it('every non-INIT factory preset ships a distinct voice shape', () => {
    // Regression guard for the "i preset sembrano tutti uguali" complaint:
    // if two presets ever end up with byte-identical `voice` blobs they
    // would also be sonically indistinguishable, defeating the feature.
    const seen = new Map<string, string>();
    for (const p of FACTORY_PRESETS) {
      if (p.id === 'init') continue;
      expect(p.voice).toBeDefined();
      const fp = JSON.stringify(p.voice);
      expect(seen.has(fp)).toBe(false);
      seen.set(fp, p.id);
    }
    expect(seen.size).toBe(FACTORY_PRESETS.length - 1);
  });

  it('INIT preset intentionally has no voice override', () => {
    const init = FACTORY_PRESETS.find((p) => p.id === 'init');
    expect(init).toBeDefined();
    expect(init?.voice).toBeUndefined();
  });

  it('applyVoiceShape accepts every factory preset voice without throwing', () => {
    const eng = new AudioEngineImpl();
    for (const p of FACTORY_PRESETS) {
      expect(() => eng.applyVoiceShape(p.voice)).not.toThrow();
    }
  });

  // Regression: brightness fan-out to the lead voice is gated by a wider
  // epsilon than the master ε. Without this gate, every gesture frame that
  // moves the master brightness by ≥0.005 also reschedules the lead's
  // filterEnvelope and bp.frequency.rampTo — adding two scheduler entries
  // per frame for sub-perceptual lead deltas. The fix lets sub-0.02 deltas
  // reach the master only.
  it('setParams: lead.setBrightness is NOT called for sub-ε deltas', () => {
    const eng = new AudioEngineImpl();
    const leadCalls: number[] = [];
    const masterParams: Array<Record<string, number>> = [];
    // Inject minimal stand-ins for lead + master so setParams runs through
    // the brightness gate without booting Tone.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (eng as any).lead = {
      setBrightness: (v: number) => {
        leadCalls.push(v);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (eng as any).master = {
      setParams: (p: Record<string, number>) => {
        masterParams.push({ ...p });
      },
    };

    // First call always lands.
    eng.setParams({ brightness: 0.5 });
    // Tiny nudge — master should still see it (gated upstream by mapper),
    // but lead should NOT.
    eng.setParams({ brightness: 0.505 });
    eng.setParams({ brightness: 0.51 });
    eng.setParams({ brightness: 0.515 });
    // A clearly audible jump (>0.02) should reach the lead.
    eng.setParams({ brightness: 0.6 });

    expect(leadCalls).toEqual([0.5, 0.6]);
    // Master sees every brightness push (its own ε is the mapper's job).
    const masterBrights = masterParams
      .map((m) => m.brightness)
      .filter((v): v is number => typeof v === 'number');
    expect(masterBrights.length).toBe(5);
  });
});
