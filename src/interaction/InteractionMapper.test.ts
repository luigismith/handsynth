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
  Hand,
  HandShape,
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
import { FACTORY_PRESETS } from '@presets/factory-presets';

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
    setKey: (_t: string) => undefined,
    setMode: (_m: string) => undefined,
    setScale: (_t: string, _m: string) => undefined,
    clearScaleOverride: () => null,
    getCurrentScale: () => null,
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
    eyeOpenLeft: 0.5,
    eyeOpenRight: 0.5,
    eyesWide: 0,
    smile: 0,
    frown: 0,
    surprise: 0,
    anger: 0,
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

  it('maps right/left openness to expected ranges (endpoints unchanged)', () => {
    // Endpoints must hit exact min/max — perceptual curves only reshape the
    // middle. Both x=0 and x=1 are pinned by the gamma curve identity
    // (0^k = 0, 1^k = 1).
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

  it('PROGRESSION: openness mapping is strictly monotonic and never plateaus', () => {
    // Regression for "fist close/open isn't progressive": every increment of
    // openness must produce a strictly greater audio param value across the
    // whole 0..1 range. No dead zones, no equal-output runs.
    let prevWet = -Infinity;
    let prevFb = -Infinity;
    let prevDrive = -Infinity;
    let prevQ = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      const r = __testing.mapRightOpenness(x);
      const l = __testing.mapLeftOpenness(x);
      expect(r.reverbWet).toBeGreaterThan(prevWet);
      expect(r.delayFeedback).toBeGreaterThan(prevFb);
      expect(l.saturatorDrive).toBeGreaterThan(prevDrive);
      expect(l.filterResonance).toBeGreaterThan(prevQ);
      prevWet = r.reverbWet;
      prevFb = r.delayFeedback;
      prevDrive = l.saturatorDrive;
      prevQ = l.filterResonance;
    }
  });

  it('PROGRESSION: gamma<1 mappings push more wetness/drive into the early opening', () => {
    // At openness = 0.3 (just-cracked-open hand), the user should already
    // hear a meaningful slice of the wet/drive range, not just 30% of it.
    const r = __testing.mapRightOpenness(0.3);
    // Linear lerp would give 0.1 + 0.3*0.75 = 0.325. Gamma 0.7 lifts it to
    // 0.1 + 0.3^0.7 * 0.75 ≈ 0.420. Assert we're meaningfully above linear.
    expect(r.reverbWet).toBeGreaterThan(0.4);

    const l = __testing.mapLeftOpenness(0.3);
    // Drive: linear 0.8 + 0.3*1.8 = 1.34; gamma 0.75 ≈ 0.8 + 0.3^0.75 * 1.8 ≈ 1.530.
    expect(l.saturatorDrive).toBeGreaterThan(1.45);
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

  // Removed: 2 eyesWide tests for the deleted Superman laser-eye feature.
  // The eyesWide scalar is still emitted by FaceTracker for back-compat
  // but no longer drives any audio param.

  it('eyesWide=1 no longer affects reverbWet or filterResonance (feature removed)', () => {
    // Regression: prove the old laser-eye audio bump is gone. Pinning this
    // so a future change can't silently re-introduce the mapping.
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    face.emit('face:update', blankFace({ eyesWide: 0 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const baselineReverb =
      audio.paramCalls
        .map((p) => p.reverbWet)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const baselineQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    face.emit('face:update', blankFace({ eyesWide: 1 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const wideReverb =
      audio.paramCalls
        .map((p) => p.reverbWet)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const wideQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    // No-op: eyesWide should not change anything anymore.
    expect(wideReverb).toBeCloseTo(baselineReverb, 5);
    expect(wideQ).toBeCloseTo(baselineQ, 5);
    mapper.stop();
  });

  // -------------------------------------------------------------------------
  // Expression mapping: smile / frown / surprise / anger.
  // -------------------------------------------------------------------------

  it('smile=1 lifts brightness and reduces masterDuck', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    // Baseline: no smile.
    face.emit('face:update', blankFace({ smile: 0 }));
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());
    const baseBright =
      audio.paramCalls
        .map((p) => p.brightness)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    // Smile=1 -> brightness rises by 0.2 (clamped to 1).
    face.emit('face:update', blankFace({ smile: 1 }));
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());
    const smileBright =
      audio.paramCalls
        .map((p) => p.brightness)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(smileBright - baseBright).toBeGreaterThan(0.15);

    // masterDuck should be at or below 0 (clamped to 0 since no other lift).
    const lastDuck =
      audio.paramCalls
        .map((p) => p.masterDuck)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 1;
    expect(lastDuck).toBeLessThanOrEqual(0.001);
    mapper.stop();
  });

  it('frown=1 pulls filterCutoff toward 1500 Hz floor', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    face.emit('face:update', blankFace({ frown: 1 }));
    // Hands wide apart so the baseline cutoff would be high (~12 kHz).
    hands.emit('gesture:update', blankState({ handsDistance3D: 1 }));
    hands.emit('gesture:update', blankState({ handsDistance3D: 1 }));

    const cutoff =
      audio.paramCalls
        .map((p) => p.filterCutoff)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    // Full frown -> cutoff = lerp(baseline, 1500, 1) = 1500.
    expect(cutoff).toBeCloseTo(1500, 0);
    mapper.stop();
  });

  it('surprise=1 boosts reverbWet and delayFeedback', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    // Baseline (surprise=0).
    face.emit('face:update', blankFace({ surprise: 0 }));
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());
    const baseReverb =
      audio.paramCalls
        .map((p) => p.reverbWet)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const baseFb =
      audio.paramCalls
        .map((p) => p.delayFeedback)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    face.emit('face:update', blankFace({ surprise: 1 }));
    hands.emit('gesture:update', blankState());
    hands.emit('gesture:update', blankState());
    const wReverb =
      audio.paramCalls
        .map((p) => p.reverbWet)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const wFb =
      audio.paramCalls
        .map((p) => p.delayFeedback)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(wReverb - baseReverb).toBeGreaterThan(0.2);
    expect(wFb - baseFb).toBeGreaterThan(0.05);
    mapper.stop();
  });

  it('anger=1 lifts saturatorDrive and filterResonance (clamped)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    const face = makeFaceStub();
    mapper.attach({ audio, music, hands, face });
    mapper.setVibe(VIBE);
    mapper.start();

    face.emit('face:update', blankFace({ anger: 0 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const baseDrive =
      audio.paramCalls
        .map((p) => p.saturatorDrive)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const baseQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    face.emit('face:update', blankFace({ anger: 1 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const wDrive =
      audio.paramCalls
        .map((p) => p.saturatorDrive)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    const wQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(wDrive - baseDrive).toBeGreaterThan(0.4);
    expect(wDrive).toBeLessThanOrEqual(2.6); // DRIVE_MAX
    expect(wQ - baseQ).toBeGreaterThan(4);
    expect(wQ).toBeLessThanOrEqual(14); // Q_MAX
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
    // hand-driven. Right openness 0.5 → gamma 0.7 curve t=0.5^0.7=0.616 →
    // reverbWet = lerp(0.1, 0.85, 0.616) ≈ 0.562. (Perceptual curve added
    // to make the closing-fist progression feel smoother edge-to-edge.)
    const lastParams = audio.paramCalls[audio.paramCalls.length - 1]!;
    expect(lastParams.masterDuck).toBe(0);
    expect(lastParams.reverbWet).toBeCloseTo(0.562, 2);

    // Mood/intensity should be hand-only (no pitch boost).
    const lastInput = music.inputCalls[music.inputCalls.length - 1]!;
    expect(lastInput.intensity).toBeCloseTo(0.725, 2); // INTENSITY_FLOOR + 0.5*(1-floor)
    mapper.stop();
  });
});

// ---------------------------------------------------------------------------
// Discrete gesture events (driven via the internal GestureInterpreter)
//
// We drive the mapper by emitting synthetic GestureStates whose `hands` carry
// pre-classified `shape` values. The interpreter consumes those and emits
// gesture events back into the mapper. We assert on:
//   - The downstream audio.setParams contributions of each pulse-style shape
//   - Single-shot triggers (finger_gun, call_me, snap)
//   - Factory preset cycling on swipe / shape (thumbs_down, three, four)
// ---------------------------------------------------------------------------

function shapedHand(side: 'left' | 'right', shape: HandShape, x = 0.5, y = 0.5): Hand {
  // Provide a 21-landmark array good enough for the GestureInterpreter's
  // velocity bookkeeping. Geometry doesn't matter for shape classification
  // because we pass `shape` directly on the Hand.
  const lm = Array.from({ length: 21 }, (_, i) => ({
    x: i === 0 ? x : x + (i % 5) * 0.02,
    y: i === 0 ? y + 0.2 : y - (i % 5) * 0.05,
    z: 0,
  }));
  return {
    side,
    landmarks: lm,
    palmCenter: { x, y, z: 0 },
    openness: 0.5,
    pinch: 0.5,
    isClosed: false,
    depth: 0,
    roll: 0,
    pitch: 0,
    shape,
  };
}

function shapedState(shape: HandShape, side: 'left' | 'right' = 'right'): GestureState {
  const hand = shapedHand(side, shape);
  return blankState({ hands: [hand] });
}

function emitShapeFor3Frames(
  hands: ReturnType<typeof makeHandsStub>,
  state: GestureState,
): void {
  for (let i = 0; i < 3; i += 1) hands.emit('gesture:update', state);
}

describe('InteractionMapper discrete gestures', () => {
  it('point shape_enter spikes filter Q above the steady-state value', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Baseline frame to record the steady-state Q at leftOpenness=0.5.
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const baseQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    // 3 frames of point with same leftOpenness — the interpreter fires
    // shape_enter on the 3rd frame; the next gesture-update applies the
    // pulse contribution.
    const state = blankState({
      leftOpenness: 0.5,
      hands: [shapedHand('right', 'point')],
    });
    emitShapeFor3Frames(hands, state);

    const lastQ =
      audio.paramCalls
        .map((p) => p.filterResonance)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(lastQ).toBeGreaterThan(baseQ + 1);
    mapper.stop();
  });

  it('rock_on shape_enter pulses saturatorDrive upward', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    hands.emit('gesture:update', blankState({ leftOpenness: 0.5 }));
    const baseDrive =
      audio.paramCalls
        .map((p) => p.saturatorDrive)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    const state = blankState({
      leftOpenness: 0.5,
      hands: [shapedHand('right', 'rock_on')],
    });
    emitShapeFor3Frames(hands, state);

    const lastDrive =
      audio.paramCalls
        .map((p) => p.saturatorDrive)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(lastDrive).toBeGreaterThan(baseDrive + 0.1);
    mapper.stop();
  });

  it('ok shape_enter pulses delayFeedback upward', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState({ rightOpenness: 0.4 }));
    hands.emit('gesture:update', blankState({ rightOpenness: 0.4 }));
    const baseFb =
      audio.paramCalls
        .map((p) => p.delayFeedback)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    const state = blankState({
      rightOpenness: 0.4,
      hands: [shapedHand('right', 'ok')],
    });
    emitShapeFor3Frames(hands, state);

    const lastFb =
      audio.paramCalls
        .map((p) => p.delayFeedback)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(lastFb).toBeGreaterThan(baseFb + 0.1);
    mapper.stop();
  });

  it('peace shape_enter lifts brightness (vibrato approximation)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    hands.emit('gesture:update', blankState({ meanHeight: 0.4 }));
    hands.emit('gesture:update', blankState({ meanHeight: 0.4 }));
    const baseB =
      audio.paramCalls
        .map((p) => p.brightness)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;

    const state = blankState({
      meanHeight: 0.4,
      hands: [shapedHand('right', 'peace')],
    });
    emitShapeFor3Frames(hands, state);

    const lastB =
      audio.paramCalls
        .map((p) => p.brightness)
        .filter((v): v is number => typeof v === 'number')
        .pop() ?? 0;
    expect(lastB).toBeGreaterThan(baseB + 0.05);
    mapper.stop();
  });

  it('finger_gun shape_enter triggers a lead stab (or fallback stab)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    emitShapeFor3Frames(hands, shapedState('finger_gun'));
    expect(audio.leadCalls.length + audio.stabCalls).toBeGreaterThanOrEqual(1);
    mapper.stop();
  });

  it('call_me shape_enter triggers a percussion one-shot', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // We replace triggerPerc with a counter to assert it's called.
    let perc = 0;
    audio.triggerPerc = () => {
      perc += 1;
    };
    emitShapeFor3Frames(hands, shapedState('call_me'));
    expect(perc).toBe(1);
    mapper.stop();
  });

  it('thumbs_down loads the INIT factory preset onto setParams', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    const init = FACTORY_PRESETS.find((p) => p.id === 'init');
    expect(init).toBeDefined();
    emitShapeFor3Frames(hands, shapedState('thumbs_down'));
    // The setParams call resulting from the preset push should match
    // INIT's filterCutoff = 8000.
    const cutoffs = audio.paramCalls
      .map((p) => p.filterCutoff)
      .filter((v): v is number => typeof v === 'number');
    expect(cutoffs).toContain(init!.params.filterCutoff);
    mapper.stop();
  });

  it('three / four shape_enter loads factory preset slots 3 / 4', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    const slot3 = FACTORY_PRESETS[2]!;
    emitShapeFor3Frames(hands, shapedState('three'));
    const cutoffs = audio.paramCalls
      .map((p) => p.filterCutoff)
      .filter((v): v is number => typeof v === 'number');
    expect(cutoffs).toContain(slot3.params.filterCutoff);
    mapper.stop();
  });

  it('thumbs_up logs a save message instead of throwing (no public savePatch)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitShapeFor3Frames(hands, shapedState('thumbs_up'));
    // Look for our specific log marker.
    const calls = spy.mock.calls.flat();
    expect(calls.some((c) => typeof c === 'string' && c.includes('thumbs_up'))).toBe(true);
    spy.mockRestore();
    mapper.stop();
  });

  it('left-hand shape_enter is ignored by the right-hand-only mappings', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    let perc = 0;
    audio.triggerPerc = () => {
      perc += 1;
    };
    // call_me on the LEFT hand → ignored (right-only per the brief).
    emitShapeFor3Frames(hands, blankState({ hands: [shapedHand('left', 'call_me')] }));
    expect(perc).toBe(0);
    mapper.stop();
  });

  it('pulseAmount helper produces 1 at start, 0 at end, linear decay between', () => {
    expect(__testing.pulseAmount(null, 100, 1000)).toBe(0);
    expect(__testing.pulseAmount(0, 0, 1000)).toBe(1);
    expect(__testing.pulseAmount(0, 500, 1000)).toBeCloseTo(0.5, 5);
    expect(__testing.pulseAmount(0, 1000, 1000)).toBe(0);
    expect(__testing.pulseAmount(0, 2000, 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Audio-glitch regressions
//
// These guard the recent mitigations: the wave LFO must not produce a fresh
// brightness ramp on every gesture frame, and AudioEngine must not fan out a
// brightness change to the lead voice when the delta is below the lead's
// perceptual epsilon.
// ---------------------------------------------------------------------------

describe('InteractionMapper audio-glitch regressions', () => {
  it('wave LFO does not push a unique brightness on every frame at 24 Hz', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Drive a wave gesture: fully-active wave_level = 1 (route via the
    // public surface — emit an open_palm hand and let the interpreter
    // fire wave_level events). We don't need the interpreter to fire the
    // wave; we can poke the internal state directly through the public
    // event surface using the gesture-event path. Easiest: directly
    // simulate a long sequence of identical gesture-update frames AFTER
    // starting a wave by calling handleGestureEvent via the mapper's
    // internal subscribe path. Since handleGestureEvent is private, we
    // exercise it by sending a synthetic GestureEvent through the
    // interpreter listener: wave_level events come from the interpreter
    // when palm.x oscillates; for the purpose of this regression test we
    // just need a non-zero waveLevel during the frame loop. We do that by
    // directly manipulating the (private) field via cast — this is only
    // a test-fixture, NOT production code.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mapper as any).waveLevel = 1.0;

    // Use real wall-clock — but cap the loop so the LFO has time to swing
    // through a full cycle (200 ms at 5 Hz). At 24 Hz frame rate that's
    // ~5 frames. We expect FEWER than 5 unique brightness-change pushes
    // for the wave LFO contribution, because the sample-and-hold
    // quantises sin into {-1, 0, +1} — at most one transition per quarter
    // cycle = 2 transitions per 200 ms.
    const start = performance.now();
    let frame = 0;
    while (performance.now() - start < 220) {
      hands.emit('gesture:update', blankState({ meanHeight: 0.5 }));
      frame += 1;
      if (frame > 12) break; // bound the loop in case the host is fast
    }

    // Count brightness pushes whose value isn't equal to the previous push
    // (the diffParams in the mapper already gates equal pushes, but a
    // continuous Math.sin would still push every frame because each frame's
    // value would differ slightly).
    const brightnessSeq = audio.paramCalls
      .map((p) => p.brightness)
      .filter((v): v is number => typeof v === 'number');
    let transitions = 0;
    for (let i = 1; i < brightnessSeq.length; i += 1) {
      if (Math.abs(brightnessSeq[i]! - brightnessSeq[i - 1]!) > 0.001) {
        transitions += 1;
      }
    }
    // Pre-fix this would be ≈ frame count (every frame pushes a fresh sin
    // value). Post-fix the sample-and-hold caps it at the LFO half-cycle
    // rate. We assert the cap is at most 4 transitions over 220 ms.
    expect(transitions).toBeLessThanOrEqual(4);
    mapper.stop();
  });

  it('wave LFO bypassed when waveLevel <= 0.01 (no extra pushes)', () => {
    const mapper = new InteractionMapperImpl();
    const audio = makeAudioStub();
    const music = makeMusicStub();
    const hands = makeHandsStub();
    mapper.attach({ audio, music, hands });
    mapper.setVibe(VIBE);
    mapper.start();

    // Default: waveLevel=0.
    hands.emit('gesture:update', blankState({ meanHeight: 0.5 }));
    hands.emit('gesture:update', blankState({ meanHeight: 0.5 }));
    const beforeBrightness = audio.paramCalls
      .map((p) => p.brightness)
      .filter((v): v is number => typeof v === 'number');
    // Steady-state meanHeight=0.5 and no wave should freeze brightness
    // pushes after the first frame (subsequent frames are inside ε).
    // We assert that at most 2 unique brightness values were pushed.
    const uniq = new Set(beforeBrightness);
    expect(uniq.size).toBeLessThanOrEqual(2);
    mapper.stop();
  });
});
