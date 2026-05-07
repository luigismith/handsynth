// Owner: hand-tracker
//
// Pure gesture-detection helpers. Given raw landmarks, derive openness, pinch,
// finger count, etc. No I/O. No timers. Easy to unit test.

import type { Hand, HandLandmark } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by hand-tracker';

/** Hand openness 0..1 from 21 landmarks. */
export function openness(_landmarks: HandLandmark[]): number {
  throw new Error(NOT_IMPL);
}

/** Thumb-tip ↔ index-tip distance, normalized to palm size. */
export function pinch(_landmarks: HandLandmark[]): number {
  throw new Error(NOT_IMPL);
}

/** Centroid of palm landmarks (wrist + index/middle/ring/pinky MCPs). */
export function palmCenter(_landmarks: HandLandmark[]): HandLandmark {
  throw new Error(NOT_IMPL);
}

/** Number of extended fingers, 0..5. */
export function extendedFingerCount(_h: Hand): number {
  throw new Error(NOT_IMPL);
}
