// Owner: qa-listener
//
// End-to-end latency budget test. Skipped placeholder — qa-listener will fill
// in. Target: synthetic gesture event → AudioEngine trigger ≤ 20ms (p95) on a
// modern desktop.

import { describe, it } from 'vitest';

describe.skip('latency budget', () => {
  it('gesture → audio trigger is below 20ms p95', () => {
    // qa-listener: instrument with synthetic GestureState events, measure
    // wall-clock to AudioEngine.triggerLead/triggerStab via a spy. Use
    // performance.now(). Tolerate ±2ms jitter.
  });

  it('AudioEngine.setParams smooths within 50ms', () => {
    // qa-listener: drive a step change and assert the smoothed param reaches
    // 99% of target within 50ms.
  });
});
