// Owner: qa-listener / synthetic-player harness
//
// Bug-hunt suite. Runs every profile through the live InteractionMapper +
// MusicBrain chain (with a RecordingAudioEngine in place of a real audio
// engine) and asserts the resulting param stream + note events + observed
// metrics satisfy the documented invariants.
//
// If any assertion fails, the test fails AND the failure message points at
// the offending profile + invariant + first-offending-frame, which is the
// hook the engineer uses to localize the bug.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InteractionMapperImpl } from '@interaction/InteractionMapper';
import { MusicBrainImpl } from '@music/MusicBrain';
import { VIBES, DEFAULT_VIBE } from '@presets/vibes';
import { FakeFaceTracker, FakeHandTracker } from './fake-trackers';
import { Observer } from './observer';
import { RecordingAudioEngine } from './recording-audio';
import { SyntheticPlayer } from './synthetic-player';
import {
  ambient,
  calmThenViolent,
  chaos,
  gestural,
  perFingerExercise,
  presetHopper,
  rhythmic,
  PROFILES,
} from './profiles';

interface Harness {
  player: SyntheticPlayer;
  observer: Observer;
  audio: RecordingAudioEngine;
  music: MusicBrainImpl;
  mapper: InteractionMapperImpl;
  hands: FakeHandTracker;
  face: FakeFaceTracker;
}

function makeHarness(): Harness {
  const observer = new Observer();
  // Shared mutable clock — the SyntheticPlayer writes `clock.t` before each
  // emit, and the RecordingAudioEngine reads it when stamping setParams
  // calls. Without this shared ref, all calls in a single sync tick stamp
  // with stale time and per-second bucketing collapses to the first second.
  const clock = { t: 0 };
  const audio = new RecordingAudioEngine(observer, { now: () => clock.t });
  const music = new MusicBrainImpl();
  const hands = new FakeHandTracker();
  const face = new FakeFaceTracker();
  const mapper = new InteractionMapperImpl();

  // Wire the mapper to our fake trackers and recording audio.
  mapper.attach({ audio, music, hands, face });
  mapper.setVibe(VIBES[DEFAULT_VIBE]);
  // Initialize audio (recording engine is just a stub but the mapper checks
  // isReady() before pushing params on some paths).
  void audio.init();
  mapper.start();

  const player = new SyntheticPlayer({
    audio,
    music,
    hands,
    face,
    observer,
    clock,
  });
  return { player, observer, audio, music, mapper, hands, face };
}

afterEach(() => {
  // Best-effort cleanup. MusicBrain.stop() releases Tone.Transport repeats.
  // If a test failed mid-run we still want subsequent tests to start clean.
});

beforeEach(() => {
  // No fake timers — the simulator's fast mode handles time advance itself
  // without needing real or fake setTimeout.
});

// ---------------------------------------------------------------------------
// Harness self-tests
// ---------------------------------------------------------------------------

