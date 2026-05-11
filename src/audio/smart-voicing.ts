// Owner: audio-engineer
//
// Intelligent voicing router — the "smart" half of the analog-WAVE knob.
//
// Each pitched voice (pad/lead/bass) has a user-set `timbre` axis 0..1 that
// crossfades between two oscillator stacks (see PadEngine / LeadEngine /
// BassEngine). On top of that, this module watches the running FX state and
// returns a per-voice nudge (±0.15 max, summed clamp ±0.15) that biases each
// voice toward a musically-sensible destination. The final effective timbre
// pushed to the CrossFade is `clamp(userTimbre + smartNudge, 0, 1)`.
//
// The rules below are intentionally subtle — each one contributes ±0.15 to
// the nudge total, and the total is clamped to ±0.15 so multiple rules can't
// double up into a hard override. The user-set timbre is always the dominant
// signal; smart voicing is a finishing-touch.
//
// Rules (each adds to a per-voice running total, then clamped ±0.15):
//
//   1. Low filter cutoff (<800 Hz)
//        - bass: -0.15  (toward A side, where bass waveform = warm sub-heavy)
//        - pad:  +0.15  (toward B side = sine/triangle clean morph dest)
//   2. High filter cutoff (>10 kHz)
//        - lead: -0.15  (toward A side, typically fmsawtooth — brighter harmonics)
//   3. High drive (>2.0)
//        - pad / lead / bass: -0.15  (toward A side, harmonic-rich waveform
//          for the saturator to bite)
//   4. Low drive (<1.0)
//        - pad / lead / bass: +0.15  (toward B sine/pulse/triangle — clean)
//   5. High filter Q (>8)
//        - lead: +0.15  (toward B = pulse, resonant character)
//   6. High reverb wet (>0.7)
//        - pad: +0.15   (toward B = sine, glassy washes well)
//
// Each rule is implemented as a pure function so the unit tests can drive
// them independently. The clamping bound (±0.15) is the same as the per-rule
// step size — multiple rules favoring the same direction still cap at 0.15,
// which keeps the smart router strictly nudging rather than overriding.

export type VoiceKey = 'pad' | 'lead' | 'bass';

/** Mirror of the FX params the router watches. */
export interface SmartVoiceParams {
  filterCutoff: number;
  filterResonance: number;
  saturatorDrive: number;
  reverbWet: number;
}

/** Maximum absolute nudge any single voice can receive from the router. */
export const SMART_NUDGE_BOUND = 0.15;

const LOW_CUTOFF_HZ = 800;
const HIGH_CUTOFF_HZ = 10000;
const HIGH_DRIVE = 2.0;
const LOW_DRIVE = 1.0;
const HIGH_Q = 8;
const HIGH_REVERB = 0.7;

/**
 * Compute the smart nudge for a single voice. Returns a value in
 * [-SMART_NUDGE_BOUND .. +SMART_NUDGE_BOUND]. The caller is expected to add
 * this to the user-set timbre and clamp the sum to [0..1].
 *
 * Performance: this is called from AudioEngine.setParams (once per gesture
 * frame at worst) for three voices. Each evaluation is a handful of
 * comparisons + adds, well below the budget. No allocations.
 */
export function computeSmartTimbre(
  voice: VoiceKey,
  p: SmartVoiceParams,
): number {
  let nudge = 0;

  // Rule 1 — low cutoff.
  if (p.filterCutoff < LOW_CUTOFF_HZ) {
    if (voice === 'bass') nudge -= SMART_NUDGE_BOUND;
    if (voice === 'pad') nudge += SMART_NUDGE_BOUND;
  }

  // Rule 2 — high cutoff.
  if (p.filterCutoff > HIGH_CUTOFF_HZ) {
    if (voice === 'lead') nudge -= SMART_NUDGE_BOUND;
  }

  // Rule 3 — high drive.
  if (p.saturatorDrive > HIGH_DRIVE) {
    nudge -= SMART_NUDGE_BOUND;
  }

  // Rule 4 — low drive. (Note: HIGH_DRIVE > LOW_DRIVE, so rules 3 and 4
  // never both fire — but we use < rather than <= so the boundary value
  // 1.0 is neutral, matching the saturator's pass-through level.)
  if (p.saturatorDrive < LOW_DRIVE) {
    nudge += SMART_NUDGE_BOUND;
  }

  // Rule 5 — high Q.
  if (p.filterResonance > HIGH_Q) {
    if (voice === 'lead') nudge += SMART_NUDGE_BOUND;
  }

  // Rule 6 — high reverb.
  if (p.reverbWet > HIGH_REVERB) {
    if (voice === 'pad') nudge += SMART_NUDGE_BOUND;
  }

  // Clamp the per-voice total to ±SMART_NUDGE_BOUND. This is the safety
  // rail: even if two rules favor the same direction, the smart router
  // contributes at most 0.15 — never enough to override the user.
  if (nudge > SMART_NUDGE_BOUND) return SMART_NUDGE_BOUND;
  if (nudge < -SMART_NUDGE_BOUND) return -SMART_NUDGE_BOUND;
  return nudge;
}
