// Owner: music-brain
//
// Order-2 Markov chain over scale degrees (1..7). The key for the table is
// the pair `(prev, curr)` and the value is a weighted distribution over the
// next degree. Weights are small integer "votes" rather than probabilities,
// which keeps the table readable and easy to hand-tune.
//
// Bias philosophy:
//   - Stepwise motion (degree ±1) has the highest weight. Melodies move
//     stepwise more often than they leap. This is Bach 101.
//   - Consonant skips (3rds, 5ths, 6ths) get medium weight.
//   - Octave leaps and tritones (degree 4 → 7 etc.) get very low weight; they
//     only appear when other paths are starved.
//   - There is always a non-zero weight on every degree, so the chain never
//     dead-ends.

export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Probability table: rows are (prev,curr), columns are next degree weights. */
export interface MarkovTable {
  /** size 7×7×7 of integer weights. Indexed [prev-1][curr-1][next-1]. */
  weights: number[][][];
}

const DEGREES: ScaleDegree[] = [1, 2, 3, 4, 5, 6, 7];

function intervalClass(a: number, b: number): number {
  return Math.abs(a - b);
}

/**
 * Default weight given an interval (in scale degrees) between curr and next.
 * Higher = more likely. This is the order-1 baseline; the order-2 prev-curr
 * pair contributes a small additional bias (see buildDefaultMarkovTable).
 */
function baseWeight(interval: number): number {
  switch (interval) {
    case 0: // repeat
      return 2;
    case 1: // step
      return 8;
    case 2: // third
      return 5;
    case 3: // fourth
      return 2;
    case 4: // fifth
      return 4;
    case 5: // sixth
      return 2;
    case 6: // seventh / tritone-ish
      return 1;
    default:
      return 1;
  }
}

/**
 * Order-2 bias: if the previous interval was an upward leap (>= 3 degrees),
 * favour stepwise descent — this is the "leap then resolve" rule that makes
 * lines feel composed rather than random.
 */
function order2Bias(prev: number, curr: number, next: number): number {
  const prevInt = curr - prev;
  const nextInt = next - curr;
  if (Math.abs(prevInt) >= 3) {
    // After a leap, prefer the opposite-direction step.
    if (Math.sign(prevInt) === -Math.sign(nextInt) && Math.abs(nextInt) === 1) {
      return 6;
    }
    // Repeated leaps are rare.
    if (Math.abs(nextInt) >= 3) return -2;
  }
  // After a step, continuation in same direction is mildly encouraged.
  if (Math.abs(prevInt) === 1 && Math.sign(nextInt) === Math.sign(prevInt)) {
    return 2;
  }
  return 0;
}

export function buildDefaultMarkovTable(): MarkovTable {
  const weights: number[][][] = [];
  for (const prev of DEGREES) {
    const prevRow: number[][] = [];
    for (const curr of DEGREES) {
      const currRow: number[] = [];
      for (const next of DEGREES) {
        const w = Math.max(
          1,
          baseWeight(intervalClass(curr, next)) + order2Bias(prev, curr, next),
        );
        currRow.push(w);
      }
      prevRow.push(currRow);
    }
    weights.push(prevRow);
  }
  return { weights };
}

/** Pick a next degree weighted by `weights`. `rng` should return [0,1). */
export function pickWeighted(weights: number[], rng: () => number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] ?? 0;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Sample the next degree given (prev, curr). */
export function sampleNextDegree(
  table: MarkovTable,
  prev: ScaleDegree,
  curr: ScaleDegree,
  rng: () => number,
): ScaleDegree {
  const row = table.weights[prev - 1]?.[curr - 1];
  if (!row) return curr;
  const idx = pickWeighted(row, rng);
  return (idx + 1) as ScaleDegree;
}