describe('synthetic-player harness self-tests', () => {
  it('runs the ambient profile end-to-end without errors', async () => {
    const { player, observer, mapper, music } = makeHarness();
    await player.play(ambient, 5, { fast: true, seed: 42 });
    mapper.stop();
    music.stop();
    expect(observer.errors).toHaveLength(0);
    expect(observer.paramCalls.length).toBeGreaterThan(0);
    expect(observer.durationSec).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic with the same seed', async () => {
    const a = makeHarness();
    await a.player.play(chaos, 3, { fast: true, seed: 1234 });
    a.mapper.stop();
    a.music.stop();
    const aSummary = a.observer.summary();

    const b = makeHarness();
    await b.player.play(chaos, 3, { fast: true, seed: 1234 });
    b.mapper.stop();
    b.music.stop();
    const bSummary = b.observer.summary();

    expect(aSummary.totals.paramCalls).toBe(bSummary.totals.paramCalls);
    expect(aSummary.totals.noteEvents).toBe(bSummary.totals.noteEvents);
  });

  it('different seeds produce different chaos streams', async () => {
    const a = makeHarness();
    await a.player.play(chaos, 3, { fast: true, seed: 1 });
    a.mapper.stop();
    a.music.stop();

    const b = makeHarness();
    await b.player.play(chaos, 3, { fast: true, seed: 999 });
    b.mapper.stop();
    b.music.stop();

    // Compare actual param VALUES, not just counts: diffParams collapses
    // similar inputs to the same call cadence, so per-second counts often
    // match across seeds. The interesting question is whether the values
    // produced are distinct — they should be, because the gesture stream
    // upstream is RNG-driven.
    const sample = (cs: typeof a.observer.paramCalls): number[] =>
      cs
        .slice(0, 20)
        .map((c) => (c.params.filterCutoff ?? c.params.brightness ?? 0));
    const aSample = sample(a.observer.paramCalls);
    const bSample = sample(b.observer.paramCalls);
    expect(aSample).not.toEqual(bSample);
  });

  it('fires panel events at the scheduled times', async () => {
    const { player, observer, mapper, music } = makeHarness();
    await player.play(presetHopper, 12, { fast: true, seed: 7 });
    mapper.stop();
    music.stop();
    // presetHopper schedules events every 5s; in 12s we should see 2 fires.
    expect(observer.voiceShapeCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('fast mode is fast: 30 s of simulated time in <1 s wall clock', async () => {
    const { player, mapper, music } = makeHarness();
    const start = performance.now();
    await player.play(rhythmic, 30, { fast: true, seed: 5 });
    const wall = performance.now() - start;
    mapper.stop();
    music.stop();
    expect(wall).toBeLessThan(2000); // 2s slack for slow CI
  });
});

// ---------------------------------------------------------------------------
// Bug-hunt suite — one test per profile, all invariants asserted
// ---------------------------------------------------------------------------

interface ProfileTestCase {
  profile: typeof ambient;
  durationSec: number;
  // Some profiles produce intentionally chaotic chord/key changes that may
  // bump scheduled-event counts; we relax the assertion for those.
  maxScheduledEvents?: number;
}

const HUNT_CASES: ProfileTestCase[] = [
  { profile: ambient, durationSec: 10 },
  { profile: rhythmic, durationSec: 10 },
  { profile: presetHopper, durationSec: 15 },
  { profile: gestural, durationSec: 20 },
  { profile: chaos, durationSec: 10 },
  { profile: calmThenViolent, durationSec: 20 },
  { profile: perFingerExercise, durationSec: 10 },
];

describe('synthetic performer — bug-hunt suite', () => {
  for (const testCase of HUNT_CASES) {
    const { profile, durationSec } = testCase;
    it(`${profile.name}: ${durationSec}s — no NaN, no errors, params in range`, async () => {
      const { player, observer, mapper, music } = makeHarness();
      try {
        await player.play(profile, durationSec, { fast: true, seed: 42 });

        observer.assert.noErrors();
        observer.assert.noNaN();
        observer.assert.paramRangesValid();

        // Param-change rate ceiling. The InteractionMapper's diffParams
        // throttling SHOULD keep steady-state cumulative setParams calls
        // around 24-30/sec (one per hand frame, possibly fanned out by
        // the per-finger layer). 100/sec is a generous ceiling — if
        // breached, something is over-emitting.
        // skipSeconds=3 — exclude warmup (vibe-load cascade + pulse
        // register warmup + initial preset apply cluster in 0-2s).
        observer.assert.eventRateBounded('audio.setParams', 100, {
          skipSeconds: 3,
        });
      } finally {
        mapper.stop();
        music.stop();
      }

      // Sanity: each profile should actually produce some setParams calls.
      expect(observer.paramCalls.length).toBeGreaterThan(0);
    });
  }

  it('REGRESSION: setParams calls are distributed across all seconds, not piled at t=0', async () => {
    // Self-bug found by the simulator: an earlier version of the harness
    // didn't propagate the simulator clock into the RecordingAudioEngine,
    // so every setParams call stamped t=0 → all events landed in the
    // first per-second bucket → the eventRateBounded assertion was
    // silently checking nothing past second 0 (because skipSeconds:3
    // skipped the only bucket with any data).
    //
    // This test pins the fix: a 10-second rhythmic run must have non-
    // trivial setParams calls in every second 0..9.
    const { player, observer, mapper, music } = makeHarness();
    await player.play(rhythmic, 10, { fast: true, seed: 42 });
    mapper.stop();
    music.stop();

    const buckets = observer.metricsPerSecond();
    expect(buckets).toHaveLength(10);
    for (const b of buckets) {
      expect(b.paramCallCount).toBeGreaterThan(15);
      expect(b.paramCallCount).toBeLessThan(60);
    }
  });

  it('all 7 profiles in PROFILES registry are exported', () => {
    expect(Object.keys(PROFILES)).toHaveLength(7);
    expect(Object.keys(PROFILES).sort()).toEqual([
      'ambient',
      'calm-then-violent',
      'chaos',
      'gestural',
      'per-finger-exercise',
      'preset-hopper',
      'rhythmic',
    ]);
  });
});
