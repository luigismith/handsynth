// Owner: audio-engineer
//
// Unit tests for the smart-voicing router. The router itself is a pure
// function (no Tone.js); we drive it with the SmartVoiceParams snapshot the
// AudioEngine maintains and assert the per-voice nudge has the right sign,
// magnitude, and clamping behavior. The AudioEngine integration (router
// fires from setParams, respects the smartVoicing toggle, etc.) is exercised
// separately in AudioEngine.test.ts.

import { describe, it, expect } from 'vitest';
import {
  computeSmartTimbre,
  SMART_NUDGE_BOUND,
  type SmartVoiceParams,
  type VoiceKey,
} from '../smart-voicing';

const NEUTRAL: SmartVoiceParams = {
  filterCutoff: 4000,
  filterResonance: 1,
  saturatorDrive: 1,
  reverbWet: 0.4,
};

describe('computeSmartTimbre — neutral state', () => {
  it('returns 0 for every voice at neutral params (no rule fires)', () => {
    // saturatorDrive = 1.0 is exactly on the LOW_DRIVE boundary, which uses
    // strict <, so it does NOT fire. This is intentional: 1.0 is the
    // saturator's pass-through level and should be neutral.
    expect(computeSmartTimbre('pad', NEUTRAL)).toBe(0);
    expect(computeSmartTimbre('lead', NEUTRAL)).toBe(0);
    expect(computeSmartTimbre('bass', NEUTRAL)).toBe(0);
  });
});

describe('computeSmartTimbre — low filter cutoff', () => {
  const lowCut: SmartVoiceParams = { ...NEUTRAL, filterCutoff: 500 };

  it('biases bass toward A (sub-heavy waveform)', () => {
    expect(computeSmartTimbre('bass', lowCut)).toBe(-SMART_NUDGE_BOUND);
  });
  it('biases pad toward B (clean / triangle morph dest)', () => {
    expect(computeSmartTimbre('pad', lowCut)).toBe(+SMART_NUDGE_BOUND);
  });
  it('leaves lead untouched at low cutoff', () => {
    expect(computeSmartTimbre('lead', lowCut)).toBe(0);
  });
});

describe('computeSmartTimbre — high filter cutoff', () => {
  const highCut: SmartVoiceParams = { ...NEUTRAL, filterCutoff: 12000 };

  it('biases lead toward A (brighter harmonic oscillator)', () => {
    expect(computeSmartTimbre('lead', highCut)).toBe(-SMART_NUDGE_BOUND);
  });
  it('leaves pad and bass untouched at high cutoff', () => {
    expect(computeSmartTimbre('pad', highCut)).toBe(0);
    expect(computeSmartTimbre('bass', highCut)).toBe(0);
  });
});

describe('computeSmartTimbre — drive band', () => {
  it('high drive biases all voices toward A (more harmonics for the saturator)', () => {
    const hi: SmartVoiceParams = { ...NEUTRAL, saturatorDrive: 2.5 };
    for (const v of ['pad', 'lead', 'bass'] as VoiceKey[]) {
      expect(computeSmartTimbre(v, hi)).toBe(-SMART_NUDGE_BOUND);
    }
  });

  it('low drive biases all voices toward B (clean / transparent)', () => {
    const lo: SmartVoiceParams = { ...NEUTRAL, saturatorDrive: 0.7 };
    for (const v of ['pad', 'lead', 'bass'] as VoiceKey[]) {
      expect(computeSmartTimbre(v, lo)).toBe(+SMART_NUDGE_BOUND);
    }
  });

  it('drive 1.0 is the dead zone — no nudge', () => {
    const at1: SmartVoiceParams = { ...NEUTRAL, saturatorDrive: 1.0 };
    expect(computeSmartTimbre('pad', at1)).toBe(0);
  });
});

describe('computeSmartTimbre — high resonance Q', () => {
  it('biases lead toward B (pulse / resonant character)', () => {
    const hiQ: SmartVoiceParams = { ...NEUTRAL, filterResonance: 12 };
    expect(computeSmartTimbre('lead', hiQ)).toBe(+SMART_NUDGE_BOUND);
  });
  it('leaves pad and bass untouched at high Q', () => {
    const hiQ: SmartVoiceParams = { ...NEUTRAL, filterResonance: 12 };
    expect(computeSmartTimbre('pad', hiQ)).toBe(0);
    expect(computeSmartTimbre('bass', hiQ)).toBe(0);
  });
});

describe('computeSmartTimbre — high reverb wet', () => {
  it('biases pad toward B (glassy, washes well)', () => {
    const wet: SmartVoiceParams = { ...NEUTRAL, reverbWet: 0.9 };
    expect(computeSmartTimbre('pad', wet)).toBe(+SMART_NUDGE_BOUND);
  });
  it('leaves lead and bass untouched at high reverb', () => {
    const wet: SmartVoiceParams = { ...NEUTRAL, reverbWet: 0.9 };
    expect(computeSmartTimbre('lead', wet)).toBe(0);
    expect(computeSmartTimbre('bass', wet)).toBe(0);
  });
});

describe('computeSmartTimbre — clamping (multiple rules same direction)', () => {
  it('caps the bass nudge at ±SMART_NUDGE_BOUND even when low cutoff + high drive both pull A', () => {
    // Both rules push toward A (negative); summed they'd be -0.30 absent
    // the clamp. The router caps at -0.15 so it never overrides the user.
    const stack: SmartVoiceParams = {
      ...NEUTRAL,
      filterCutoff: 500,
      saturatorDrive: 2.5,
    };
    expect(computeSmartTimbre('bass', stack)).toBe(-SMART_NUDGE_BOUND);
  });

  it('caps the pad nudge at +SMART_NUDGE_BOUND when low cutoff + high reverb both pull B', () => {
    const stack: SmartVoiceParams = {
      ...NEUTRAL,
      filterCutoff: 500,
      reverbWet: 0.9,
    };
    expect(computeSmartTimbre('pad', stack)).toBe(+SMART_NUDGE_BOUND);
  });

  it('cancels when one rule pulls A and another pulls B for the same voice', () => {
    // Bass: low cutoff pulls -0.15, low drive pulls +0.15 → sums to 0.
    const cancel: SmartVoiceParams = {
      ...NEUTRAL,
      filterCutoff: 500,
      saturatorDrive: 0.7,
    };
    expect(computeSmartTimbre('bass', cancel)).toBe(0);
  });
});

describe('computeSmartTimbre — boundary values', () => {
  it('strict comparisons: cutoff exactly 800 Hz does NOT fire the low rule', () => {
    const exact: SmartVoiceParams = { ...NEUTRAL, filterCutoff: 800 };
    expect(computeSmartTimbre('bass', exact)).toBe(0);
    expect(computeSmartTimbre('pad', exact)).toBe(0);
  });
  it('cutoff exactly 10000 Hz does NOT fire the high rule', () => {
    const exact: SmartVoiceParams = { ...NEUTRAL, filterCutoff: 10000 };
    expect(computeSmartTimbre('lead', exact)).toBe(0);
  });
  it('reverb exactly 0.7 does NOT fire the high-reverb rule', () => {
    const exact: SmartVoiceParams = { ...NEUTRAL, reverbWet: 0.7 };
    expect(computeSmartTimbre('pad', exact)).toBe(0);
  });
});
