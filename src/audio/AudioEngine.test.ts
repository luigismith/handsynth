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
});
