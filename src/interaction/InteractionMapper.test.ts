// Owner: interaction-mapper
//
// Unit tests for InteractionMapperImpl. Mocks AudioEngine, MusicBrain, and
// HandTracker with simple stubs so we can drive synthetic gesture states
// through the public surface and assert what gets pushed downstream.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AudioEngine,
  AudioEngineParams,
  ChordEvent,
  FaceState,
  FaceTracker,
  FaceTrackerEvents,
  GestureState,
  HandTracker,
  HandTrackerEvents,
  MusicBrain,
  MusicBrainEvents,
  MusicBrainInput,
  NoteEvent,
  VibePreset,
} from '@contracts/contracts';
import { InteractionMapperImpl, __testing } from './InteractionMapper';
import { VIBES } from '@presets/vibes';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

type AudioStub = AudioEngine & {
  paramCalls: Partial<AudioEngineParams>[];
  leadCalls: NoteEvent[];
  bassCalls: NoteEvent[];
  chordCalls: ChordEvent[];
  stabCalls: number;
  muteCalls: boolean[];
  dropCalls: boolean[];
};

function makeAudioStub(): AudioStub {
  const stub = {
    paramCalls: [] as Partial<AudioEngineParams>[],
    leadCalls: [] as NoteEvent[],
    bassCalls: [] as NoteEvent[],
    chordCalls: [] as ChordEvent[],
    stabCalls: 0,
    muteCalls: [] as boolean[],
    dropCalls: [] as boolean[],
    init: () => Promise.resolve(),
    loadVibe: () => undefined,
    triggerLead: (e: NoteEvent) => {
      stub.leadCalls.push(e);
    },
    triggerBass: (e: NoteEvent) => {
      stub.bassCalls.push(e);
    },
    triggerChord: (e: ChordEvent) => {
      stub.chordCalls.push(e);
    },
    triggerKick: () => undefined,
    triggerHat: () => undefined,
    triggerPerc: () => undefined,
    triggerStab: () => {
      stub.stabCalls += 1;
    },
    setParams: (p: Partial<AudioEngineParams>) => {
      stub.paramCalls.push({ ...p });
    },
    setMute: (m: boolean) => {
      stub.muteCalls.push(m);
    },
    triggerDrop: (a: boolean) => {
      stub.dropCalls.push(a);
    },
    getAnalyser: () => ({}) as AnalyserNode,
    isReady: () => true,
  };
  return stub;
}

type MusicStub = MusicBrain & {
  inputCalls: MusicBrainInput[];
  advanceCalls: number;
  subscriber: MusicBrainEvents | null;
};

function makeMusicStub(): MusicStub {
  const stub = {
    inputCalls: [] as MusicBrainInput[],
    advanceCalls: 0,
    subscriber: null as MusicBrainEvents | null,
    start: () => undefined,
    stop: () => undefined,
    setInput: (i: MusicBrainInput) => {
      stub.inputCalls.push(i);
    },
    advanceChord: () => {
      stub.advanceCalls += 1;
    },
    on: (e: MusicBrainEvents) => {
      stub.subscriber = e;
    },
    off: (e: MusicBrainEvents) => {
      if (stub.subscriber === e) stub.subscriber = null;
    },
  };
  return stub;
}

function makeHandsStub(): HandTracker & {
  emit: <K extends keyof HandTrackerEvents>(
    evt: K,
    ...args: Parameters<HandTrackerEvents[K]>
  ) => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Map<keyof HandTrackerEvents, Set<any>> = new Map();
  const tracker: HandTracker = {
    init: () => Promise.resolve(),
    start: () => undefined,
    stop: () => undefined,
    on: (evt, cb) => {
      let set = listeners.get(evt);
      if (!set) {
        set = new Set();
        listeners.set(evt, set);
      }
      set.add(cb);
    },
    off: (evt, cb) => {
      listeners.get(evt)?.delete(cb);
    },
  };
  return Object.assign(tracker, {
    emit: <K extends keyof HandTrackerEvents>(
      evt: K,
      ...args: Parameters<HandTrackerEvents[K]>
    ) => {
      const set = listeners.get(evt);
      if (!set) return;
      for (const cb of set) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cb as any)(...args);
      }
    },
  });
}

