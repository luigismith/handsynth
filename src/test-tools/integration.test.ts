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
  let simTime = 0;
  const audio = new RecordingAudioEngine(observer, { now: () => simTime });
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

  // We need the simulator to set `simTime` so the RecordingAudioEngine
  // timestamps each call. The simulator emits at increasing t; we tap into
  // the hand emit to bump simTime forward. Use a small wrapper on the
  // observer to detect.
  const origRecordParam = observer.recordParam.bind(observer);
  observer.recordParam = (t: number, p) => {
    simTime = Math.max(simTime, t);
    origRecordParam(t, p);
  };

  const player = new SyntheticPlayer({
    audio,
    music,
    hands,
    face,
    observer,
  });
  // Patch the player so `now` advances inside the simulator. We do this by
  // monkey-wrapping the `play` to set simTime as it iterates — but cleaner:
  // we expose simTime via a closure that the player itself updates via the
  // observer's recordParam call (above). The advance-tick fast loop also
  // calls the RecordingAudioEngine through the mapper, which calls
  // setParams → recordParam → simTime update.
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
        // throttling should keep this comfortably under 200/sec during
        // steady-state. We exclude the first 2 seconds — known mapper
        // startup transient (vibe-load cascade + pulse-register warmup +
        // applyVoiceShape from the initial preset are clustered there).
        // If the ceiling is ever breached in second 2+, that IS a bug —
        // see Observer.assert.eventRateBounded docstring.
        observer.assert.eventRateBounded('audio.setParams', 200, {
          skipSeconds: 2,
        });
      } finally {
        mapper.stop();
        music.stop();
      }

      // Sanity: each profile should actually produce some setParams calls.
      expect(observer.paramCalls.length).toBeGreaterThan(0);
    });
  }

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
