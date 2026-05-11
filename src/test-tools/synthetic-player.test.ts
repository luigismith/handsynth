// Owner: qa-listener / synthetic-player harness
//
// Unit tests for `SyntheticPlayer` itself — focused on the simulator's
// invariants (rate, ordering, determinism, panel-event timing) without
// involving the InteractionMapper or audio engine. The integration test
// file covers the end-to-end bug hunt.

import { describe, expect, it } from 'vitest';
import { FakeFaceTracker, FakeHandTracker } from './fake-trackers';
import { Observer } from './observer';
import { RecordingAudioEngine } from './recording-audio';
import { SyntheticPlayer } from './synthetic-player';
import { ambient, presetHopper } from './profiles';
import type { GestureState, MusicBrain } from '@contracts/contracts';

function makeStubMusic(): MusicBrain {
  // Minimal MusicBrain stub. SyntheticPlayer doesn't call it directly; only
  // panel events touch it, and the profiles in this file don't drive any
  // music-state changes.
  return {
    start: () => {},
    stop: () => {},
    setInput: () => {},
    setVibe: () => {},
    setIntensity: () => {},
    on: () => {},
    off: () => {},
  } as unknown as MusicBrain;
}

interface UnitHarness {
  player: SyntheticPlayer;
  observer: Observer;
  hands: FakeHandTracker;
  face: FakeFaceTracker;
  handCounts: number[];
  faceCounts: number[];
}

function makeUnitHarness(): UnitHarness {
  const observer = new Observer();
  let simTime = 0;
  const audio = new RecordingAudioEngine(observer, { now: () => simTime });
  void audio.init();
  const hands = new FakeHandTracker();
  const face = new FakeFaceTracker();
  const handCounts: number[] = [];
  const faceCounts: number[] = [];

  hands.on('gesture:update', (state: GestureState) => {
    handCounts.push(state.handsDistance);
  });
  face.on('face:update', () => {
    faceCounts.push(1);
  });

  // Drive simTime forward when the player emits.
  const origRecordParam = observer.recordParam.bind(observer);
  observer.recordParam = (t, p) => {
    simTime = Math.max(simTime, t);
    origRecordParam(t, p);
  };

  const player = new SyntheticPlayer({
    audio,
    music: makeStubMusic(),
    hands,
    face,
    observer,
  });

  return { player, observer, hands, face, handCounts, faceCounts };
}

describe('SyntheticPlayer — unit', () => {
  it('emits hand state at ~24 Hz', async () => {
    const h = makeUnitHarness();
    await h.player.play(ambient, 5, { fast: true, seed: 1 });
    // 5 seconds × 24 Hz = 120 emits, give or take 1 for boundary
    expect(h.handCounts.length).toBeGreaterThanOrEqual(118);
    expect(h.handCounts.length).toBeLessThanOrEqual(122);
  });

  it('emits face state at ~8 Hz', async () => {
    const h = makeUnitHarness();
    await h.player.play(ambient, 5, { fast: true, seed: 1 });
    expect(h.faceCounts.length).toBeGreaterThanOrEqual(38);
    expect(h.faceCounts.length).toBeLessThanOrEqual(42);
  });

  it('same seed gives identical hand-state sequence', async () => {
    const a = makeUnitHarness();
    await a.player.play(ambient, 3, { fast: true, seed: 2024 });
    const b = makeUnitHarness();
    await b.player.play(ambient, 3, { fast: true, seed: 2024 });
    expect(a.handCounts).toEqual(b.handCounts);
  });

  it('panel events fire in time order', async () => {
    const h = makeUnitHarness();
    await h.player.play(presetHopper, 12, { fast: true, seed: 3 });
    const tsAsc = h.observer.voiceShapeCalls.map((c) => c.t);
    const sorted = tsAsc.slice().sort((a, b) => a - b);
    expect(tsAsc).toEqual(sorted);
  });

  it('captures errors thrown inside profile generators', async () => {
    const h = makeUnitHarness();
    const broken = {
      name: 'broken',
      nextGestureState: () => {
        throw new Error('boom');
      },
      nextFaceState: () => undefined,
    } as Parameters<typeof h.player.play>[0];
    await h.player.play(broken, 1, { fast: true, seed: 0 });
    expect(h.observer.errors.length).toBeGreaterThan(0);
    expect(h.observer.errors[0]!.message).toBe('boom');
  });

  it('records the final simulated duration on the observer', async () => {
    const h = makeUnitHarness();
    await h.player.play(ambient, 7, { fast: true, seed: 1 });
    expect(h.observer.durationSec).toBeGreaterThanOrEqual(7);
    expect(h.observer.durationSec).toBeLessThan(7.1);
  });
});
