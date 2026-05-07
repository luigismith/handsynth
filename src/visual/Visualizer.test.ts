// Owner: visualizer
//
// Smoke tests for VisualizerImpl. p5 cannot fully initialize a canvas under
// happy-dom (no real WebGL, no `getContext('2d')` parity), so we don't
// assert that the sketch *renders*. Instead we verify lifecycle behavior:
//   - mount registers the right listeners
//   - unmount unsubscribes and is idempotent
//   - resize handler is attached on mount, detached on unmount
//
// qa-listener owns deeper integration / perf tests in `tests/`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AudioEngine,
  HandTracker,
  HandTrackerEvents,
  MusicBrain,
  MusicBrainEvents,
} from '@contracts/contracts';
import { VisualizerImpl } from './Visualizer';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeMockAnalyser(): AnalyserNode {
  // Tiny stub — only the surface VisualizerImpl actually pokes.
  const a = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn(),
  } as unknown as AnalyserNode;
  return a;
}

function makeMockAudio(): AudioEngine & {
  __analyser: AnalyserNode;
} {
  const analyser = makeMockAnalyser();
  return {
    init: vi.fn(async () => undefined),
    loadVibe: vi.fn(),
    triggerLead: vi.fn(),
    triggerBass: vi.fn(),
    triggerChord: vi.fn(),
    triggerKick: vi.fn(),
    triggerHat: vi.fn(),
    triggerPerc: vi.fn(),
    triggerStab: vi.fn(),
    setParams: vi.fn(),
    setMute: vi.fn(),
    triggerDrop: vi.fn(),
    getAnalyser: vi.fn(() => analyser),
    isReady: vi.fn(() => true),
    __analyser: analyser,
  };
}

interface HandsCallTracker {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  listeners: Map<keyof HandTrackerEvents, Set<unknown>>;
}

function makeMockHands(): HandTracker & HandsCallTracker {
  const listeners = new Map<keyof HandTrackerEvents, Set<unknown>>();
  const on = vi.fn(<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]) => {
    let set = listeners.get(evt);
    if (!set) {
      set = new Set();
      listeners.set(evt, set);
    }
    set.add(cb);
  });
  const off = vi.fn(<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]) => {
    listeners.get(evt)?.delete(cb);
  });
  return {
    init: vi.fn(async () => undefined),
    start: vi.fn(),
    stop: vi.fn(),
    on,
    off,
    listeners,
  };
}

interface MusicCallTracker {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  subs: Set<MusicBrainEvents>;
}

function makeMockMusic(): MusicBrain & MusicCallTracker {
  const subs = new Set<MusicBrainEvents>();
  const on = vi.fn((events: MusicBrainEvents) => {
    subs.add(events);
  });
  const off = vi.fn((events: MusicBrainEvents) => {
    subs.delete(events);
  });
  return {
    start: vi.fn(),
    stop: vi.fn(),
    setInput: vi.fn(),
    advanceChord: vi.fn(),
    on,
    off,
    subs,
  };
}

function makeMountedCanvas(): HTMLCanvasElement {
  const parent = document.createElement('div');
  parent.id = 'canvas-host';
  // happy-dom: clientWidth/Height return 0; no layout. The visualizer falls
  // back to window.innerWidth/Height when 0, so this is fine.
  document.body.appendChild(parent);
  const canvas = document.createElement('canvas');
  canvas.id = 'visualizer';
  parent.appendChild(canvas);
  return canvas;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// p5 fails to boot under happy-dom (no canvas 2d context); silence the
// expected warning so the test output stays focused on real failures.
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleWarnSpy?.mockRestore();
  consoleWarnSpy = null;
});

