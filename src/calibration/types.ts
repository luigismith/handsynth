// Owner: ux-curator
//
// Calibration data model. The CalibrationProfile is the user's per-setup
// "fingerprint": webcam framing, hand size, comfortable range of motion.
// It's collected by `CalibrationPanel` once on first launch and persisted
// to localStorage. A subsequent re-run replaces it.
//
// Why these fields:
//   - handY / handX / meanDepth / handsDistance3D: spatial envelope. Two
//     different users at two different distances from their camera see
//     wildly different normalized values for the same gesture. Without
//     calibration, the InteractionMapper's hardcoded ranges (e.g.
//     MEANHEIGHT_NORMAL or HANDS_DISTANCE_MIN/MAX) assume a single
//     prototypical body — short users hit the high register fully but
//     never reach the low register; tall users the opposite.
//   - openness / pinch: hand-shape envelope. A child's hand at full
//     splay produces a smaller normalized "openness" value than an
//     adult's hand. The same physical gesture should map to the SAME
//     audio response regardless of hand size.
//
// Versioning: the schema version is checked at load time. If the stored
// profile is from a future or unknown version we discard it (treat as
// first-run). Migrations should be additive in v2+ — preserve known
// fields, fill new ones with defaults.

/** Observed [min, max] range of a single sensor channel. */
export interface CalibrationRange {
  /** Minimum value observed during the collection step. */
  min: number;
  /** Maximum value observed during the collection step. */
  max: number;
}

/**
 * One calibration profile. All fields are required at v1; if any are missing
 * the loaded profile is treated as corrupt and a fresh calibration is
 * triggered.
 *
 * Range values for normalized inputs (openness/pinch/handsDistance3D/
 * meanDepth) live in [0, 1]. handX and handY are normalized 0..1 to the
 * frame. The webcam resolution is stored so a future smart-resample can
 * detect when the camera framing has changed since calibration.
 */
export interface CalibrationProfile {
  /** Schema version — increment when fields are added/changed. */
  version: 1;
  /** ms since epoch when the profile was finalized. */
  completedAt: number;
  /** Webcam intrinsic dimensions captured at calibration time (for sanity). */
  videoWidth: number;
  videoHeight: number;
  /** Vertical motion range — how high vs low the user reaches. */
  handY: CalibrationRange;
  /** Horizontal motion range. */
  handX: CalibrationRange;
  /** Depth (close ↔ far) range. */
  meanDepth: CalibrationRange;
  /** Hand-shape openness range — closed fist .. full splay. */
  openness: CalibrationRange;
  /** Two-handed spread range — hands together .. hands wide. */
  handsDistance3D: CalibrationRange;
  /** Whether the user finished the playable tutorial. */
  tutorialCompleted: boolean;
}

/**
 * Safe defaults for an unmounted calibration. Used when the panel hasn't
 * been completed yet — the InteractionMapper treats this as "fall back to
 * hardcoded ranges" (identity remap). Centralized here so callers don't
 * hardcode 0/1 endpoints in multiple places.
 */
export const DEFAULT_CALIBRATION: CalibrationProfile = {
  version: 1,
  completedAt: 0,
  videoWidth: 0,
  videoHeight: 0,
  handY: { min: 0, max: 1 },
  handX: { min: 0, max: 1 },
  meanDepth: { min: 0, max: 1 },
  openness: { min: 0, max: 1 },
  handsDistance3D: { min: 0, max: 1 },
  tutorialCompleted: false,
};

/**
 * Minimum span (max - min) for a calibration range to be considered "real".
 * If the user holds their hand still during a "move up and down" step we
 * end up with min ≈ max; the resulting remap divides by ~0 and explodes.
 * When the observed span is below this floor we fall back to identity
 * (no remap) for that channel. 0.15 = 15% of the normalized 0..1 range.
 */
export const MIN_RANGE_SPAN = 0.15;

/**
 * localStorage key for the persisted profile. Namespaced under `hs.` like
 * the other Handsynth settings (`hs.musicSettings`, etc).
 */
export const CALIBRATION_STORAGE_KEY = 'hs.calibrationProfile';

/**
 * Remap fn — used by callers (InteractionMapper) that want to expand a
 * user's actual observed range to the full 0..1 audio-side input. Linear
 * remap with a defensive clamp; returns identity when the observed range
 * is degenerate (span below MIN_RANGE_SPAN).
 *
 * The function curries the range at construction so the hot path
 * (called per-frame from the audio mapper) is a single subtract + divide
 * + clamp.
 */
export function makeRemap(range: CalibrationRange): (v: number) => number {
  const span = range.max - range.min;
  if (!Number.isFinite(span) || span < MIN_RANGE_SPAN) {
    // Degenerate range — return identity so the mapper falls back to its
    // hardcoded thresholds. Better to under-react than to multiply by
    // 1/epsilon and slam the audio param to ±Infinity.
    return (v) => v;
  }
  const lo = range.min;
  return (v) => {
    const t = (v - lo) / span;
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t;
  };
}
