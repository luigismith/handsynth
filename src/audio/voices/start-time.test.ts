import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake audio clock: currentTime + a 0.4 s look-ahead, like AudioEngine.
const clock = { current: 10, lookAhead: 0.4 };
vi.mock('tone', () => ({
  now: () => clock.current + clock.lookAhead,
  immediate: () => clock.current,
  Time: (v: string) => ({
    toSeconds: () => clock.current + clock.lookAhead + parseFloat(v.replace('+', '')),
  }),
}));

import { resolveStartTime, StartGuard } from './start-time';

describe('resolveStartTime', () => {
  beforeEach(() => {
    clock.current = 10;
  });

  it('passes look-ahead Transport times through unchanged', () => {
    // Two 16ths inside one 200 ms ticker window must keep their spacing
    // (clamping to now() = 10.4 used to collapse both onto 10.4).
    expect(resolveStartTime(10.25)).toBe(10.25);
    expect(resolveStartTime(10.375)).toBe(10.375);
  });

  it('pulls a time that is already in the past up to the audio clock', () => {
    expect(resolveStartTime(9.5)).toBe(10);
  });

  it('resolves undefined to now() and relative strings against it', () => {
    expect(resolveStartTime()).toBeCloseTo(10.4);
    expect(resolveStartTime('+0.1')).toBeCloseTo(10.5);
  });
});

describe('StartGuard', () => {
  beforeEach(() => {
    clock.current = 10;
  });

  it('keeps sequenced spacing when times already increase', () => {
    const g = new StartGuard();
    expect(g.next(10.1)).toBe(10.1);
    expect(g.next(10.225)).toBe(10.225);
  });

  it('pushes a start that would land before an earlier-scheduled one', () => {
    const g = new StartGuard();
    const stab = g.next('+0.1'); // UI stab at 10.5
    const seq = g.next(10.3); // sequenced note processed afterwards
    expect(seq).toBeGreaterThan(stab);
  });

  it('separates identical times so a mono synth never gets equal starts', () => {
    const g = new StartGuard();
    const a = g.next(10.2);
    const b = g.next(10.2);
    expect(b).toBeGreaterThan(a);
  });
});