function makeFaceStub(): FaceTracker & {
  emit: <K extends keyof FaceTrackerEvents>(
    evt: K,
    ...args: Parameters<FaceTrackerEvents[K]>
  ) => void;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Map<keyof FaceTrackerEvents, Set<any>> = new Map();
  const tracker: FaceTracker = {
    init: () => Promise.resolve(),
    start: () => undefined,
    stop: () => undefined,
    on: (evt, cb) => {
      let set = listeners.get(evt);
      if (!set) {
        set = new Set();
        listeners.set(evt, set);
      }
      set.add(cb);
    },
    off: (evt, cb) => {
      listeners.get(evt)?.delete(cb);
    },
  };
  return Object.assign(tracker, {
    emit: <K extends keyof FaceTrackerEvents>(
      evt: K,
      ...args: Parameters<FaceTrackerEvents[K]>
    ) => {
      const set = listeners.get(evt);
      if (!set) return;
      for (const cb of set) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cb as any)(...args);
      }
    },
  });
}

function blankFace(over: Partial<FaceState> = {}): FaceState {
  return {
    detected: true,
    center: { x: 0.5, y: 0.5 },
    apparentSize: 0.5,
    pose: { yaw: 0, pitch: 0, roll: 0, depth: 0 },
    mouthOpen: 0,
    browRaise: 0,
    noFaceDuration: 0,
    ...over,
  };
}

function blankState(over: Partial<GestureState> = {}): GestureState {
  return {
    hands: [],
    bothHandsDetected: true,
    handsDistance: 0.5,
    meanHeight: 0.5,
    rightOpenness: 0.5,
    leftOpenness: 0.5,
    rightPinchActive: false,
    leftPinchActive: false,
    bothFists: false,
    bothAboveHead: false,
    fingerCount: 8,
    noHandsDuration: 0,
    // Default 3D fields chosen so they are "neutral" (zero contribution to
    // the additive 3D mappings): meanDepth=1 makes the masterDuck contribution
    // 0; the rolls/pitch are zero by definition. handsDistance3D mirrors the
    // 2D handsDistance default so cutoff math is consistent.
    meanDepth: 1,
    rightRoll: 0,
    leftRoll: 0,
    handsDistance3D: 0.5,
    meanPitch: 0,
    ...over,
  };
}

const VIBE: VibePreset = VIBES.tycho;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractionMapper helpers', () => {
  it('maps handsDistance=0 to ~200Hz, =1 to ~12000Hz logarithmically', () => {
    expect(__testing.mapDistanceToCutoff(0)).toBeCloseTo(200, 0);
    expect(__testing.mapDistanceToCutoff(1)).toBeCloseTo(12000, 0);
    // Midpoint should be roughly the geometric mean (~1549 Hz).
    const mid = __testing.mapDistanceToCutoff(0.5);
    expect(mid).toBeGreaterThan(1200);
    expect(mid).toBeLessThan(2000);
  });

  it('maps handsDistance=0.5 to a sane cutoff value pushed via setParams', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Push two updates so the every-other-frame throttle definitely fires.
    hands.emit('gesture:update', blankState({ handsDistance: 0.5 }));
    hands.emit('gesture:update', blankState({ handsDistance: 0.5 }));

    // Find the most recent setParams call that includes filterCutoff.
    const cutoffs = audio.paramCalls
      .map((p) => p.filterCutoff)
      .filter((v): v is number => typeof v === 'number');
    expect(cutoffs.length).toBeGreaterThan(0);
    const last = cutoffs[cutoffs.length - 1]!;
    expect(last).toBeGreaterThan(1200);
    expect(last).toBeLessThan(2000);
    mapper.stop();
  });

  it('maps right/left openness to expected ranges', () => {
    const r = __testing.mapRightOpenness(0);
    expect(r.reverbWet).toBeCloseTo(0.1, 5);
    expect(r.delayFeedback).toBeCloseTo(0.1, 5);
    const r1 = __testing.mapRightOpenness(1);
    expect(r1.reverbWet).toBeCloseTo(0.85, 5);
    expect(r1.delayFeedback).toBeCloseTo(0.7, 5);

    const l = __testing.mapLeftOpenness(0);
    expect(l.saturatorDrive).toBeCloseTo(0.8, 5);
    expect(l.filterResonance).toBeCloseTo(0.5, 5);
    const l1 = __testing.mapLeftOpenness(1);
    expect(l1.saturatorDrive).toBeCloseTo(2.6, 5);
    expect(l1.filterResonance).toBeCloseTo(14, 5);
  });
});

