// Owner: hand-tracker
//
// Unit tests for GestureInterpreter. We feed sequences of HandsState through
// `ingestHands()` and assert that:
//   - Static shape edges respect the 3-frame consensus + 350 ms cooldown
//   - Velocity gestures fire only when their thresholds are met
//   - Cooldowns suppress immediate re-fires
//   - Hands disappearing exits the current shape gracefully
//
// We inject a fake clock via `nowMs` so timing is deterministic without
// real timers.

import { describe, it, expect } from 'vitest';
import type { Hand, HandShape, HandsState } from '@contracts/contracts';
import {
  GestureInterpreter,
  __testing as INTERP,
  type GestureCallback,
} from './GestureInterpreter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeHand(
  side: 'left' | 'right',
  shape: HandShape,
  over: Partial<Hand> = {},
): Hand {
  // Build a 21-landmark array matching the openHand fixture so velocity
  // calculations have reasonable handSize.
  const lm = baseLandmarks();
  const h: Hand = {
    side,
    landmarks: lm,
    palmCenter: { x: 0.5, y: 0.6, z: 0 },
    openness: 0.7,
    pinch: 0.7,
    isClosed: false,
    depth: 0,
    roll: 0,
    pitch: 0,
    shape,
    ...over,
  };
  return h;
}

/** A simple openHand-style 21-landmark fixture with known geometry. */
function baseLandmarks() {
  const lm = [
    { x: 0.5, y: 0.85, z: 0 }, // 0 wrist
    { x: 0.40, y: 0.78, z: 0 }, // 1 thumb cmc
    { x: 0.34, y: 0.74, z: 0 }, // 2 thumb mcp
    { x: 0.28, y: 0.70, z: 0 }, // 3 thumb ip
    { x: 0.22, y: 0.66, z: 0 }, // 4 thumb tip
    { x: 0.42, y: 0.65, z: 0 }, // 5 index mcp
    { x: 0.42, y: 0.55, z: 0 }, // 6 index pip
    { x: 0.42, y: 0.45, z: 0 }, // 7 index dip
    { x: 0.42, y: 0.30, z: 0 }, // 8 index tip (extended)
    { x: 0.50, y: 0.65, z: 0 }, // 9 middle mcp
    { x: 0.50, y: 0.55, z: 0 }, // 10
    { x: 0.50, y: 0.45, z: 0 }, // 11
    { x: 0.50, y: 0.30, z: 0 }, // 12 middle tip
    { x: 0.58, y: 0.65, z: 0 }, // 13
    { x: 0.58, y: 0.55, z: 0 }, // 14
    { x: 0.58, y: 0.45, z: 0 }, // 15
    { x: 0.58, y: 0.30, z: 0 }, // 16 ring tip
    { x: 0.66, y: 0.65, z: 0 }, // 17
    { x: 0.66, y: 0.55, z: 0 }, // 18
    { x: 0.66, y: 0.45, z: 0 }, // 19
    { x: 0.66, y: 0.30, z: 0 }, // 20 pinky tip
  ];
  return lm;
}

/** Construct a clock function that advances on each ingest call. */
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

function captureEvents(interp: GestureInterpreter): GestureCallback {
  const events: Array<Parameters<GestureCallback>[0]> = [];
  const cb: GestureCallback = (e) => {
    events.push(e);
  };
  interp.on('gesture', cb);
  // Attach the captured array to the function so tests can read it.
  (cb as unknown as { events: typeof events }).events = events;
  return cb;
}

function ingestNTimes(
  interp: GestureInterpreter,
  state: HandsState,
  clock: ReturnType<typeof makeClock>,
  n: number,
  stepMs = 40,
): void {
  for (let i = 0; i < n; i += 1) {
    interp.ingestHands(state);
    clock.advance(stepMs);
  }
}

// ---------------------------------------------------------------------------
// Static shape edges
// ---------------------------------------------------------------------------

