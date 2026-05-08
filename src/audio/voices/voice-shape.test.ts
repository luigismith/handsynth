// Owner: audio-engineer
//
// Unit tests for the per-voice `applyVoiceShape` methods. We mock Tone.js
// rather than relying on a real AudioContext (happy-dom doesn't expose one
// cleanly enough for Tone) — each engine instantiation goes through fake
// PolySynth / MonoSynth / Filter / LFO / Gain / Vibrato classes that record
// the .set() calls so we can assert on them.
//
// The mocks are intentionally minimal: only the surface the engines touch
// is implemented. If an engine grows new Tone calls we'll update mocks here.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VoiceShape } from '../voice-shape';

// ---------------------------------------------------------------------------
// Tone.js mock — captures .set() calls and constructor args on each instance.
// ---------------------------------------------------------------------------

interface SetSpy {
  setCalls: unknown[];
  set: (opts: unknown) => void;
}

function makeSetSpy(): SetSpy {
  const setCalls: unknown[] = [];
  return {
    setCalls,
    set(opts: unknown) {
      setCalls.push(opts);
    },
  };
}

vi.mock('tone', () => {
  // Each instance of these is a SetSpy with whatever extra fields we need.
  class PolySynth {
    setCalls: unknown[] = [];
    constructor(_voice?: unknown, _opts?: unknown) {
      const s = makeSetSpy();
      this.setCalls = s.setCalls;
    }
    set(opts: unknown): void {
      this.setCalls.push(opts);
    }
    connect(_: unknown): void {}
    triggerAttackRelease(): void {}
    dispose(): void {}
  }
  class Synth {}
  class MonoSynth {
    setCalls: unknown[] = [];
    volume = {
      _value: 0,
      rampTo(v: number): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any)._value = v;
      },
    };
    constructor(_opts?: unknown) {
      const s = makeSetSpy();
      this.setCalls = s.setCalls;
    }
    set(opts: unknown): void {
      this.setCalls.push(opts);
    }
    connect(_: unknown): void {}
    triggerAttackRelease(): void {}
    dispose(): void {}
  }
  class Filter {
    frequency = { rampTo: (_v: number) => {} };
    constructor(_opts?: unknown) {}
    connect(_: unknown): void {}
    dispose(): void {}
  }
  class LFO {
    frequency = { rampTo: (_v: number) => {} };
    constructor(_opts?: unknown) {}
    start(): this {
      return this;
    }
    stop(): void {}
    connect(_: unknown): void {}
    dispose(): void {}
  }
  class Gain {
    constructor(_v?: unknown) {}
    connect(_: unknown): void {}
    dispose(): void {}
  }
  class Vibrato {
    frequency = { rampTo: (_v: number) => {} };
    depth = { rampTo: (_v: number) => {} };
    constructor(_opts?: unknown) {}
    connect(_: unknown): void {}
    dispose(): void {}
  }
  function connect(_a: unknown, _b: unknown): void {}
  function now(): number {
    return 0;
  }
  function Frequency(n: string) {
    return {
      transpose: () => ({ toNote: () => n }),
    };
  }
  return {
    PolySynth,
    Synth,
    MonoSynth,
    Filter,
    LFO,
    Gain,
    Vibrato,
    connect,
    now,
    Frequency,
  };
});

// Imports MUST come after vi.mock so they pick up the mocked Tone.
import { PadEngine } from './PadEngine';
import { LeadEngine } from './LeadEngine';
import { BassEngine } from './BassEngine';

// ---------------------------------------------------------------------------
// Helper: deep search a recorded set() opts arg for a given key/value pair.
// ---------------------------------------------------------------------------

function findKey(calls: unknown[], path: string[]): unknown[] {
  const found: unknown[] = [];
  for (const c of calls) {
    let cur: unknown = c;
    let ok = true;
    for (const p of path) {
      if (typeof cur === 'object' && cur !== null && p in cur) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        ok = false;
        break;
      }
    }
    if (ok) found.push(cur);
  }
  return found;
}

// ---------------------------------------------------------------------------
// PadEngine tests
// ---------------------------------------------------------------------------

describe('PadEngine.applyVoiceShape', () => {
  let pad: PadEngine;

  beforeEach(() => {
    pad = new PadEngine({} as never);
  });

  it('is a no-op when shape is undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (pad as any).layerA as { setCalls: unknown[] };
    const before = a.setCalls.length;
    pad.applyVoiceShape(undefined);
    expect(a.setCalls.length).toBe(before);
  });

  it('sets oscillator type on both layers when waveform set', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (pad as any).layerA as { setCalls: unknown[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (pad as any).layerB as { setCalls: unknown[] };
    pad.applyVoiceShape({ waveform: 'fmsine' });
    const aTypes = findKey(a.setCalls, ['oscillator', 'type']);
    const bTypes = findKey(b.setCalls, ['oscillator', 'type']);
    expect(aTypes).toContain('fmsine');
    expect(bTypes).toContain('fmsine');
  });

  it('splits detuneCents ±half between the two layers', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (pad as any).layerA as { setCalls: unknown[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (pad as any).layerB as { setCalls: unknown[] };
    pad.applyVoiceShape({ detuneCents: 24 });
    const aDet = findKey(a.setCalls, ['detune']) as number[];
    const bDet = findKey(b.setCalls, ['detune']) as number[];
    expect(aDet.at(-1)).toBe(12);
    expect(bDet.at(-1)).toBe(-12);
  });

  it('clamps detuneCents to the [2..40] band', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (pad as any).layerA as { setCalls: unknown[] };
    pad.applyVoiceShape({ detuneCents: 200 });
    const last = (findKey(a.setCalls, ['detune']) as number[]).at(-1)!;
    expect(last).toBe(20); // 40 / 2
  });

  it('forwards attack and release into the envelope', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (pad as any).layerA as { setCalls: unknown[] };
    pad.applyVoiceShape({ attack: 1.5, release: 4 });
    const env = findKey(a.setCalls, ['envelope']);
    expect(env).toEqual(
      expect.arrayContaining([{ attack: 1.5 }, { release: 4 }]),
    );
  });
});