describe('InteractionMapper edge gestures', () => {
  let mapper: InteractionMapperImpl;
  let audio: ReturnType<typeof makeAudioStub>;
  let music: ReturnType<typeof makeMusicStub>;
  let hands: ReturnType<typeof makeHandsStub>;

  beforeEach(() => {
    mapper = new InteractionMapperImpl();
    audio = makeAudioStub();
    music = makeMusicStub();
    hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();
  });

  it('left pinch advances chord (with debounce)', () => {
    hands.emit('gesture:pinch-left');
    expect(music.advanceCalls).toBe(1);

    // Within the debounce window, a second pinch is suppressed.
    hands.emit('gesture:pinch-left');
    expect(music.advanceCalls).toBe(1);
  });

  it('right pinch falls back to triggerStab when no chord context', () => {
    hands.emit('gesture:pinch-right');
    expect(audio.stabCalls).toBe(1);
    expect(audio.leadCalls.length).toBe(0);
  });

  it('right pinch triggers harmony-aware stab when chord context is present', () => {
    // Simulate the music brain emitting a chord; the mapper's subscription
    // should record lastChordNotes from it.
    expect(music.subscriber).not.toBeNull();
    const chord: ChordEvent = {
      notes: ['C4', 'E4', 'G4', 'B4'],
      duration: '4m',
      time: 0,
    };
    music.subscriber!.onChord(chord);
    // Stab now should call triggerLead with a chord tone in octave 5.
    hands.emit('gesture:pinch-right');
    expect(audio.leadCalls.length).toBe(1);
    expect(audio.stabCalls).toBe(0);
    const stab = audio.leadCalls[0]!;
    expect(['C5', 'E5', 'G5', 'B5']).toContain(stab.pitch);
  });

  it('bothFists held mutes audio and unmutes on release', () => {
    hands.emit('gesture:update', blankState({ bothFists: true }));
    expect(audio.muteCalls).toEqual([true]);
    hands.emit('gesture:update', blankState({ bothFists: false }));
    expect(audio.muteCalls).toEqual([true, false]);
  });

  it('bothAboveHead held triggers drop, releases on next state', () => {
    hands.emit('gesture:update', blankState({ bothAboveHead: true }));
    expect(audio.dropCalls).toEqual([true]);
    hands.emit('gesture:update', blankState({ bothAboveHead: false }));
    expect(audio.dropCalls).toEqual([true, false]);
  });

  it('no-hands engages drone mode (low intensity, quiet pad params)', () => {
    hands.emit('gesture:no-hands');
    // music.setInput should have been called with intensity 0.15, mood calm.
    const last = music.inputCalls[music.inputCalls.length - 1]!;
    expect(last.intensity).toBeCloseTo(0.15, 5);
    expect(last.mood).toBe('calm');
    // and audio params should reflect the drone fade-down.
    const lastParams = audio.paramCalls[audio.paramCalls.length - 1]!;
    expect(lastParams.reverbWet).toBeCloseTo(0.7, 5);
    expect(lastParams.masterDuck).toBeCloseTo(0.4, 5);
  });
});