describe('GestureInterpreter — static shape edges', () => {
  it('does not fire shape_enter on a single frame (consensus required)', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    interp.ingestHands({ right: makeHand('right', 'point') });
    expect((cb as unknown as { events: unknown[] }).events.length).toBe(0);
  });

  it('fires shape_enter after CONSENSUS_FRAMES of identical shape', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    const state: HandsState = { right: makeHand('right', 'point') };
    ingestNTimes(interp, state, clock, INTERP.SHAPE_CONSENSUS_FRAMES);
    const events = (cb as unknown as { events: Array<{ type: string; shape?: string }> }).events;
    const enters = events.filter((e) => e.type === 'shape_enter');
    expect(enters.length).toBe(1);
    expect(enters[0]?.shape).toBe('point');
  });

  it('switching shape fires shape_exit then shape_enter', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 3);
    // Wait past the per-shape cooldown so the next shape can fire.
    clock.advance(INTERP.SHAPE_COOLDOWN_MS + 50);
    ingestNTimes(interp, { right: makeHand('right', 'peace') }, clock, 3);

    const events = (cb as unknown as {
      events: Array<{ type: string; shape?: string }>;
    }).events;
    const types = events.map((e) => `${e.type}:${e.shape ?? ''}`);
    expect(types).toContain('shape_enter:point');
    expect(types).toContain('shape_exit:point');
    expect(types).toContain('shape_enter:peace');
  });

  it('hand disappearing emits shape_exit', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 3);
    interp.ingestHands({}); // no hands
    const events = (cb as unknown as {
      events: Array<{ type: string; shape?: string }>;
    }).events;
    expect(events.some((e) => e.type === 'shape_exit' && e.shape === 'point')).toBe(true);
  });

  it('per-shape cooldown suppresses immediate re-fire', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    // Step the consensus frames very fast (1 ms apart) so the elapsed
    // wall time when we try the second `point` is below SHAPE_COOLDOWN_MS.
    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 3, 1);
    // Move to peace, fast — peace commits then we try point again with
    // total elapsed < 350 ms since first point fire.
    ingestNTimes(interp, { right: makeHand('right', 'peace') }, clock, 3, 1);
    // Immediately try to go back to point — must be suppressed by cooldown.
    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 3, 1);
    const events = (cb as unknown as {
      events: Array<{ type: string; shape?: string }>;
    }).events;
    const pointEnters = events.filter(
      (e) => e.type === 'shape_enter' && e.shape === 'point',
    );
    expect(pointEnters.length).toBe(1);
  });

  it('alternating-shape jitter does not fire (consensus must be unanimous)', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    // Alternate point / peace for 6 frames — neither hits 3-in-a-row.
    interp.ingestHands({ right: makeHand('right', 'point') });
    clock.advance(40);
    interp.ingestHands({ right: makeHand('right', 'peace') });
    clock.advance(40);
    interp.ingestHands({ right: makeHand('right', 'point') });
    clock.advance(40);
    interp.ingestHands({ right: makeHand('right', 'peace') });
    clock.advance(40);
    interp.ingestHands({ right: makeHand('right', 'point') });
    clock.advance(40);
    interp.ingestHands({ right: makeHand('right', 'peace') });
    const events = (cb as unknown as {
      events: Array<{ type: string }>;
    }).events;
    expect(events.filter((e) => e.type === 'shape_enter').length).toBe(0);
  });

  it('exposes the current committed shape via getCurrentShape', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    expect(interp.getCurrentShape('Right')).toBe('unknown');
    ingestNTimes(interp, { right: makeHand('right', 'fist') }, clock, 3);
    expect(interp.getCurrentShape('Right')).toBe('fist');
    expect(interp.getCurrentShape('Left')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Snap
// ---------------------------------------------------------------------------

describe('GestureInterpreter — snap', () => {
  it('fires snap on a fast curled→extended index transition', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    // Build hand with curled index (tip near MCP).
    const curledLm = baseLandmarks();
    curledLm[8] = { x: 0.42, y: 0.65, z: 0 }; // index tip pulled to MCP
    const curledHand: Hand = {
      side: 'right',
      landmarks: curledLm,
      palmCenter: { x: 0.5, y: 0.6, z: 0 },
      openness: 0.2,
      pinch: 1,
      isClosed: false,
      depth: 0,
      roll: 0,
      pitch: 0,
      shape: 'fist',
    };
    // 3 frames curled.
    interp.ingestHands({ right: curledHand });
    clock.advance(15);
    interp.ingestHands({ right: curledHand });
    clock.advance(15);
    interp.ingestHands({ right: curledHand });
    clock.advance(15);
    // Two fast frames with tip extended (huge upward index velocity).
    const extLm = baseLandmarks(); // index tip at 0.30
    const extHand: Hand = {
      ...curledHand,
      landmarks: extLm,
      shape: 'point',
    };
    interp.ingestHands({ right: extHand });
    clock.advance(15);
    interp.ingestHands({ right: extHand });
    const events = (cb as unknown as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type === 'snap')).toBe(true);
  });

  it('snap does not re-fire within cooldown', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    const curledLm = baseLandmarks();
    curledLm[8] = { x: 0.42, y: 0.65, z: 0 };
    const curledHand: Hand = {
      side: 'right',
      landmarks: curledLm,
      palmCenter: { x: 0.5, y: 0.6, z: 0 },
      openness: 0.2,
      pinch: 1,
      isClosed: false,
      depth: 0,
      roll: 0,
      pitch: 0,
      shape: 'fist',
    };
    const extHand: Hand = {
      ...curledHand,
      landmarks: baseLandmarks(),
      shape: 'point',
    };

    // Fire snap.
    for (let i = 0; i < 3; i++) {
      interp.ingestHands({ right: curledHand });
      clock.advance(15);
    }
    interp.ingestHands({ right: extHand });
    clock.advance(15);
    interp.ingestHands({ right: extHand });
    clock.advance(15);

    const firstCount = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'snap').length;
    expect(firstCount).toBe(1);

    // Try to fire again within cooldown.
    for (let i = 0; i < 3; i++) {
      interp.ingestHands({ right: curledHand });
      clock.advance(15);
    }
    interp.ingestHands({ right: extHand });
    clock.advance(15);
    interp.ingestHands({ right: extHand });
    const secondCount = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'snap').length;
    // Second snap is suppressed because we're inside the 250ms cooldown.
    expect(secondCount).toBe(1);
  });

  it('still index motion does not fire snap', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    const h = makeHand('right', 'open_palm');
    for (let i = 0; i < 8; i++) {
      interp.ingestHands({ right: h });
      clock.advance(40);
    }
    const snaps = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'snap');
    expect(snaps.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Swipe
// ---------------------------------------------------------------------------

describe('GestureInterpreter — swipe', () => {
  it('fires swipe_right on sustained rightward palm motion', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    // Move palm center from x=0.2 to x=0.8 across 5 frames at 40ms intervals.
    // dt = 0.16 s, dx = 0.6, vx ≈ 3.75 / handSize. handSize ~0.25 → vx ≈ 15.
    let x = 0.2;
    for (let i = 0; i < 6; i += 1) {
      const h = makeHand('right', 'open_palm', {
        palmCenter: { x, y: 0.5, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(40);
      x += 0.12;
    }
    const events = (cb as unknown as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type === 'swipe_right')).toBe(true);
    expect(events.some((e) => e.type === 'swipe_left')).toBe(false);
  });

  it('fires swipe_left on sustained leftward motion', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    let x = 0.8;
    for (let i = 0; i < 6; i += 1) {
      const h = makeHand('right', 'open_palm', {
        palmCenter: { x, y: 0.5, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(40);
      x -= 0.12;
    }
    const events = (cb as unknown as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type === 'swipe_left')).toBe(true);
  });

  it('a quick blip below the sustain window does not fire', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    // One single big jump then back to still — no sustained velocity.
    const h1 = makeHand('right', 'open_palm', { palmCenter: { x: 0.2, y: 0.5, z: 0 } });
    const h2 = makeHand('right', 'open_palm', { palmCenter: { x: 0.6, y: 0.5, z: 0 } });
    interp.ingestHands({ right: h1 });
    clock.advance(40);
    interp.ingestHands({ right: h2 });
    clock.advance(80);
    interp.ingestHands({ right: h2 });
    clock.advance(80);
    interp.ingestHands({ right: h2 });
    const events = (cb as unknown as { events: Array<{ type: string }> }).events;
    expect(events.some((e) => e.type.startsWith('swipe'))).toBe(false);
  });

  it('swipe cooldown suppresses immediate re-fire', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    // Two consecutive swipe_right runs, the second within the cooldown.
    const sweep = (start: number, dir: 1 | -1): void => {
      let x = start;
      for (let i = 0; i < 6; i += 1) {
        const h = makeHand('right', 'open_palm', {
          palmCenter: { x, y: 0.5, z: 0 },
        });
        interp.ingestHands({ right: h });
        clock.advance(40);
        x += 0.12 * dir;
      }
    };
    sweep(0.2, 1);
    sweep(0.2, 1);
    const swipes = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'swipe_right');
    // Cooldown is 600ms; total elapsed across the second sweep is < 600ms
    // from first fire so the second should not fire.
    expect(swipes.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fist pump
// ---------------------------------------------------------------------------

describe('GestureInterpreter — fist_pump', () => {
  it('fires when fist drops downward fast', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    let y = 0.2;
    for (let i = 0; i < 6; i += 1) {
      const h = makeHand('right', 'fist', {
        palmCenter: { x: 0.5, y, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(40);
      y += 0.10;
    }
    const events = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'fist_pump');
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire when shape is not fist', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    let y = 0.2;
    for (let i = 0; i < 6; i += 1) {
      const h = makeHand('right', 'open_palm', {
        palmCenter: { x: 0.5, y, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(40);
      y += 0.10;
    }
    const events = (cb as unknown as { events: Array<{ type: string }> })
      .events.filter((e) => e.type === 'fist_pump');
    expect(events.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wave
// ---------------------------------------------------------------------------

describe('GestureInterpreter — wave_level', () => {
  it('emits rising wave_level on oscillating L↔R motion', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);

    // Oscillate palm x in a square wave: 0.3 → 0.7 → 0.3 → 0.7 → 0.3 → 0.7 ...
    let x = 0.3;
    let dir = 1;
    for (let i = 0; i < 10; i += 1) {
      const h = makeHand('right', 'open_palm', {
        palmCenter: { x, y: 0.5, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(80);
      x += 0.4 * dir;
      dir *= -1;
    }
    const events = (cb as unknown as {
      events: Array<{ type: string; level?: number }>;
    }).events.filter((e) => e.type === 'wave_level');
    expect(events.length).toBeGreaterThan(0);
    const max = Math.max(...events.map((e) => e.level ?? 0));
    expect(max).toBeGreaterThan(0.5);
  });

  it('does not emit wave_level for steady motion', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    let x = 0.2;
    for (let i = 0; i < 8; i += 1) {
      const h = makeHand('right', 'open_palm', {
        palmCenter: { x, y: 0.5, z: 0 },
      });
      interp.ingestHands({ right: h });
      clock.advance(60);
      x += 0.05;
    }
    const events = (cb as unknown as {
      events: Array<{ type: string; level?: number }>;
    }).events.filter((e) => e.type === 'wave_level');
    // Either zero events, or only level=0 emissions.
    for (const e of events) {
      expect(e.level ?? 0).toBeLessThan(0.4);
    }
  });
});

// ---------------------------------------------------------------------------
// Listener lifecycle
// ---------------------------------------------------------------------------

describe('GestureInterpreter — listeners', () => {
  it('off() removes the callback', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const events: unknown[] = [];
    const cb = (e: unknown): void => {
      events.push(e);
    };
    interp.on('gesture', cb);
    interp.off('gesture', cb);
    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 5);
    expect(events.length).toBe(0);
  });

  it('listeners that throw do not break the loop', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    let goodCalls = 0;
    interp.on('gesture', () => {
      throw new Error('boom');
    });
    interp.on('gesture', () => {
      goodCalls += 1;
    });
    ingestNTimes(interp, { right: makeHand('right', 'point') }, clock, 3);
    expect(goodCalls).toBeGreaterThan(0);
  });

  it('events go to the correct handedness', () => {
    const clock = makeClock();
    const interp = new GestureInterpreter({ nowMs: clock.now });
    const cb = captureEvents(interp);
    ingestNTimes(interp, { left: makeHand('left', 'peace') }, clock, 3);
    const events = (cb as unknown as {
      events: Array<{ type: string; handedness?: string }>;
    }).events.filter((e) => e.type === 'shape_enter');
    expect(events.length).toBe(1);
    expect(events[0]?.handedness).toBe('Left');
  });
});
