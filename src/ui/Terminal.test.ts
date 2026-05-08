// Owner: ux-curator
//
// Smoke tests for TerminalImpl. happy-dom — we only verify mount/unmount
// idempotence, the music subscription wiring, gesture throttling, and the
// status bar refresh.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalImpl, type TerminalDeps } from './Terminal';
import type {
  AudioEngine,
  GestureState,
  HandTracker,
  MusicBrain,
  MusicBrainEvents,
  HandTrackerEvents,
} from '@contracts/contracts';

function makeMusic(): MusicBrain & { __sub: MusicBrainEvents | null } {
  const m = {
    __sub: null as MusicBrainEvents | null,
    start: vi.fn(),
    stop: vi.fn(),
    setInput: vi.fn(),
    advanceChord: vi.fn(),
    on: vi.fn((events: MusicBrainEvents) => {
      m.__sub = events;
    }),
    off: vi.fn(() => {
      m.__sub = null;
    }),
  };
  return m as unknown as MusicBrain & { __sub: MusicBrainEvents | null };
}

function makeHands(): HandTracker & {
  __cb: HandTrackerEvents['gesture:update'] | null;
} {
  const h = {
    __cb: null as HandTrackerEvents['gesture:update'] | null,
    init: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    on: vi.fn(<K extends keyof HandTrackerEvents>(evt: K, cb: HandTrackerEvents[K]) => {
      if (evt === 'gesture:update') {
        h.__cb = cb as HandTrackerEvents['gesture:update'];
      }
    }),
    off: vi.fn(() => {
      h.__cb = null;
    }),
  };
  return h as unknown as HandTracker & { __cb: HandTrackerEvents['gesture:update'] | null };
}

function makeAudio(): AudioEngine {
  const ctx = { state: 'running' as const };
  const an = { context: ctx } as unknown as AnalyserNode;
  return {
    init: vi.fn(),
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
    getAnalyser: () => an,
    isReady: () => true,
  } as unknown as AudioEngine;
}

function makeDeps(): TerminalDeps {
  return {
    music: makeMusic(),
    audio: makeAudio(),
    hands: makeHands(),
    getMapperState: () => ({ intensity: 0.42, mood: 'rising', bpm: 96 }),
  };
}

function fullState(over: Partial<GestureState> = {}): GestureState {
  return {
    hands: [],
    bothHandsDetected: false,
    handsDistance: 0.4,
    meanHeight: 0.5,
    rightOpenness: 0.5,
    leftOpenness: 0.5,
    rightPinchActive: false,
    leftPinchActive: false,
    bothFists: false,
    bothAboveHead: false,
    fingerCount: 0,
    noHandsDuration: 0,
    ...over,
  };
}

describe('TerminalImpl', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });
  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
  });

  it('mounts a terminal hidden by default with a status bar', () => {
    const term = new TerminalImpl();
    term.mount(parent, makeDeps());
    const root = parent.querySelector('.hs-terminal') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.hidden).toBe(true);
    expect(parent.querySelector('.hs-term-status')).not.toBeNull();
    expect(parent.querySelector('.hs-term-rec')).not.toBeNull();
    term.unmount();
  });

  it('mount is idempotent', () => {
    const term = new TerminalImpl();
    term.mount(parent, makeDeps());
    term.mount(parent, makeDeps());
    expect(parent.querySelectorAll('.hs-terminal').length).toBe(1);
    term.unmount();
  });

  it('subscribes to music and renders lead / chord lines', () => {
    const term = new TerminalImpl();
    const music = makeMusic();
    term.mount(parent, { ...makeDeps(), music });
    expect(music.__sub).not.toBeNull();
    music.__sub?.onLead({ pitch: 'C5', duration: '8n', velocity: 0.8, time: 0 });
    music.__sub?.onChord({ notes: ['C4', 'E4', 'G4'], duration: '2n', time: 0 });
    music.__sub?.onKick(0);
    const lines = parent.querySelectorAll('.hs-term-line');
    // 1 banner + 3 events
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const kinds = Array.from(lines).map((l) => (l as HTMLElement).dataset.kind);
    expect(kinds).toContain('lead');
    expect(kinds).toContain('chord');
    expect(kinds).toContain('kick');
    term.unmount();
  });

  it('throttles gesture lines to ~one per 250 ms', () => {
    const term = new TerminalImpl();
    const hands = makeHands();
    term.mount(parent, { ...makeDeps(), hands });
    expect(hands.__cb).not.toBeNull();
    // Fire many gestures back-to-back.
    for (let i = 0; i < 10; i += 1) {
      hands.__cb?.(fullState({ meanHeight: i / 10 }));
    }
    const gestureLines = parent.querySelectorAll('.hs-term-line[data-kind="gesture"]');
    // Throttle window means at most a couple lines.
    expect(gestureLines.length).toBeLessThanOrEqual(2);
    term.unmount();
  });

  it('caps the line buffer at 60 entries', () => {
    const term = new TerminalImpl();
    const music = makeMusic();
    term.mount(parent, { ...makeDeps(), music });
    for (let i = 0; i < 80; i += 1) {
      music.__sub?.onKick(0);
    }
    const lines = parent.querySelectorAll('.hs-term-line');
    expect(lines.length).toBeLessThanOrEqual(60);
    term.unmount();
  });

  it('setVisible toggles the hidden attribute', () => {
    const term = new TerminalImpl();
    term.mount(parent, makeDeps());
    const root = parent.querySelector('.hs-terminal') as HTMLElement;
    term.setVisible(true);
    expect(root.hidden).toBe(false);
    term.setVisible(false);
    expect(root.hidden).toBe(true);
    term.unmount();
  });

  it('unmount unsubscribes from music and hands', () => {
    const term = new TerminalImpl();
    const music = makeMusic();
    const hands = makeHands();
    term.mount(parent, { ...makeDeps(), music, hands });
    expect(music.__sub).not.toBeNull();
    expect(hands.__cb).not.toBeNull();
    term.unmount();
    expect(music.__sub).toBeNull();
    expect(hands.__cb).toBeNull();
  });
});
