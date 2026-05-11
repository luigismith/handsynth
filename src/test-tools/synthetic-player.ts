// Owner: qa-listener / synthetic-player harness
//
// The `SyntheticPlayer` is the main driver of the test harness. It mounts
// the live HandSynth subsystem chain (an InteractionMapper wired up to the
// fake trackers + the RecordingAudioEngine + a real MusicBrainImpl) and
// pushes synthetic GestureState/FaceState snapshots through it at the same
// rates the real trackers use:
//
//   - hand state:  24 Hz (every 41.66 ms)
//   - face state:   8 Hz (every 125 ms)
//
// Each profile defines what the snapshots LOOK like at any given simulator
// time. The simulator just drives the clock and forwards the snapshots.
//
// In `fast` mode the simulator advances simulated time in batches without
// blocking the wall clock — 60 seconds of simulated play takes <100 ms of
// real time. This is the mode the bug-hunt suite uses.
//
// In `live` mode the simulator uses real `setInterval` so a human can watch
// the visualizer / Terminal HUD react in real time. Useful for spot-checks.

import { mulberry32 } from './rng';
import type { Observer } from './observer';
import type {
  PlayProfile,
  SyntheticPlayerDeps,
} from './types';

const HAND_INTERVAL_SEC = 1 / 24;
const FACE_INTERVAL_SEC = 1 / 8;

export interface PlayOpts {
  /** Use a deterministic 1-second-step time advance (no real setTimeout). */
  fast?: boolean;
  /** Seed for the profile's RNG. */
  seed?: number;
}

export class SyntheticPlayer {
  private readonly deps: SyntheticPlayerDeps;
  private readonly observer: Observer;

  constructor(deps: SyntheticPlayerDeps & { observer: Observer }) {
    this.deps = deps;
    this.observer = deps.observer;
  }

  /**
   * Run `profile` for `durationSec` seconds of simulated time. Returns when
   * the simulation is complete. Pushes everything through the deps.hands /
   * deps.face emitters; the consumer (InteractionMapper, GestureInterpreter,
   * etc.) is unmodified.
   */
  async play(
    profile: PlayProfile,
    durationSec: number,
    opts: PlayOpts = {},
  ): Promise<void> {
    const seed = opts.seed ?? 0x1234abcd;
    const rng = mulberry32(seed);

    // panel-event scheduling: sort once, drain as we advance.
    const events = (profile.panelEvents ?? [])
      .slice()
      .sort((a, b) => a.atSec - b.atSec);
    let nextEventIdx = 0;

    // Tick scheduling: maintain the next-fire-time per stream. The simulator
    // advances time to whichever stream is next due, fires it, and moves on.
    let tHand = 0;
    let tFace = 0;
    let tNow = 0;

    const fireHand = (t: number): void => {
      try {
        const state = profile.nextGestureState(t, rng);
        this.deps.hands.emit('gesture:update', state);
        // Edge events: emit pinch / above-head / no-hands signals consistent
        // with the GestureState. The InteractionMapper reads both the
        // continuous state and the rising-edge channels.
        if (state.rightPinchActive) {
          this.deps.hands.emit('gesture:pinch-right');
        }
        if (state.leftPinchActive) {
          this.deps.hands.emit('gesture:pinch-left');
        }
        if (state.noHandsDuration > 0 && state.hands.length === 0) {
          this.deps.hands.emit('gesture:no-hands');
        }
      } catch (err) {
        this.observer.recordError({
          t,
          source: 'hand-emit',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    };

    const fireFace = (t: number): void => {
      try {
        const fs = profile.nextFaceState(t, rng);
        if (fs) {
          this.deps.face.emit('face:update', fs);
        }
      } catch (err) {
        this.observer.recordError({
          t,
          source: 'face-emit',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    };

    const drainEventsUpTo = (t: number): void => {
      while (
        nextEventIdx < events.length &&
        events[nextEventIdx]!.atSec <= t
      ) {
        const ev = events[nextEventIdx]!;
        try {
          ev.do(this.deps.audio, this.deps.music);
        } catch (err) {
          this.observer.recordError({
            t,
            source: 'panel-event',
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
        nextEventIdx += 1;
      }
    };

    if (opts.fast) {
      // Pure deterministic loop — no real timers involved.
      while (tNow < durationSec) {
        // Pick the next stream due to fire.
        const tNext = Math.min(tHand, tFace);
        tNow = tNext;
        if (tNow > durationSec) break;
        drainEventsUpTo(tNow);
        if (tHand <= tFace) {
          fireHand(tHand);
          tHand += HAND_INTERVAL_SEC;
        } else {
          fireFace(tFace);
          tFace += FACE_INTERVAL_SEC;
        }
      }
      // Final drain of any panel events scheduled at/after durationSec.
      drainEventsUpTo(durationSec);
    } else {
      // Live mode — use real setInterval-style sleeps so the visualizer can
      // observe the stream. The exact same emit order as fast mode, but
      // throttled to wall-clock.
      const startMs = performance.now();
      let lastWallSleep = 0;
      while (tNow < durationSec) {
        const tNext = Math.min(tHand, tFace);
        tNow = tNext;
        if (tNow > durationSec) break;
        drainEventsUpTo(tNow);
        if (tHand <= tFace) {
          fireHand(tHand);
          tHand += HAND_INTERVAL_SEC;
        } else {
          fireFace(tFace);
          tFace += FACE_INTERVAL_SEC;
        }
        // Wall-clock pacing: sleep until the simulator clock catches up.
        const targetWallMs = startMs + tNow * 1000;
        const nowMs = performance.now();
        const sleepMs = Math.max(0, targetWallMs - nowMs);
        if (sleepMs > 0 && sleepMs !== lastWallSleep) {
          await new Promise((r) => setTimeout(r, sleepMs));
          lastWallSleep = sleepMs;
        }
      }
      drainEventsUpTo(durationSec);
    }

    this.observer.durationSec = tNow;
  }
}
