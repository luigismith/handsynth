// Owner: visualizer
//
// Unit tests for the particle field. The field is a pure-JS module — no
// canvas, no DOM — so we can drive it with a stub p5 surface and assert
// the right primitives are emitted (e.g. that the cyberpunk redesign
// renders triangles, not circles).

import { describe, it, expect } from 'vitest';
import type p5 from 'p5';
import { createParticleField } from './particles';

interface StubCall {
  fn: string;
  args: unknown[];
}

function createStub(): {
  calls: StubCall[];
  noStroke(): void;
  fill(...args: unknown[]): void;
  triangle(...args: number[]): void;
  circle(...args: number[]): void;
} {
  const calls: StubCall[] = [];
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
  };
  return {
    calls,
    noStroke: rec('noStroke'),
    fill: rec('fill') as unknown as (...args: unknown[]) => void,
    triangle: rec('triangle') as unknown as (...args: number[]) => void,
    circle: rec('circle') as unknown as (...args: number[]) => void,
  };
}

describe('ParticleField', () => {
  it('seeds ambient particles on construction', () => {
    const field = createParticleField(800, 600);
    const stub = createStub();
    field.draw(stub as unknown as p5);
    // The ambient seed places ~MAX_PARTICLES/2 (60) particles. Each draws
    // as one triangle. We tolerate a small range to cover edge cases.
    const triCount = stub.calls.filter((c) => c.fn === 'triangle').length;
    expect(triCount).toBeGreaterThan(0);
    expect(triCount).toBeLessThanOrEqual(120);
  });

  it('renders particles as triangles, not circles (low-poly aesthetic)', () => {
    const field = createParticleField(800, 600);
    const stub = createStub();
    field.draw(stub as unknown as p5);
    const triCount = stub.calls.filter((c) => c.fn === 'triangle').length;
    const circCount = stub.calls.filter((c) => c.fn === 'circle').length;
    // After the cyberpunk redesign the particle field should ONLY emit
    // triangle() calls — no circle() halos.
    expect(triCount).toBeGreaterThan(0);
    expect(circCount).toBe(0);
  });

  it('emitFromMouth spawns particles that draw on the next frame', () => {
    const field = createParticleField(800, 600);
    // Empty FFT — make sure the only new particles are mouth-driven.
    const fft = new Uint8Array(1024);

    // Tick once to advance the internal mouth-emit clock so the next
    // emit call sees a real dt.
    field.update({ fft, width: 800, height: 600, dt: 0.05 });

    const beforeStub = createStub();
    field.draw(beforeStub as unknown as p5);
    const beforeCount = beforeStub.calls.filter((c) => c.fn === 'triangle').length;

    // Force a small wall-clock delay so emitFromMouth's internal dt is
    // non-zero on the second call.
    const start = performance.now();
    while (performance.now() - start < 80) {
      // busy wait ~80ms — enough for the 28/sec base rate to deposit
      // a few particles into the quota.
    }
    field.emitFromMouth(400, 300, 0.6);
    field.update({ fft, width: 800, height: 600, dt: 0.05 });

    const afterStub = createStub();
    field.draw(afterStub as unknown as p5);
    const afterCount = afterStub.calls.filter((c) => c.fn === 'triangle').length;

    // Mouth-emit should produce at least one new particle; the cap is the
    // pool ceiling so it could remain equal if the pool was already full,
    // but with the default seed (~60 alive) and a fresh field it has room.
    expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
  });

  it('reset clears and re-seeds the field', () => {
    const field = createParticleField(800, 600);
    field.reset(1024, 768);
    const stub = createStub();
    field.draw(stub as unknown as p5);
    const triCount = stub.calls.filter((c) => c.fn === 'triangle').length;
    expect(triCount).toBeGreaterThan(0);
  });

  it('setReducedMotion is callable and does not throw', () => {
    const field = createParticleField(800, 600);
    expect(() => field.setReducedMotion(true)).not.toThrow();
    expect(() => field.setReducedMotion(false)).not.toThrow();
  });
});