describe('InteractionMapper mood detection', () => {
  it('transitions toward "rising" when meanHeight ramps upward', async () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Synthesize a rising meanHeight series with real wall-clock spacing so
    // the mood window has time to populate.
    const start = performance.now();
    let ramp = 0.1;
    for (let i = 0; i < 16; i++) {
      hands.emit('gesture:update', blankState({ meanHeight: ramp }));
      ramp = Math.min(0.95, ramp + 0.06);
      // micro-wait so timestamps are monotonic and span the mood window.
      await new Promise((r) => setTimeout(r, 30));
      void start;
    }

    const mood = mapper.getCurrentMood();
    // Either 'rising' (mid-ramp) or 'peak' (if meanHeight stayed >0.7 for >1s).
    expect(['rising', 'peak']).toContain(mood);

    mapper.stop();
  });

  it('settles back to "calm" with steady low meanHeight', async () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    for (let i = 0; i < 10; i++) {
      hands.emit('gesture:update', blankState({ meanHeight: 0.2 }));
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(mapper.getCurrentMood()).toBe('calm');
    mapper.stop();
  });
});

describe('InteractionMapper lifecycle', () => {
  it('stop() unsubscribes from MusicBrain and HandTracker', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();
    expect(music.subscriber).not.toBeNull();

    mapper.stop();
    expect(music.subscriber).toBeNull();

    // After stop, gesture events no longer call into audio.
    const beforeCount = audio.paramCalls.length;
    hands.emit('gesture:update', blankState({ handsDistance: 0.9 }));
    hands.emit('gesture:update', blankState({ handsDistance: 0.9 }));
    expect(audio.paramCalls.length).toBe(beforeCount);
  });

  it('start() is idempotent', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();
    mapper.start(); // no throw, no double-subscribe
    // We can't easily assert listener count, but starting twice and emitting
    // once should call advanceChord once (one debounced edge).
    hands.emit('gesture:pinch-left');
    expect(music.advanceCalls).toBe(1);
    mapper.stop();
  });

  it('autopilot start/stop without throwing', () => {
    vi.useFakeTimers();
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();
    mapper.startAutopilot();
    vi.advanceTimersByTime(200);
    mapper.stopAutopilot();
    mapper.stop();
    vi.useRealTimers();
    // Autopilot should have produced at least one setParams call.
    expect(audio.paramCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Face integration
// ---------------------------------------------------------------------------

describe('InteractionMapper face integration', () => {
  it('apparentSize=1 (close face) drops reverbWet below 0.4', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    // Face very close → near-dry reverb. Push the face state first, then
    // drive a hand-gesture update so the param-push path runs.
    face.emit('face:update', blankFace({ apparentSize: 1 }));
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());

    const reverbs = audio.paramCalls
      .map((p) => p.reverbWet)
      .filter((v): v is number => typeof v === 'number');
    expect(reverbs.length).toBeGreaterThan(0);
    const last = reverbs[reverbs.length - 1]!;
    expect(last).toBeLessThan(0.4);
    mapper.stop();
  });

  it('mouth-open rising edge triggers a stab via the lead path', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    // Provide a chord context so the stab routes through triggerLead (the
    // harmony-aware path) rather than the bare triggerStab fallback.
    expect(music.subscriber).not.toBeNull();
    music.subscriber!.onChord({
      notes: ['C4', 'E4', 'G4', 'B4'],
      duration: '4m',
      time: 0,
    });

    // Mouth closed → no fire.
    face.emit('face:update', blankFace({ mouthOpen: 0.1 }));
    expect(audio.leadCalls.length).toBe(0);
    expect(audio.stabCalls).toBe(0);

    // Rising edge through threshold → one stab.
    face.emit('face:update', blankFace({ mouthOpen: 0.8 }));
    expect(audio.leadCalls.length + audio.stabCalls).toBe(1);

    // Holding above threshold → no re-fire.
    face.emit('face:update', blankFace({ mouthOpen: 0.85 }));
    expect(audio.leadCalls.length + audio.stabCalls).toBe(1);

    mapper.stop();
  });

  it('noFaceDuration > 1.5 s pushes masterDuck up via face contribution', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    // Face lost (detected=false, noFaceDuration big enough).
    face.emit(
      'face:update',
      blankFace({ detected: false, noFaceDuration: 2.0 }),
    );
    // Drive a couple of gesture frames so the throttled setParams pushes.
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());

    const ducks = audio.paramCalls
      .map((p) => p.masterDuck)
      .filter((v): v is number => typeof v === 'number');
    expect(ducks.length).toBeGreaterThan(0);
    expect(ducks[ducks.length - 1]!).toBeGreaterThan(0.1);
    mapper.stop();
  });

  // -------------------------------------------------------------------------
  // 3D gesture additions: depth → masterDuck, rolls → brightness/drive, pitch
  // → delayFeedback, handsDistance3D → cutoff. These are additive on top of
  // the hand-XY mapping, applied BEFORE face modulation.
  // -------------------------------------------------------------------------

  it('meanDepth=1 (close) produces target.masterDuck≈0', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState({ meanDepth: 1 }));
    hands.emit('gesture:update', blankState({ meanDepth: 1 }));

    const ducks = audio.paramCalls
      .map((p) => p.masterDuck)
      .filter((v): v is number => typeof v === 'number');
    expect(ducks.length).toBeGreaterThan(0);
    expect(ducks[ducks.length - 1]!).toBeCloseTo(0, 5);
    mapper.stop();
  });

  it('meanDepth=0 (far) produces target.masterDuck≈0.4', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState({ meanDepth: 0 }));
    hands.emit('gesture:update', blankState({ meanDepth: 0 }));

    const ducks = audio.paramCalls
      .map((p) => p.masterDuck)
      .filter((v): v is number => typeof v === 'number');
    expect(ducks.length).toBeGreaterThan(0);
    expect(ducks[ducks.length - 1]!).toBeCloseTo(0.4, 5);
    mapper.stop();
  });

  it('rightRoll=1 shifts brightness up by HAND_3D_BRIGHTNESS_GAIN (0.15)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // meanHeight=0.5 → baseline brightness=0.5; rightRoll=1 → +0.15 → 0.65.
    hands.emit('gesture:update', blankState({ meanHeight: 0.5, rightRoll: 1 }));
    hands.emit('gesture:update', blankState({ meanHeight: 0.5, rightRoll: 1 }));

    const brights = audio.paramCalls
      .map((p) => p.brightness)
      .filter((v): v is number => typeof v === 'number');
    expect(brights.length).toBeGreaterThan(0);
    expect(brights[brights.length - 1]!).toBeCloseTo(0.65, 5);
    mapper.stop();
  });

  it('handsDistance3D drives filterCutoff (not handsDistance)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Pin handsDistance to 0 (would map to ~200 Hz) and handsDistance3D to 1
    // (maps to ~12000 Hz). If 3D is the one that feeds cutoff, we should see
    // the high-end value, not the low-end.
    hands.emit(
      'gesture:update',
      blankState({ handsDistance: 0, handsDistance3D: 1 }),
    );
    hands.emit(
      'gesture:update',
      blankState({ handsDistance: 0, handsDistance3D: 1 }),
    );

    const cutoffs = audio.paramCalls
      .map((p) => p.filterCutoff)
      .filter((v): v is number => typeof v === 'number');
    expect(cutoffs.length).toBeGreaterThan(0);
    expect(cutoffs[cutoffs.length - 1]!).toBeGreaterThan(8000);
    mapper.stop();
  });

  it('without a FaceTracker, all face contributions are no-ops', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    // Note: no `face` in attach()
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());

    // masterDuck should sit at 0 (no face contribution); reverbWet should be
    // hand-driven (rightOpenness=0.5 -> ~0.475), with no face blend.
    const lastParams = audio.paramCalls[audio.paramCalls.length - 1]!;
    expect(lastParams.masterDuck).toBe(0);
    expect(lastParams.reverbWet).toBeCloseTo(0.475, 2);

    // Mood/intensity should be hand-only (no pitch boost).
    const lastInput = music.inputCalls[music.inputCalls.length - 1]!;
    expect(lastInput.intensity).toBeCloseTo(0.725, 2); // INTENSITY_FLOOR + 0.5*(1-floor)
    mapper.stop();
  });
});
