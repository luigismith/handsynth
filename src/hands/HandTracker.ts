// Owner: hand-tracker
//
// MediaPipe Tasks Vision wrapper. Runs hand-landmark inference per video frame,
// maintains smoothing state, derives `GestureState`, and emits events.

import type { HandTracker, HandTrackerEvents } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by hand-tracker';

export class HandTrackerImpl implements HandTracker {
  init(_videoEl: HTMLVideoElement): Promise<void> {
    throw new Error(NOT_IMPL);
  }
  start(): void {
    throw new Error(NOT_IMPL);
  }
  stop(): void {
    throw new Error(NOT_IMPL);
  }
  on<K extends keyof HandTrackerEvents>(_evt: K, _cb: HandTrackerEvents[K]): void {
    throw new Error(NOT_IMPL);
  }
  off<K extends keyof HandTrackerEvents>(_evt: K, _cb: HandTrackerEvents[K]): void {
    throw new Error(NOT_IMPL);
  }
}
