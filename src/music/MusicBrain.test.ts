// Owner: music-brain
//
// Unit tests for harmony, generator, markov, and the MusicBrain orchestrator.
// Pure logic only — no Tone.js scheduling tested here (that's an integration
// concern owned by qa-listener).

import { describe, it, expect } from 'vitest';
import {
  getChordTones,
  getScale,
  isInScale,
  nearestChordTone,
  nearestScaleNote,
  normalizeChordSymbol,
  buildVoicing,
  noteMidi,
} from './harmony';
import { euclideanRhythm } from './euclidean';
import { buildDefaultMarkovTable, sampleNextDegree } from './markov';
import {
  createLeadState,
  createBassState,
  generateLeadNote,
  generateBassNote,
  buildPercPatterns,
  densityForIntensity,
} from './generator';

describe('harmony.getChordTones', () => {
  it('returns chord tones for F#maj9', () => {
    const tones = getChordTones('F#maj9');
    // F#maj9 = F#, A#, C#, E#, G#
    expect(tones).toEqual(expect.arrayContaining(['F#', 'A#', 'C#', 'E#', 'G#']));
  });

  it('handles vibe-preset spelling with stray space ("Bb maj7")', () => {
    expect(normalizeChordSymbol('Bb maj7')).toBe('Bbmaj7');
    const tones = getChordTones('Bb maj7');
    expect(tones).toEqual(expect.arrayContaining(['Bb', 'D', 'F', 'A']));
  });

  it('falls back to root for unknown symbols', () => {
    const tones = getChordTones('Ggarbage');
    expect(tones.length).toBeGreaterThan(0);
  });
});

describe('euclidean.euclideanRhythm', () => {
  it('E(4,16) shift 0 produces the canonical even-spaced kick pattern', () => {
    const expected = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    expect(euclideanRhythm(4, 16, 0)).toEqual(expected);
  });

  it('E(p,n) always yields exactly p pulses', () => {
    for (const [p, n] of [
      [3, 8],
      [5, 13],
      [11, 16],
      [7, 12],
    ] as const) {
      const pattern = euclideanRhythm(p, n, 0);
      expect(pattern.length).toBe(n);
      const count = pattern.filter(Boolean).length;
      expect(count).toBe(p);
    }
  });

  it('shift rotates the pattern', () => {
    const base = euclideanRhythm(3, 8, 0);
    const shifted = euclideanRhythm(3, 8, 1);
    // rotating right by 1 puts base[0] at shifted[1]
    expect(shifted[1]).toBe(base[0]);
  });

  it('handles edge cases', () => {
    expect(euclideanRhythm(0, 4, 0)).toEqual([false, false, false, false]);
    expect(euclideanRhythm(4, 4, 0)).toEqual([true, true, true, true]);
  });
});

describe('harmony.nearestChordTone', () => {
  it('returns a chord tone of F#maj9', () => {
    const result = nearestChordTone('B4', 'F#maj9');
    const tones = getChordTones('F#maj9');
    const pc = result.replace(/-?\d+$/, '');
    expect(tones).toContain(pc);
  });

  it('does not move much for an in-chord note', () => {
    const result = nearestChordTone('C#4', 'F#maj9');
    const dist = Math.abs(noteMidi(result) - noteMidi('C#4'));
    expect(dist).toBeLessThanOrEqual(2);
  });
});

describe('harmony.nearestScaleNote (fuzz)', () => {
  it('always returns an in-scale note for random inputs', () => {
    const scale = getScale('F#', 'lydian');
    const seed = 42;
    let s = seed;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 100; i++) {
      const midi = 36 + Math.floor(rng() * 60);
      // Construct a candidate note via Tone-style spelling.
      const noteName = midiToSpelling(midi);
      const result = nearestScaleNote(noteName, scale);
      expect(isInScale(result, scale)).toBe(true);
    }
  });
});

