// Owner: audio-engineer
//
// Start-time handling shared by the voice engines.
//
// Transport callbacks hand us times inside the scheduler's look-ahead
// window, already in the future: they must pass through untouched. The
// freeze fix of 2026-05-11 clamped them to `Tone.now()` instead — but
// `Tone.now()` is currentTime + lookAhead, the END of that window, so every
// note processed in one ticker pass (updateInterval = lookAhead / 2 = 0.2 s)
// collapsed onto the same instant and the groove was quantised to 200 ms.
//
// What still needs guarding:
//   - after a main-thread stall a callback time can already be in the past
//     → clamp to the audio clock (`Tone.immediate()` = currentTime);
//   - Tone's monophonic synths (Mono/Membrane/Noise) throw unless each start
//     is strictly after the previous one ("time must be greater than or
//     equal to the last scheduled time") — e.g. a sequenced note landing
//     before a UI stab scheduled with '+0.1'. `StartGuard` keeps one synth's
//     starts strictly increasing.

import * as Tone from 'tone';

/** Gap forced between consecutive starts on the same monophonic synth. */
const MIN_START_GAP_S = 0.002;

/**
 * Resolve a trigger time to absolute seconds, never in the past.
 * `undefined` means "as soon as possible" (Tone's own default, `now()`);
 * strings are Tone time expressions such as '+0.05'.
 */
export function resolveStartTime(time?: number | string): number {
  const requested =
    typeof time === 'number'
      ? time
      : time === undefined
        ? Tone.now()
        : Tone.Time(time).toSeconds();
  return Math.max(requested, Tone.immediate());
}

/** Strictly increasing start times for one monophonic synth. */
export class StartGuard {
  private last = -Infinity;

  next(time?: number | string): number {
    const t = Math.max(resolveStartTime(time), this.last + MIN_START_GAP_S);
    this.last = t;
    return t;
  }
}
