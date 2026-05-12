// Unit tests for calibration storage + schema validation.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadCalibration,
  saveCalibration,
  clearCalibration,
  isCalibrationProfile,
} from './store';
import {
  CALIBRATION_STORAGE_KEY,
  DEFAULT_CALIBRATION,
  makeRemap,
  type CalibrationProfile,
} from './types';

function freshProfile(): CalibrationProfile {
  return {
    version: 1,
    completedAt: 1700000000000,
    videoWidth: 1280,
    videoHeight: 720,
    handY: { min: 0.2, max: 0.85 },
    handX: { min: 0.1, max: 0.9 },
    meanDepth: { min: 0.3, max: 0.75 },
    openness: { min: 0.18, max: 0.92 },
    handsDistance3D: { min: 0.05, max: 0.8 },
    tutorialCompleted: true,
  };
}

describe('CalibrationStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when no profile is stored', () => {
    expect(loadCalibration()).toBeNull();
  });

  it('saves and reloads a valid profile (round trip)', () => {
    const profile = freshProfile();
    expect(saveCalibration(profile)).toBe(true);
    const loaded = loadCalibration();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(profile);
  });

  it('rejects a malformed payload as null', () => {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, '{not-json');
    expect(loadCalibration()).toBeNull();
  });

  it('rejects a v2 (unknown future version) profile as null', () => {
    const future = { ...freshProfile(), version: 2 };
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(future));
    expect(loadCalibration()).toBeNull();
  });

  it('rejects a profile missing a range field', () => {
    const partial = { ...freshProfile() } as Record<string, unknown>;
    delete partial.openness;
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(partial));
    expect(loadCalibration()).toBeNull();
  });

  it('rejects a profile whose range has non-finite endpoints', () => {
    const bad = freshProfile();
    bad.openness = { min: Number.NaN, max: 0.9 };
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(bad));
    expect(loadCalibration()).toBeNull();
  });

  it('clearCalibration() wipes the entry so the next load is null', () => {
    saveCalibration(freshProfile());
    expect(loadCalibration()).not.toBeNull();
    clearCalibration();
    expect(loadCalibration()).toBeNull();
  });

  it('isCalibrationProfile validates the schema', () => {
    expect(isCalibrationProfile(freshProfile())).toBe(true);
    expect(isCalibrationProfile(null)).toBe(false);
    expect(isCalibrationProfile('not an object')).toBe(false);
    expect(isCalibrationProfile({ ...freshProfile(), tutorialCompleted: 1 })).toBe(false);
  });
});

describe('makeRemap', () => {
  it('stretches a sub-range onto the full 0..1', () => {
    const fn = makeRemap({ min: 0.2, max: 0.8 });
    // Endpoints map to 0 and 1.
    expect(fn(0.2)).toBeCloseTo(0, 5);
    expect(fn(0.8)).toBeCloseTo(1, 5);
    // Midpoint of the input range maps to ~0.5 output.
    expect(fn(0.5)).toBeCloseTo(0.5, 5);
  });

  it('clamps below the observed min to 0', () => {
    const fn = makeRemap({ min: 0.3, max: 0.7 });
    expect(fn(0)).toBe(0);
    expect(fn(-2)).toBe(0);
  });

  it('clamps above the observed max to 1', () => {
    const fn = makeRemap({ min: 0.3, max: 0.7 });
    expect(fn(1)).toBe(1);
    expect(fn(99)).toBe(1);
  });

  it('falls back to identity when range span is degenerate', () => {
    // span 0.01 < MIN_RANGE_SPAN (0.15) → identity
    const fn = makeRemap({ min: 0.45, max: 0.46 });
    expect(fn(0.7)).toBe(0.7);
    expect(fn(0.1)).toBe(0.1);
  });

  it('falls back to identity when range endpoints are non-finite', () => {
    const fn = makeRemap({ min: Number.NaN, max: 0.8 });
    expect(fn(0.5)).toBe(0.5);
  });

  it('DEFAULT_CALIBRATION remap is identity (sanity check)', () => {
    const fn = makeRemap(DEFAULT_CALIBRATION.handY);
    expect(fn(0)).toBeCloseTo(0, 5);
    expect(fn(0.5)).toBeCloseTo(0.5, 5);
    expect(fn(1)).toBeCloseTo(1, 5);
  });
});
