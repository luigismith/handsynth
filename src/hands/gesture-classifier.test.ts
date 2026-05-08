// Owner: hand-tracker
//
// Unit tests for the discrete hand-shape classifier. Synthetic landmark
// fixtures only — no MediaPipe runtime needed. Each shape's fixture is
// constructed so the per-finger curl signal lands in the appropriate
// extended / partial / curled bucket.
//
// Fixture geometry conventions (all in MediaPipe-style 0..1 image coords;
// y origin at the top of the frame, so "up" is decreasing y):
//
//   - Wrist at (0.5, 0.85).
//   - MCPs in a horizontal row at y = 0.65, x ∈ {0.42, 0.50, 0.58, 0.66}.
//   - PIPs at y = 0.55, same xs.
//   - DIPs at y = 0.45.
//   - TIPs at y = 0.30 when EXTENDED — tip→MCP distance is then ~2.5×
//     pip→mcp distance (≥ RATIO_EXTENDED=2.2 → curl ≈ 0).
//   - TIPs at y = 0.65 when CURLED — tip lands on the MCP itself, so
//     tip→MCP ≈ 0 → curl = 1.

import { describe, it, expect } from 'vitest';
import type { HandLandmark } from '@contracts/contracts';
import {
  classifyFingers,
  classifyHandShape,
  fingerCurl,
  fingerCurls,
  fingerStateFromCurl,
  thumbIndexAngle,
  thumbIndexDistance,
  thumbVerticality,
} from './gesture-classifier';

function pt(x: number, y: number, z = 0): HandLandmark {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface FingerSpec {
  /** 'extended' positions tip well above MCP (small y).
   *  'curled' positions tip near MCP. 'partial' midway. */
  state: 'extended' | 'partial' | 'curled';
}

interface HandSpec {
  thumb: { state: 'extended_up' | 'extended_down' | 'extended_side' | 'curled' | 'extended_perp' };
  index: FingerSpec;
  middle: FingerSpec;
  ring: FingerSpec;
  pinky: FingerSpec;
  /** Override: place thumb tip at a specific point (e.g. ON the index tip
   * for the OK shape). Wins over thumb.state. */
  thumbTip?: HandLandmark;
}

// MCP / PIP positions are fixed across fixtures.
const MCP_Y = 0.65;
const PIP_Y = 0.55;
const DIP_Y = 0.45;

const FINGER_X: Record<'index' | 'middle' | 'ring' | 'pinky', number> = {
  index: 0.42,
  middle: 0.50,
  ring: 0.58,
  pinky: 0.66,
};

function fingerLandmarks(
  fingerKey: 'index' | 'middle' | 'ring' | 'pinky',
  spec: FingerSpec,
): { mcp: HandLandmark; pip: HandLandmark; dip: HandLandmark; tip: HandLandmark } {
  const x = FINGER_X[fingerKey];
  const mcp = pt(x, MCP_Y);
  const pip = pt(x, PIP_Y);
  const dip = pt(x, DIP_Y);
  let tipY: number;
  switch (spec.state) {
    case 'extended':
      // tip→mcp distance = MCP_Y - tipY = 0.65 - 0.20 = 0.45. PIP→MCP = 0.10.
      // ratio = 4.5 → above RATIO_EXTENDED → curl 0.
      tipY = 0.20;
      break;
    case 'partial':
      // ratio ~ 1.5 → curl ≈ 0.5.
      tipY = 0.50;
      break;
    case 'curled':
      // tip past MCP (slightly below it).
      tipY = 0.66;
      break;
  }
  return { mcp, pip, dip, tip: pt(x, tipY) };
}

function makeHand(spec: HandSpec): HandLandmark[] {
  // Wrist at center-bottom.
  const wrist = pt(0.5, 0.85);

  // Thumb: roots near (0.36, 0.78); orientation depends on spec.thumb.state.
  const thumbRoot = pt(0.36, 0.78);
  let thumbCmc = pt(0.34, 0.76);
  let thumbMcp = pt(0.30, 0.74);
  let thumbIp = pt(0.26, 0.72);
  let thumbTip = pt(0.20, 0.70);
  switch (spec.thumb.state) {
    case 'extended_up':
      // Thumb shoots straight up. CMC near base, tip well above wrist.
      thumbCmc = pt(0.40, 0.78);
      thumbMcp = pt(0.40, 0.70);
      thumbIp = pt(0.40, 0.55);
      thumbTip = pt(0.40, 0.40);
      break;
    case 'extended_down':
      thumbCmc = pt(0.40, 0.55);
      thumbMcp = pt(0.40, 0.65);
      thumbIp = pt(0.40, 0.80);
      thumbTip = pt(0.40, 0.95);
      break;
    case 'extended_side':
      // Default position from the openHand fixture.
      thumbCmc = pt(0.38, 0.78);
      thumbMcp = pt(0.30, 0.74);
      thumbIp = pt(0.22, 0.72);
      thumbTip = pt(0.14, 0.70);
      break;
    case 'extended_perp':
      // Thumb extended sideways perpendicular to the index. Index points up
      // so thumb axis sits horizontal.
      thumbCmc = pt(0.40, 0.74);
      thumbMcp = pt(0.32, 0.72);
      thumbIp = pt(0.22, 0.68);
      thumbTip = pt(0.12, 0.66);
      break;
    case 'curled':
      // Thumb tucked across palm (tip near palm center).
      thumbCmc = pt(0.42, 0.74);
      thumbMcp = pt(0.46, 0.72);
      thumbIp = pt(0.50, 0.68);
      thumbTip = pt(0.50, 0.66);
      break;
  }
  void thumbRoot;

  // Build the four-finger landmarks.
  const idx = fingerLandmarks('index', spec.index);
  const mid = fingerLandmarks('middle', spec.middle);
  const ring = fingerLandmarks('ring', spec.ring);
  const pinky = fingerLandmarks('pinky', spec.pinky);

  const lm: HandLandmark[] = new Array(21);
  lm[0] = wrist;
  lm[1] = thumbCmc;
  lm[2] = thumbMcp;
  lm[3] = thumbIp;
  lm[4] = spec.thumbTip ?? thumbTip;
  lm[5] = idx.mcp;
  lm[6] = idx.pip;
  lm[7] = idx.dip;
  lm[8] = idx.tip;
  lm[9] = mid.mcp;
  lm[10] = mid.pip;
  lm[11] = mid.dip;
  lm[12] = mid.tip;
  lm[13] = ring.mcp;
  lm[14] = ring.pip;
  lm[15] = ring.dip;
  lm[16] = ring.tip;
  lm[17] = pinky.mcp;
  lm[18] = pinky.pip;
  lm[19] = pinky.dip;
  lm[20] = pinky.tip;
  return lm;
}

// Convenience constructors for each named shape.

function fistHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'curled' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function openPalmHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'extended_side' },
    index: { state: 'extended' },
    middle: { state: 'extended' },
    ring: { state: 'extended' },
    pinky: { state: 'extended' },
  });
}

function pointHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function peaceHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'extended' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function rockOnHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'extended' },
  });
}

function okHand(): HandLandmark[] {
  // OK shape: thumb tip directly on top of index tip; M/R/P extended.
  // Index registers as partial because the curl measure of an index whose
  // tip is dragged toward the thumb (slightly outside the straight extension)
  // varies — so we keep the index tip extended and override the thumb tip.
  const lm = makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'extended' },
    ring: { state: 'extended' },
    pinky: { state: 'extended' },
  });
  // Override thumb tip to land on the index tip.
  const idxTip = lm[8]!;
  lm[4] = pt(idxTip.x, idxTip.y, idxTip.z);
  return lm;
}

function thumbsUpHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'extended_up' },
    index: { state: 'curled' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function thumbsDownHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'extended_down' },
    index: { state: 'curled' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function fingerGunHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'extended_perp' },
    index: { state: 'extended' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'curled' },
  });
}

function threeHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'extended' },
    ring: { state: 'extended' },
    pinky: { state: 'curled' },
  });
}

function fourHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'curled' },
    index: { state: 'extended' },
    middle: { state: 'extended' },
    ring: { state: 'extended' },
    pinky: { state: 'extended' },
  });
}

function callMeHand(): HandLandmark[] {
  return makeHand({
    thumb: { state: 'extended_side' },
    index: { state: 'curled' },
    middle: { state: 'curled' },
    ring: { state: 'curled' },
    pinky: { state: 'extended' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fingerCurl — non-thumb fingers', () => {
  it('returns near 0 for an extended finger', () => {
    const lm = openPalmHand();
    expect(fingerCurl(lm, 'index')).toBeLessThan(0.1);
    expect(fingerCurl(lm, 'middle')).toBeLessThan(0.1);
    expect(fingerCurl(lm, 'ring')).toBeLessThan(0.1);
    expect(fingerCurl(lm, 'pinky')).toBeLessThan(0.1);
  });

  it('returns near 1 for a curled finger', () => {
    const lm = fistHand();
    expect(fingerCurl(lm, 'index')).toBeGreaterThan(0.9);
    expect(fingerCurl(lm, 'middle')).toBeGreaterThan(0.9);
    expect(fingerCurl(lm, 'ring')).toBeGreaterThan(0.9);
    expect(fingerCurl(lm, 'pinky')).toBeGreaterThan(0.9);
  });

  it('lands in the partial band for an in-between finger', () => {
    const lm = makeHand({
      thumb: { state: 'curled' },
      index: { state: 'partial' },
      middle: { state: 'partial' },
      ring: { state: 'partial' },
      pinky: { state: 'partial' },
    });
    const c = fingerCurl(lm, 'index');
    // Wide partial band — anywhere between 0.3 and 0.75 is acceptable.
    expect(c).toBeGreaterThan(0.3);
    expect(c).toBeLessThan(0.75);
  });
});

describe('fingerCurl — thumb', () => {
  it('reads near 0 for an extended thumb', () => {
    expect(fingerCurl(openPalmHand(), 'thumb')).toBeLessThan(0.2);
  });

  it('reads near 1 for a curled thumb', () => {
    expect(fingerCurl(fistHand(), 'thumb')).toBeGreaterThan(0.85);
  });
});

describe('fingerStateFromCurl', () => {
  it('classifies extended / partial / curled with the documented thresholds', () => {
    expect(fingerStateFromCurl(0)).toBe('extended');
    expect(fingerStateFromCurl(0.3)).toBe('extended');
    expect(fingerStateFromCurl(0.5)).toBe('partial');
    expect(fingerStateFromCurl(0.74)).toBe('partial');
    expect(fingerStateFromCurl(0.75)).toBe('curled');
    expect(fingerStateFromCurl(1)).toBe('curled');
  });
});

describe('classifyFingers + fingerCurls', () => {
  it('returns a per-finger object with all five entries', () => {
    const states = classifyFingers(openPalmHand());
    expect(Object.keys(states).sort()).toEqual([
      'index',
      'middle',
      'pinky',
      'ring',
      'thumb',
    ]);
    expect(states.index).toBe('extended');
    expect(states.thumb).toBe('extended');
  });

  it('fingerCurls returns numeric scalars per finger', () => {
    const cs = fingerCurls(fistHand());
    expect(cs.index).toBeGreaterThan(0.9);
    expect(cs.middle).toBeGreaterThan(0.9);
    expect(cs.thumb).toBeGreaterThan(0.85);
  });
});

describe('thumbIndexDistance / thumbIndexAngle / thumbVerticality', () => {
  it('thumbIndexDistance is small when thumb tip lands on index tip', () => {
    expect(thumbIndexDistance(okHand())).toBeLessThan(0.1);
  });

  it('thumbIndexDistance is large for a fully open palm', () => {
    expect(thumbIndexDistance(openPalmHand())).toBeGreaterThan(0.5);
  });

  it('thumbVerticality is positive for thumbs_up and negative for thumbs_down', () => {
    expect(thumbVerticality(thumbsUpHand())).toBeGreaterThan(0.7);
    expect(thumbVerticality(thumbsDownHand())).toBeLessThan(-0.7);
  });

  it('thumbIndexAngle is ~π/2 for the finger_gun fixture', () => {
    const a = thumbIndexAngle(fingerGunHand());
    expect(Math.abs(a - Math.PI / 2)).toBeLessThan(Math.PI / 4);
  });
});

describe('classifyHandShape — every named shape', () => {
  it('fist', () => {
    expect(classifyHandShape(fistHand())).toBe('fist');
  });

  it('open_palm', () => {
    expect(classifyHandShape(openPalmHand())).toBe('open_palm');
  });

  it('point', () => {
    expect(classifyHandShape(pointHand())).toBe('point');
  });

  it('peace', () => {
    expect(classifyHandShape(peaceHand())).toBe('peace');
  });

  it('rock_on', () => {
    expect(classifyHandShape(rockOnHand())).toBe('rock_on');
  });

  it('ok', () => {
    expect(classifyHandShape(okHand())).toBe('ok');
  });

  it('thumbs_up', () => {
    expect(classifyHandShape(thumbsUpHand())).toBe('thumbs_up');
  });

  it('thumbs_down', () => {
    expect(classifyHandShape(thumbsDownHand())).toBe('thumbs_down');
  });

  it('finger_gun', () => {
    expect(classifyHandShape(fingerGunHand())).toBe('finger_gun');
  });

  it('three', () => {
    expect(classifyHandShape(threeHand())).toBe('three');
  });

  it('four', () => {
    expect(classifyHandShape(fourHand())).toBe('four');
  });

  it('call_me', () => {
    expect(classifyHandShape(callMeHand())).toBe('call_me');
  });
});

describe('classifyHandShape — robustness', () => {
  it('returns "unknown" when too few landmarks are provided', () => {
    expect(classifyHandShape([])).toBe('unknown');
    expect(classifyHandShape([pt(0, 0), pt(0.1, 0.1)])).toBe('unknown');
  });

  it('returns "unknown" for an ambiguous (mostly-partial) hand', () => {
    const lm = makeHand({
      thumb: { state: 'curled' },
      index: { state: 'partial' },
      middle: { state: 'partial' },
      ring: { state: 'partial' },
      pinky: { state: 'partial' },
    });
    expect(classifyHandShape(lm)).toBe('unknown');
  });

  it('open_palm vs four — thumb state is the discriminator', () => {
    expect(classifyHandShape(openPalmHand())).toBe('open_palm');
    expect(classifyHandShape(fourHand())).toBe('four');
  });

  it('point vs finger_gun — thumb angle is the discriminator', () => {
    expect(classifyHandShape(pointHand())).toBe('point');
    expect(classifyHandShape(fingerGunHand())).toBe('finger_gun');
  });
});
