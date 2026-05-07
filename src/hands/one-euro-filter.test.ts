// Owner: hand-tracker
//
// Unit tests for the One Euro Filter. Vitest defaults pick these up via the
// `tests/**/*.test.ts` include glob; they're colocated here for readability
// and also discovered when running vitest with a wider include.

import { describe, it, expect } from 'vitest';
import { OneEuroFilter, OneEuroVec3 } from './one-euro-filter';

const RATE_HZ = 60;
const DT_S = 1 / RATE_HZ;

function step(values: number[], filter: OneEuroFilter): number[] {
  const out: number[] = [];
  let t = 0;
  for (const v of values) {
    out.push(filter.filter(v, t));
    t += DT_S;
  }
  return out;
}

describe('OneEuroFilter', () => {
  it('first sample passes through unchanged (warm-up)', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    expect(f.filter(0.5, 0)).toBeCloseTo(0.5, 6);
  });

  it('zero in → zero out (DC stability)', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    const samples = new Array(120).fill(0);
    const ys = step(samples, f);
    for (const y of ys) expect(y).toBeCloseTo(0, 6);
  });

  it('converges toward a step input within reasonable time', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    // 30 frames of 0.0, then 90 frames of 1.0.
    const seq = [
      ...new Array(30).fill(0),
      ...new Array(90).fill(1),
    ];
    const ys = step(seq, f);
    const last = ys.at(-1)!;
    expect(last).toBeGreaterThan(0.9);
    expect(last).toBeLessThanOrEqual(1.0);
  });

  it('outputs approximately the mean for noisy constant signal', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    const N = 600;
    const seq: number[] = [];
    let seed = 1;
    // Deterministic small-amplitude noise around 0.5
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < N; i += 1) {
      seq.push(0.5 + (rand() - 0.5) * 0.05);
    }
    const ys = step(seq, f);
    // Average of the last quarter — should hover near 0.5.
    const tail = ys.slice(Math.floor((N * 3) / 4));
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
    // And smoother than the raw input.
    const inputTail = seq.slice(Math.floor((N * 3) / 4));
    const variance = (xs: number[], m: number) =>
      xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(variance(tail, mean)).toBeLessThan(variance(inputTail, mean));
  });

  it('reset() returns the filter to first-sample behaviour', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    f.filter(1, 0);
    f.filter(2, DT_S);
    f.reset();
    expect(f.filter(7, 1.0)).toBeCloseTo(7, 6);
  });

  it('non-monotonic timestamps do not crash and stay finite', () => {
    const f = new OneEuroFilter({ mincutoff: 1.0, beta: 0.007 });
    f.filter(0, 0);
    const y = f.filter(1, 0); // dt collapses to epsilon
    expect(Number.isFinite(y)).toBe(true);
  });
});

describe('OneEuroVec3', () => {
  it('smooths each axis independently', () => {
    const v = new OneEuroVec3({ mincutoff: 1.0, beta: 0.007 });
    const first = v.filter({ x: 1, y: 2, z: 3 }, 0);
    expect(first).toEqual({ x: 1, y: 2, z: 3 });
    const second = v.filter({ x: 1, y: 2, z: 3 }, DT_S);
    expect(second.x).toBeCloseTo(1, 6);
    expect(second.y).toBeCloseTo(2, 6);
    expect(second.z).toBeCloseTo(3, 6);
  });

  it('reset() clears all three axis filters', () => {
    const v = new OneEuroVec3({ mincutoff: 1.0, beta: 0.007 });
    v.filter({ x: 0, y: 0, z: 0 }, 0);
    v.filter({ x: 5, y: 5, z: 5 }, DT_S);
    v.reset();
    const out = v.filter({ x: 9, y: 9, z: 9 }, 1.0);
    expect(out).toEqual({ x: 9, y: 9, z: 9 });
  });
});