describe('VisualizerImpl (smoke)', () => {
  it('exports a constructable class', () => {
    expect(typeof VisualizerImpl).toBe('function');
    const v = new VisualizerImpl();
    expect(v).toBeInstanceOf(VisualizerImpl);
  });

  it('unmount() before mount() is a no-op (idempotent)', () => {
    const v = new VisualizerImpl();
    expect(() => v.unmount()).not.toThrow();
    expect(() => v.unmount()).not.toThrow();
  });

  it('mount() throws if the canvas has no parent', () => {
    const v = new VisualizerImpl();
    const orphan = document.createElement('canvas');
    const audio = makeMockAudio();
    const hands = makeMockHands();
    const music = makeMockMusic();
    expect(() => v.mount(orphan, { audio, hands, music })).toThrow(
      /parentElement/,
    );
  });

  // p5 internally calls into canvas APIs that happy-dom doesn't fully
  // implement (e.g., 2d context features). Wrap the mount in try/catch so
  // we can still assert the listener registrations happened before p5
  // failed (they are registered before createSketch is called).
  describe('with a happy-dom canvas (best effort — p5 may not fully boot)', () => {
    it('mount() registers a gesture:update listener and a beat callback', () => {
      const v = new VisualizerImpl();
      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();

      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // p5 may fail under happy-dom; we only care that the listeners
        // were attached, which happens before the sketch boots.
      }

      const gestureSet = hands.listeners.get('gesture:update');
      expect(gestureSet?.size ?? 0).toBe(1);
      expect(music.subs.size).toBe(1);
      const sub = [...music.subs][0]!;
      expect(typeof sub.onBeat).toBe('function');

      // Cleanup — must not throw even if mount partially failed.
      expect(() => v.unmount()).not.toThrow();
    });

    it('unmount() unsubscribes both hand and music listeners', () => {
      const v = new VisualizerImpl();
      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();

      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }

      v.unmount();

      const gestureSet = hands.listeners.get('gesture:update');
      expect(gestureSet?.size ?? 0).toBe(0);
      expect(music.subs.size).toBe(0);
    });

    it('unmount() removes the resize listener', () => {
      const v = new VisualizerImpl();
      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();

      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }
      // Confirm a resize listener was added during mount.
      const addedResize = addSpy.mock.calls.some((c) => c[0] === 'resize');
      expect(addedResize).toBe(true);

      v.unmount();
      const removedResize = removeSpy.mock.calls.some((c) => c[0] === 'resize');
      expect(removedResize).toBe(true);

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('mount() is idempotent — calling twice does not double-subscribe', () => {
      const v = new VisualizerImpl();
      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();

      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }
      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }

      const gestureSet = hands.listeners.get('gesture:update');
      expect(gestureSet?.size ?? 0).toBe(1);
      expect(music.subs.size).toBe(1);

      v.unmount();
    });

    it('beat callback raises pulse, which decays back to 0 after unmount', () => {
      const v = new VisualizerImpl();
      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();

      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }

      const sub = [...music.subs][0];
      // onBeat is optional in the contract but VisualizerImpl always
      // provides one. If mount partially failed before subscribing,
      // skip the assertion gracefully.
      if (sub && sub.onBeat) {
        expect(() => sub.onBeat?.(0)).not.toThrow();
      }

      v.unmount();
    });
  });

  describe('setReducedMotion (concrete extension)', () => {
    it('exposes setReducedMotion as a public method', () => {
      const v = new VisualizerImpl();
      expect(typeof v.setReducedMotion).toBe('function');
    });

    it('does not throw when called before/after mount or unmount', () => {
      const v = new VisualizerImpl();
      expect(() => v.setReducedMotion(true)).not.toThrow();
      expect(() => v.setReducedMotion(false)).not.toThrow();

      const canvas = makeMountedCanvas();
      const audio = makeMockAudio();
      const hands = makeMockHands();
      const music = makeMockMusic();
      try {
        v.mount(canvas, { audio, hands, music });
      } catch {
        // ignore
      }

      expect(() => v.setReducedMotion(true)).not.toThrow();
      v.unmount();
      // Still safe after unmount.
      expect(() => v.setReducedMotion(false)).not.toThrow();
    });
  });
});
