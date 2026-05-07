// Owner: music-brain
//
// Bjorklund's algorithm for evenly distributing N pulses over M steps —
// the Euclidean rhythm generator. We use the iterative "remainder pairing"
// formulation, which is simpler than the original recursive partition and
// produces identical patterns.
//
// Reference: Toussaint, "The Euclidean Algorithm Generates Traditional
// Musical Rhythms" (2005). A canonical iterative impl is here:
//   https://github.com/brianhouse/bjorklund (MIT)
// We reimplement to avoid an external dep.

/**
 * Generate a Euclidean rhythm with `pulses` ones distributed as evenly as
 * possible over `steps` slots, then rotated by `shift` steps to the right.
 *
 * E(0, n) → all rests. E(n, n) → all pulses. E(p, n>p) → Bjorklund.
 */
export function euclideanRhythm(
  pulses: number,
  steps: number,
  shift: number = 0,
): boolean[] {
  if (steps <= 0) return [];
  if (pulses <= 0) return new Array(steps).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);

  // Build pattern using the iterative Bjorklund pairing technique.
  // We start with `pulses` "fronts" of [true] and `steps - pulses` "remainders"
  // of [false], then repeatedly pair fronts with remainders until we cannot.
  let fronts: boolean[][] = new Array(pulses).fill(0).map(() => [true]);
  let remainders: boolean[][] = new Array(steps - pulses)
    .fill(0)
    .map(() => [false]);

  while (remainders.length > 1) {
    const pairCount = Math.min(fronts.length, remainders.length);
    const newFronts: boolean[][] = [];
    for (let i = 0; i < pairCount; i++) {
      const a = fronts[i];
      const b = remainders[i];
      if (a && b) newFronts.push([...a, ...b]);
    }
    const leftoverFronts = fronts.slice(pairCount);
    const leftoverRemainders = remainders.slice(pairCount);
    if (leftoverFronts.length > 0) {
      // Some fronts had no remainder partner — they become the new remainders.
      fronts = newFronts;
      remainders = leftoverFronts;
    } else if (leftoverRemainders.length > 0) {
      fronts = newFronts;
      remainders = leftoverRemainders;
    } else {
      fronts = newFronts;
      remainders = [];
    }
  }

  // Concatenate fronts then remainders to build the final pattern.
  const out: boolean[] = [];
  for (const f of fronts) out.push(...f);
  for (const r of remainders) out.push(...r);

  // Apply right-rotation by `shift`.
  const n = out.length;
  if (n === 0) return out;
  const s = ((shift % n) + n) % n;
  if (s === 0) return out;
  return [...out.slice(n - s), ...out.slice(0, n - s)];
}
