// Owner: visualizer
//
// Unit tests for the ADSR envelope used by beat-driven visual effects. The
// envelope is pure JS (no DOM, no canvas) so we can test it precisely.

import { describe, it, expect } from 'vitest';
import { createEnvelope } from './envelope';

describe('createEnvelope', () => {
  it('starts idle at zero', () => {
    const env = createEnvelope();
    expect(env.value).toBe(0);
    expect(env.active()).toBe(false);
  });

  it('rises during attack toward peak', () => {
    const env = createEnvelope({ attack: 0.030, decay: 0.200, release: 0.100 });
    env.trigger(1.0);
    // After 15ms (half of attack), value should be ~0.5.
    env.step(0.015);
    expect(env.value).toBeGreaterThan(0.3);
    expect(env.value).toBeLessThan(0.7);
  });

  it('reaches peak at end of attack', () => {
    const env = createEnvelope({ attack: 0.030, decay: 0.200, release: 0.100 });
    env.trigger(1.0);
    env.step(0.030);
    // Allow tiny rounding slop; should be at or very close to 1.
    expect(env.value).toBeGreaterThan(0.95);
  });

  it('decays after attack toward floor', () => {
    const env = createEnvelope({ attack: 0.010, decay: 0.100, release: 0.050 });
    env.trigger(1.0);
    env.step(0.010); // finish attack
    env.step(0.050); // halfway through decay
    expect(env.value).toBeLessThan(0.7); // dropped below peak
    expect(env.value).toBeGreaterThan(0.2);
  });

  it('eventually returns to idle', () => {
    const env = createEnvelope({ attack: 0.005, decay: 0.020, release: 0.010 });
    env.trigger(1.0);
    // Step way past the total envelope duration.
    for (let i = 0; i < 100; i += 1) env.step(0.01);
    expect(env.value).toBe(0);
    expect(env.active()).toBe(false);
  });

  it('re-triggering ramps from current value, not from zero', () => {
    const env = createEnvelope({ attack: 0.030, decay: 0.300, release: 0.100 });
    env.trigger(1.0);
    env.step(0.030);
    env.step(0.100);
    const midDecayValue = env.value;
    expect(midDecayValue).toBeLessThan(1);
    expect(midDecayValue).toBeGreaterThan(0);

    // Re-trigger; first attack step should not jump down to zero.
    env.trigger(1.0);
    env.step(0.001);
    // Value should still be near where it was (slightly higher into a new
    // attack ramp), definitely not collapsed to ~0.
    expect(env.value).toBeGreaterThan(midDecayValue * 0.8);
  });

  it('respects custom peak in trigger()', () => {
    const env = createEnvelope({ attack: 0.005, decay: 0.500, release: 0.100 });
    env.trigger(0.5);
    env.step(0.005);
    expect(env.value).toBeLessThanOrEqual(0.5 + 1e-3);
    expect(env.value).toBeGreaterThan(0.4);
  });
});
