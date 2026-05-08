// Owner: music-brain
//
// Targeted tests for the scale-options surface area. The bulk of harmony's
// behaviour is exercised in MusicBrain.test.ts; here we cover the curated
// scale list specifically — every id we expose to the UI must resolve to a
// non-empty Scale via tonal so the dropdown can never produce a silent or
// wrong-octave brain.

import { describe, it, expect } from 'vitest';
import { getScale, isInScale } from './harmony';
import { SCALE_OPTIONS, SCALE_OPTION_IDS, scaleDisplayName } from '@presets/scale-options';
import { KEY_OPTIONS, KEY_OPTION_IDS, normalizeKeyId } from '@presets/key-options';

describe('SCALE_OPTIONS — every id resolves to a valid scale', () => {
  it('walks the full list and asserts 5–12 distinct notes', () => {
    for (const opt of SCALE_OPTIONS) {
      // Cross every scale with a couple of tonics to make sure the id
      // works regardless of root spelling.
      for (const tonic of ['C', 'F#', 'Bb']) {
        const s = getScale(tonic, opt.id);
        expect(s.tonic).toBe(tonic);
        expect(s.mode).toBe(opt.id);
        expect(s.notes.length).toBeGreaterThanOrEqual(5);
        expect(s.notes.length).toBeLessThanOrEqual(12);
        // chromaSet must be non-empty, exactly one chroma per spelled note.
        expect(s.chromaSet.size).toBe(new Set(s.notes.map((n) => n.replace(/-?\d+$/, ''))).size);
      }
    }
  });

  it('display names are unique and non-empty', () => {
    const names = SCALE_OPTIONS.map((s) => s.displayName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
  });

  it('SCALE_OPTION_IDS reflects the list exactly', () => {
    expect(SCALE_OPTION_IDS.size).toBe(SCALE_OPTIONS.length);
    for (const opt of SCALE_OPTIONS) expect(SCALE_OPTION_IDS.has(opt.id)).toBe(true);
  });

  it('scaleDisplayName falls back to the id', () => {
    expect(scaleDisplayName('major')).toBe('Major (Ionian)');
    expect(scaleDisplayName('not-a-mode')).toBe('not-a-mode');
  });

  it('scale notes report as in-scale', () => {
    // Spot-check: every note in the C major scale should be in-scale.
    const s = getScale('C', 'major');
    for (const n of s.notes) expect(isInScale(n, s)).toBe(true);
    // And a known out-of-scale note for C major (Eb) must not be.
    expect(isInScale('Eb', s)).toBe(false);
  });
});

describe('KEY_OPTIONS', () => {
  it('contains exactly 12 chromatic ids', () => {
    expect(KEY_OPTIONS.length).toBe(12);
    const ids = KEY_OPTIONS.map((k) => k.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('every id is a valid tonal pitch class (yields a non-empty scale)', () => {
    for (const k of KEY_OPTIONS) {
      const s = getScale(k.id, 'major');
      expect(s.notes.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('KEY_OPTION_IDS is the canonical set', () => {
    for (const k of KEY_OPTIONS) expect(KEY_OPTION_IDS.has(k.id)).toBe(true);
    expect(KEY_OPTION_IDS.has('Bb')).toBe(false); // flats are not canonical ids
  });

  it('normalizeKeyId maps flats to their sharp equivalent', () => {
    expect(normalizeKeyId('Bb')).toBe('A#');
    expect(normalizeKeyId('Eb')).toBe('D#');
    expect(normalizeKeyId('Db')).toBe('C#');
    expect(normalizeKeyId('Gb')).toBe('F#');
    expect(normalizeKeyId('Ab')).toBe('G#');
  });

  it('normalizeKeyId is idempotent on already-canonical ids', () => {
    for (const k of KEY_OPTIONS) {
      expect(normalizeKeyId(k.id)).toBe(k.id);
    }
  });

  it('normalizeKeyId strips trailing octaves before mapping', () => {
    expect(normalizeKeyId('Bb4')).toBe('A#');
    expect(normalizeKeyId('C4')).toBe('C');
  });
});
