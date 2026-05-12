// Owner: ux-curator
//
// localStorage persistence for the user's CalibrationProfile.
//
// Defensive contract: every read path tolerates corrupt JSON, missing
// keys, foreign storage backends (e.g. private-mode quota errors). The
// load function returns `null` for "no profile" — caller responds by
// running the calibration wizard. The save function silently swallows
// storage errors (we don't want a localStorage quota error to abort the
// app boot).
//
// Schema validation is strict: every field of CalibrationProfile must be
// present and the correct type, or the parse is rejected. This catches
// users who manually clear half of an entry, and protects us if a future
// version of this module adds a field — we WILL discard the v1 profile
// then, prompting a fresh calibration.
//
// IMPORTANT: we never throw from this module. Calibration is a UX feature,
// not a correctness invariant. If everything fails, hand-tracking still
// works with the hardcoded ranges in InteractionMapper — the calibration
// is a layered improvement, not a load-bearing dependency.

import {
  CALIBRATION_STORAGE_KEY,
  type CalibrationProfile,
  type CalibrationRange,
} from './types';

/**
 * Internal helper: type-checked predicate for a CalibrationRange. Returns
 * true only if both endpoints are finite numbers. Does NOT enforce min ≤
 * max — a degenerate range loads cleanly and the remap path falls back
 * to identity (see makeRemap in types.ts).
 */
function isRange(v: unknown): v is CalibrationRange {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return Number.isFinite(r.min) && Number.isFinite(r.max);
}

/**
 * Validate that a loaded JSON blob is a well-formed v1 profile. We accept
 * unknown extra fields (forward-compat) but reject any missing or wrong-
 * typed required field.
 */
export function isCalibrationProfile(v: unknown): v is CalibrationProfile {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    p.version === 1 &&
    typeof p.completedAt === 'number' &&
    typeof p.videoWidth === 'number' &&
    typeof p.videoHeight === 'number' &&
    isRange(p.handY) &&
    isRange(p.handX) &&
    isRange(p.meanDepth) &&
    isRange(p.openness) &&
    isRange(p.handsDistance3D) &&
    typeof p.tutorialCompleted === 'boolean'
  );
}

/**
 * Read a stored profile. Returns null when:
 *   - localStorage is unavailable (e.g. private-mode quota error)
 *   - no profile has ever been saved
 *   - the stored JSON fails schema validation
 *
 * Callers should treat null as "user is new — run the wizard".
 */
export function loadCalibration(): CalibrationProfile | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCalibrationProfile(parsed)) {
      // Corrupt or unknown-version — log once for visibility but don't
      // throw; the wizard will recreate it.
      // eslint-disable-next-line no-console
      console.info(
        '[calibration] stored profile failed validation — running fresh wizard',
      );
      return null;
    }
    return parsed;
  } catch (err) {
    // SecurityError / SyntaxError / etc. — never reach the user.
    // eslint-disable-next-line no-console
    console.warn('[calibration] load failed (ignored)', err);
    return null;
  }
}

/**
 * Persist a profile. Silently swallows write errors so a localStorage
 * quota crash never aborts the wizard. Returns true on success so callers
 * who want telemetry can report it.
 */
export function saveCalibration(profile: CalibrationProfile): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(profile));
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[calibration] save failed (ignored)', err);
    return false;
  }
}

/**
 * Clear the persisted profile (e.g. user requested "reset to defaults" from
 * a future advanced settings menu). The next boot will re-run the wizard.
 */
export function clearCalibration(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
