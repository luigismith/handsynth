// Owner: qa-listener / synthetic-player harness
//
// FakeHandTracker / FakeFaceTracker. These implement the HandTracker /
// FaceTracker interfaces from `@contracts/contracts` but skip MediaPipe
// entirely. The synthetic-player calls `.emit(...)` directly to push
// hand-crafted GestureState / FaceState snapshots through the same on/off
// event surface the real trackers expose. The InteractionMapper cannot tell
// the difference at runtime.

import type {
  FaceTracker,
  FaceTrackerEvents,
  HandTracker,
  HandTrackerEvents,
} from '@contracts/contracts';

type AnyCb<E> = E extends (...a: infer A) => infer R ? (...a: A) => R : never;

class TypedEmitter<EventMap> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<keyof EventMap, Set<any>>();

  on<K extends keyof EventMap>(evt: K, cb: AnyCb<EventMap[K]>): void {
    let set = this.listeners.get(evt);
    if (!set) {
      set = new Set();
      this.listeners.set(evt, set);
    }
    set.add(cb);
  }

  off<K extends keyof EventMap>(evt: K, cb: AnyCb<EventMap[K]>): void {
    this.listeners.get(evt)?.delete(cb);
  }

  emit<K extends keyof EventMap>(
    evt: K,
    ...args: EventMap[K] extends (...a: infer A) => unknown ? A : never[]
  ): void {
    const set = this.listeners.get(evt);
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // Mirror the real HandTracker behavior — a single listener throwing
        // must not kill the loop. Re-emit on the `error` channel so the
        // observer can capture it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorSet = this.listeners.get('error' as any);
        if (errorSet) {
          for (const ecb of errorSet) {
            try {
              (ecb as (e: Error) => void)(
                err instanceof Error ? err : new Error(String(err)),
              );
            } catch {
              /* swallow */
            }
          }
        }
      }
    }
  }
}

export class FakeHandTracker implements HandTracker {
  private emitter = new TypedEmitter<HandTrackerEvents>();
  /** No-op init: nothing to load, no permissions to ask. */
  async init(_videoEl: HTMLVideoElement): Promise<void> {
    void _videoEl;
  }
  start(): void {
    /* no-op */
  }
  stop(): void {
    /* no-op */
  }
  on<K extends keyof HandTrackerEvents>(
    evt: K,
    cb: HandTrackerEvents[K],
  ): void {
    this.emitter.on(evt, cb as AnyCb<HandTrackerEvents[K]>);
  }
  off<K extends keyof HandTrackerEvents>(
    evt: K,
    cb: HandTrackerEvents[K],
  ): void {
    this.emitter.off(evt, cb as AnyCb<HandTrackerEvents[K]>);
  }
  emit<K extends keyof HandTrackerEvents>(
    evt: K,
    ...args: HandTrackerEvents[K] extends (...a: infer A) => unknown ? A : never[]
  ): void {
    this.emitter.emit(evt, ...args);
  }
}

export class FakeFaceTracker implements FaceTracker {
  private emitter = new TypedEmitter<FaceTrackerEvents>();
  async init(_videoEl: HTMLVideoElement): Promise<void> {
    void _videoEl;
  }
  start(): void {
    /* no-op */
  }
  stop(): void {
    /* no-op */
  }
  on<K extends keyof FaceTrackerEvents>(
    evt: K,
    cb: FaceTrackerEvents[K],
  ): void {
    this.emitter.on(evt, cb as AnyCb<FaceTrackerEvents[K]>);
  }
  off<K extends keyof FaceTrackerEvents>(
    evt: K,
    cb: FaceTrackerEvents[K],
  ): void {
    this.emitter.off(evt, cb as AnyCb<FaceTrackerEvents[K]>);
  }
  emit<K extends keyof FaceTrackerEvents>(
    evt: K,
    ...args: FaceTrackerEvents[K] extends (...a: infer A) => unknown ? A : never[]
  ): void {
    this.emitter.emit(evt, ...args);
  }
}