// ---------------------------------------------------------------------------
// LeadEngine tests
// ---------------------------------------------------------------------------

describe('LeadEngine.applyVoiceShape', () => {
  let lead: LeadEngine;

  beforeEach(() => {
    lead = new LeadEngine({} as never);
  });

  it('is a no-op when shape is undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (lead as any).mono as { setCalls: unknown[] };
    const before = m.setCalls.length;
    lead.applyVoiceShape(undefined);
    expect(m.setCalls.length).toBe(before);
  });

  it('sets oscType, modIndex and harmonicity', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (lead as any).mono as { setCalls: unknown[] };
    lead.applyVoiceShape({ oscType: 'fmsawtooth', modIndex: 12, harmonicity: 2 });
    expect(findKey(m.setCalls, ['oscillator', 'type'])).toContain('fmsawtooth');
    expect(findKey(m.setCalls, ['oscillator', 'modulationIndex'])).toContain(12);
    expect(findKey(m.setCalls, ['oscillator', 'harmonicity'])).toContain(2);
  });

  it('clamps modIndex to [0..20]', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (lead as any).mono as { setCalls: unknown[] };
    lead.applyVoiceShape({ modIndex: 999 });
    const idx = findKey(m.setCalls, ['oscillator', 'modulationIndex']) as number[];
    expect(idx.at(-1)).toBe(20);
  });

  it('forwards attack and release', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (lead as any).mono as { setCalls: unknown[] };
    lead.applyVoiceShape({ attack: 0.4, release: 2.5 });
    expect(findKey(m.setCalls, ['envelope', 'attack'])).toContain(0.4);
    expect(findKey(m.setCalls, ['envelope', 'release'])).toContain(2.5);
  });
});

// ---------------------------------------------------------------------------
// BassEngine tests
// ---------------------------------------------------------------------------

describe('BassEngine.applyVoiceShape', () => {
  let bass: BassEngine;

  beforeEach(() => {
    bass = new BassEngine({} as never);
  });

  it('is a no-op when shape is undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const main = (bass as any).main as { setCalls: unknown[] };
    const before = main.setCalls.length;
    bass.applyVoiceShape(undefined);
    expect(main.setCalls.length).toBe(before);
  });

  it('sets the main oscillator waveform', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const main = (bass as any).main as { setCalls: unknown[] };
    bass.applyVoiceShape({ waveform: 'fatsawtooth' });
    expect(findKey(main.setCalls, ['oscillator', 'type'])).toContain('fatsawtooth');
  });

  it('subLevel=1 ramps sub to 0 dB; subLevel=0 ramps to -Infinity', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (bass as any).sub as { volume: { _value: number } };
    bass.applyVoiceShape({ subLevel: 1 });
    expect(sub.volume._value).toBe(0);
    bass.applyVoiceShape({ subLevel: 0 });
    expect(sub.volume._value).toBe(-Infinity);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((bass as any).subEnabled).toBe(false);
  });

  it('mid subLevel maps to a finite negative dB value', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (bass as any).sub as { volume: { _value: number } };
    bass.applyVoiceShape({ subLevel: 0.5 });
    expect(sub.volume._value).toBeLessThan(0);
    expect(Number.isFinite(sub.volume._value)).toBe(true);
    // 24 * log10(0.5) ≈ -7.22
    expect(sub.volume._value).toBeCloseTo(-7.224, 1);
  });
});

// ---------------------------------------------------------------------------
// Factory-preset uniqueness — smoke test that every preset's voice config is
// distinct. Without this, regressions silently re-introduce the original
// "tutti uguali" complaint.
// ---------------------------------------------------------------------------

describe('factory-presets uniqueness', () => {
  it('every non-INIT preset has a voice and they are pairwise distinct', async () => {
    const { FACTORY_PRESETS } = await import('@presets/factory-presets');
    const fingerprints = new Map<string, string>();
    for (const p of FACTORY_PRESETS) {
      if (p.id === 'init') {
        // INIT intentionally has no voice — that's the contract.
        expect(p.voice).toBeUndefined();
        continue;
      }
      expect(p.voice).toBeDefined();
      const fp = JSON.stringify(p.voice);
      if (fingerprints.has(fp)) {
        throw new Error(
          `Preset "${p.id}" has same voice fingerprint as "${fingerprints.get(fp)}"`,
        );
      }
      fingerprints.set(fp, p.id);
    }
    // We expect 7 unique fingerprints (all presets except INIT).
    expect(fingerprints.size).toBe(FACTORY_PRESETS.length - 1);
  });
});

// Make `VoiceShape` reference resolve so importing it in the test contributes
// to coverage of the module surface.
const _shapeProbe: VoiceShape = {
  pad: { waveform: 'sine', detuneCents: 4, attack: 0.1, release: 1 },
  lead: { oscType: 'sine', modIndex: 0, harmonicity: 1, attack: 0.01, release: 0.5 },
  bass: { waveform: 'sine', subLevel: 0.5 },
};
void _shapeProbe;
