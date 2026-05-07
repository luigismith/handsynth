// Owner: hand-tracker
//
// One Euro Filter — adaptive low-pass for noisy signals (Casiez, Roussel,
// Vogel 2012). Used to smooth landmark coordinates and derived metrics
// (openness, pinch) without adding perceptible lag.
//
//     y(t) = α * x(t) + (1-α) * y(t-1)
//     α    = 1 / (1 + τ/Δt)        where τ = 1 / (2π * fc)
//     fc   = mincutoff + β * |x'(t)|
//
// Tunables: `mincutoff` (slow Hz cutoff at rest), `beta` (speed coefficient).

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by hand-tracker';

export interface OneEuroOptions {
  mincutoff?: number;
  beta?: number;
  dcutoff?: number;
}

export class OneEuroFilter {
  constructor(_opts: OneEuroOptions = {}) {
    void _opts;
  }
  /** Filter a sample. `t` is timestamp in seconds. */
  filter(_x: number, _t: number): number {
    throw new Error(NOT_IMPL);
  }
  reset(): void {
    throw new Error(NOT_IMPL);
  }
}
