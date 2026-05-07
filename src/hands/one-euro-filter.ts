// Owner: hand-tracker
//
// One Euro Filter — adaptive low-pass for noisy signals (Casiez, Roussel,
// Vogel, CHI 2012). Used to smooth landmark coordinates and derived metrics
// (openness, pinch) without adding perceptible lag.
//
// Algorithm:
//     dx        = (x - prev_x) / dt
//     dxHat     = LP(dx, dcutoff)
//     cutoff    = mincutoff + beta * |dxHat|
//     y(t)      = LP(x, cutoff)
//     where LP(v, fc): alpha = 1 / (1 + tau/dt), tau = 1 / (2*pi*fc)
//
// Tunables: `mincutoff` (slow Hz cutoff at rest), `beta` (speed coefficient),
// `dcutoff` (cutoff used to smooth the derivative — defaults to 1.0).

const TWO_PI = 2 * Math.PI;

export interface OneEuroParams {
  mincutoff: number;
  beta: number;
  dcutoff?: number;
}

/** Backwards-compat alias used by earlier prototypes. */
export type OneEuroOptions = Partial<OneEuroParams>;

/**
 * Compute the standard low-pass smoothing factor alpha for a given cutoff and
 * timestep. `cutoff` is in Hz, `dt` in seconds.
 */
function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (TWO_PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Standard exponential low-pass step. */
function lowPass(prev: number, value: number, alpha: number): number {
  return alpha * value + (1 - alpha) * prev;
}

export class OneEuroFilter {
  private mincutoff: number;
  private beta: number;
  private dcutoff: number;

  private prevValue: number | null = null;
  private prevDeriv = 0;
  private prevTime: number | null = null;

  constructor(params: OneEuroParams | OneEuroOptions = {}) {
    this.mincutoff =
      typeof params.mincutoff === 'number' ? params.mincutoff : 1.0;
    this.beta = typeof params.beta === 'number' ? params.beta : 0.007;
    this.dcutoff = typeof params.dcutoff === 'number' ? params.dcutoff : 1.0;
  }

  /**
   * Filter a sample. `timestamp` is in seconds. Non-monotonic or duplicate
   * timestamps are guarded with a tiny minimum dt to avoid divide-by-zero.
   */
  filter(value: number, timestamp: number): number {
    if (this.prevValue === null || this.prevTime === null) {
      this.prevValue = value;
      this.prevTime = timestamp;
      this.prevDeriv = 0;
      return value;
    }

    const dt = Math.max(timestamp - this.prevTime, 1e-6);

    // Derivative + low-pass on derivative
    const dx = (value - this.prevValue) / dt;
    const aD = smoothingFactor(this.dcutoff, dt);
    const dxHat = lowPass(this.prevDeriv, dx, aD);

    // Adaptive cutoff
    const cutoff = this.mincutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(cutoff, dt);
    const yHat = lowPass(this.prevValue, value, a);

    this.prevValue = yHat;
    this.prevDeriv = dxHat;
    this.prevTime = timestamp;
    return yHat;
  }

  reset(): void {
    this.prevValue = null;
    this.prevDeriv = 0;
    this.prevTime = null;
  }
}

/**
 * Convenience wrapper: three OneEuroFilters operating on x/y/z components of a
 * vector (typically a HandLandmark). All three components share the same
 * parameters but maintain independent state.
 */
export class OneEuroVec3 {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  private fz: OneEuroFilter;

  constructor(params: OneEuroParams | OneEuroOptions = {}) {
    this.fx = new OneEuroFilter(params);
    this.fy = new OneEuroFilter(params);
    this.fz = new OneEuroFilter(params);
  }

  filter(
    v: { x: number; y: number; z: number },
    timestamp: number,
  ): { x: number; y: number; z: number } {
    return {
      x: this.fx.filter(v.x, timestamp),
      y: this.fy.filter(v.y, timestamp),
      z: this.fz.filter(v.z, timestamp),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