describe('harmony.buildVoicing', () => {
  it('returns a non-empty voicing for the four vibe progressions', () => {
    const symbols = [
      'F#maj9', 'Eadd9', 'B6/9', 'C#sus2',
      'Dm9', 'Gmaj7', 'Cmaj9', 'Am11',
      'Am', 'Bbmaj7', 'Fmaj7', 'Em7',
      'Cmaj7', 'Bbmaj7', 'F/A', 'Gm9',
    ];
    for (const sym of symbols) {
      const v = buildVoicing(sym, { register: 'mid', voicingStyle: 'drop2' });
      expect(v.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('quartal voicing spreads each note at least a fourth apart', () => {
    const v = buildVoicing('Cmaj7', { register: 'mid', voicingStyle: 'quartal' });
    expect(v.length).toBeGreaterThan(1);
    for (let i = 1; i < v.length; i++) {
      const a = v[i - 1];
      const b = v[i];
      if (a && b) {
        const dist = noteMidi(b) - noteMidi(a);
        expect(dist).toBeGreaterThanOrEqual(5);
      }
    }
  });
});

describe('markov', () => {
  it('table has 7×7×7 weights, all positive', () => {
    const table = buildDefaultMarkovTable();
    expect(table.weights.length).toBe(7);
    for (const prev of table.weights) {
      expect(prev.length).toBe(7);
      for (const curr of prev) {
        expect(curr.length).toBe(7);
        for (const w of curr) expect(w).toBeGreaterThan(0);
      }
    }
  });

  it('sampleNextDegree returns a degree in 1..7', () => {
    const table = buildDefaultMarkovTable();
    const rng = () => 0.5;
    const next = sampleNextDegree(table, 1, 1, rng);
    expect(next).toBeGreaterThanOrEqual(1);
    expect(next).toBeLessThanOrEqual(7);
  });
});

describe('generator', () => {
  it('densityForIntensity buckets correctly', () => {
    expect(densityForIntensity(0)).toBe(1);
    expect(densityForIntensity(0.2)).toBe(1);
    expect(densityForIntensity(0.5)).toBe(2);
    expect(densityForIntensity(0.8)).toBe(4);
    expect(densityForIntensity(1)).toBe(4);
  });

  it('lead generator emits in-scale or chord-tone notes', () => {
    const scale = getScale('F#', 'lydian');
    const lead = createLeadState(scale, 'F#maj9', 4, makeSeededRng(7));
    lead.intensity = 1; // force full subdivision
    const tones = getChordTones('F#maj9');
    let emitted = 0;
    for (let step = 0; step < 16; step++) {
      const ev = generateLeadNote(lead, Math.floor(step / 4), step, step * 0.1);
      if (ev) {
        emitted++;
        const pc = ev.pitch.replace(/-?\d+$/, '');
        // Either in scale OR a chord tone — the harmonic filter snaps
        // out-of-scale notes back.
        const okScale = scale.notes.includes(pc);
        const okChord = tones.includes(pc);
        expect(okScale || okChord).toBe(true);
      }
    }
    expect(emitted).toBeGreaterThan(0);
  });

  it('bass generator hits the root on the downbeat', () => {
    const tones = getChordTones('Dm9');
    const bass = createBassState('Dm9', tones, 2, makeSeededRng(3));
    const ev = generateBassNote(bass, 0, 0);
    expect(ev).not.toBeNull();
    const pc = ev!.pitch.replace(/-?\d+$/, '');
    expect(pc).toBe('D');
  });

  it('buildPercPatterns scales with intensity', () => {
    const lo = buildPercPatterns(0.1);
    const hi = buildPercPatterns(0.9);
    const count = (arr: boolean[]) => arr.filter(Boolean).length;
    expect(count(lo.kick)).toBeLessThan(count(hi.kick));
    expect(count(lo.hat)).toBeLessThan(count(hi.hat));
    expect(count(lo.perc)).toBeLessThan(count(hi.perc));
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function midiToSpelling(midi: number): string {
  const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const oct = Math.floor(midi / 12) - 1;
  const pc = PCS[midi % 12];
  return `${pc}${oct}`;
}
