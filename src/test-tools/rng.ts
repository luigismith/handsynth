// Owner: qa-listener / synthetic-player harness
//
// Tiny mulberry32 PRNG. Picked because:
//   - deterministic given the seed
//   - 32-bit state, no dependencies
//   - quality is fine for stress testing (we're not doing crypto)

import type { SeededRng } from './types';

export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
