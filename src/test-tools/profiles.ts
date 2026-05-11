// Owner: qa-listener / synthetic-player harness
//
// Seven play profiles. Each one is a deterministic generator that produces
// the GestureState/FaceState a synthetic performer would emit at a given
// simulator time. Profiles use the seeded RNG so a given (seed, time) pair
// always produces the same snapshot — required for reproducible bug hunts.
//
// The profiles in this file are intentionally simple math (sin/cos/time-
// buckets) rather than recorded data. Goal: exercise the system across a
// range of plausible musical behaviors without depending on captured input
// or human reaction time.

import type {
  FaceLandmark,
  Hand,
  HandLandmark,
  HandShape,
  HeadPose,
} from '@contracts/contracts';
import { FACTORY_PRESETS } from '@presets/factory-presets';
import { VIBES, VIBE_LIST } from '@presets/vibes';
import { SCALE_OPTIONS } from '@presets/scale-options';
import { KEY_OPTIONS } from '@presets/key-options';
import { WAVEFORM_OPTIONS } from '@presets/waveform-options';
import type { AudioEngine, MusicBrain } from '@contracts/contracts';
import type {
  FaceState,
  GestureState,
  PlayProfile,
} from './types';

type PanelEvent = {
  atSec: number;
  do: (engine: AudioEngine, music: MusicBrain) => void;
};

// ---------------------------------------------------------------------------
// Builders — make a "blank" Hand / FaceState / GestureState with sensible
// defaults so each profile only has to override what it wants to vary.
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Synthesize 21 hand landmarks at sensible positions for a "loose hand". */
function makeHandLandmarks(side: 'left' | 'right'): HandLandmark[] {
  // We don't need anatomically-correct landmarks — only that all 21 exist
  // and have reasonable x/y/z so downstream consumers (palmCenter, openness
  // recompute, isFist) don't NaN. Place wrist at (sx, 0.7), splay fingers
  // upward.
  const baseX = side === 'right' ? 0.65 : 0.35;
  const baseY = 0.7;
  const lms: HandLandmark[] = [];
  for (let i = 0; i < 21; i += 1) {
    lms.push({
      x: baseX + (i % 5) * 0.01,
      y: baseY - Math.floor(i / 5) * 0.05,
      z: 0,
    });
  }
  return lms;
}

function makeHand(
  side: 'left' | 'right',
  over: Partial<Hand> = {},
): Hand {
  const landmarks = makeHandLandmarks(side);
  const palm = landmarks[0]!;
  return {
    side,
    landmarks,
    palmCenter: { x: palm.x, y: palm.y, z: palm.z },
    openness: 0.6,
    pinch: 0.5,
    isClosed: false,
    depth: 0,
    roll: 0,
    pitch: 0,
    ...over,
  };
}

function makeGestureState(over: Partial<GestureState> = {}): GestureState {
  const hands = over.hands ?? [makeHand('left'), makeHand('right')];
  return {
    hands,
    bothHandsDetected: hands.length === 2,
    handsDistance: 0.5,
    meanHeight: 0.5,
    rightOpenness: 0.6,
    leftOpenness: 0.6,
    rightPinchActive: false,
    leftPinchActive: false,
    bothFists: false,
    bothAboveHead: false,
    fingerCount: 8,
    noHandsDuration: 0,
    meanDepth: 0.5,
    rightRoll: 0,
    leftRoll: 0,
    handsDistance3D: 0.5,
    meanPitch: 0,
    ...over,
  };
}

function makeFaceLandmarks(): FaceLandmark[] {
  const lms: FaceLandmark[] = [];
  for (let i = 0; i < 478; i += 1) {
    lms.push({ x: 0.5, y: 0.5, z: 0 });
  }
  return lms;
}

function makeFaceState(over: Partial<FaceState> = {}): FaceState {
  const pose: HeadPose = over.pose ?? { yaw: 0, pitch: 0, roll: 0, depth: 0 };
  return {
    detected: true,
    center: { x: 0.5, y: 0.5 },
    apparentSize: 0.4,
    pose,
    mouthOpen: 0,
    browRaise: 0,
    eyeOpenLeft: 0.5,
    eyeOpenRight: 0.5,
    eyesWide: 0,
    smile: 0,
    frown: 0,
    surprise: 0,
    anger: 0,
    noFaceDuration: 0,
    landmarks: makeFaceLandmarks(),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Profile 1: ambient
//
// Slow continuous motion. Both hands always present, openness slowly
// oscillates 0.3..0.85, hands-distance breathes, neutral face. Tests the
// continuous-mapping path with no edges firing.
// ---------------------------------------------------------------------------

export const ambient: PlayProfile = {
  name: 'ambient',
  defaultDurationSec: 60,
  nextGestureState: (t, _rng) => {
    const open = 0.55 + 0.3 * Math.sin(t * 0.3);
    const dist = 0.45 + 0.15 * Math.sin(t * 0.2);
    return makeGestureState({
      rightOpenness: clamp01(open),
      leftOpenness: clamp01(open * 0.9),
      handsDistance: dist,
      handsDistance3D: dist,
      meanHeight: 0.5 + 0.1 * Math.sin(t * 0.4),
      meanDepth: 0.5 + 0.1 * Math.sin(t * 0.15),
    });
  },
  nextFaceState: (t, _rng) =>
    makeFaceState({
      mouthOpen: t % 12 < 0.5 ? 0.4 : 0,
      pose: {
        yaw: 0.1 * Math.sin(t * 0.25),
        pitch: 0,
        roll: 0,
        depth: 0,
      },
    }),
};

// ---------------------------------------------------------------------------
// Profile 2: rhythmic
//
// Beat-aligned gestures. Pinch every ~0.6 s (matches 100 BPM), hand height
// oscillates per bar, dynamic openness. Tests the rising-edge pinch path,
// MusicBrain note triggers, and InteractionMapper diff-throttling under
// rapid input.
// ---------------------------------------------------------------------------

export const rhythmic: PlayProfile = {
  name: 'rhythmic',
  defaultDurationSec: 60,
  nextGestureState: (t, _rng) => {
    // 100 BPM → beat every 0.6 s
    const beatPos = (t % 0.6) / 0.6;
    const beatPulse = Math.max(0, 1 - beatPos * 8); // sharp attack, decay over 75 ms
    return makeGestureState({
      rightOpenness: clamp01(0.4 + 0.5 * beatPulse + 0.1 * Math.sin(t * 2)),
      leftOpenness: clamp01(0.6 + 0.3 * Math.cos(t * 1.7)),
      handsDistance: 0.4 + 0.3 * Math.sin(t * 0.5),
      handsDistance3D: 0.4 + 0.3 * Math.sin(t * 0.5),
      meanHeight: 0.4 + 0.3 * Math.sin(t * 0.3),
      rightPinchActive: beatPos < 0.05,
    });
  },
  nextFaceState: (t, _rng) =>
    makeFaceState({
      mouthOpen: t % 4 < 0.3 ? 0.7 : 0,
    }),
};

// ---------------------------------------------------------------------------
// Profile 3: preset-hopper
//
// Same gesture stream as rhythmic, but clicks a different factory preset
// chip every 5 s. Stresses the applyVoiceShape fade-and-swap path and the
// SMART router debounce.
// ---------------------------------------------------------------------------

export const presetHopper: PlayProfile = {
  name: 'preset-hopper',
  defaultDurationSec: 60,
  nextGestureState: rhythmic.nextGestureState,
  nextFaceState: rhythmic.nextFaceState,
  panelEvents: (() => {
    const events: PanelEvent[] = [];
    const presets = FACTORY_PRESETS;
    if (!presets || presets.length === 0) return events;
    for (let i = 1; i <= 12; i += 1) {
      const preset = presets[i % presets.length]!;
      events.push({
        atSec: i * 5,
        do: (audio: AudioEngine) => {
          const params = { ...preset.params };
          delete (params as { bpm?: number }).bpm;
          audio.setParams(params);
          if (preset.voice) {
            (audio as { applyVoiceShape?: (s: unknown) => void })
              .applyVoiceShape?.(preset.voice);
          }
        },
      });
    }
    return events;
  })(),
};

// ---------------------------------------------------------------------------
// Profile 4: gestural
//
// Cycles through every static hand shape recognized by the
// GestureInterpreter — fist, open_palm, point, peace, rock_on, ok,
// thumbs_up, thumbs_down, finger_gun, three, four, call_me. Stresses the
// 3-frame consensus window + per-shape cooldown.
// ---------------------------------------------------------------------------

const ALL_SHAPES: HandShape[] = [
  'fist',
  'open_palm',
  'point',
  'peace',
  'rock_on',
  'ok',
  'thumbs_up',
  'thumbs_down',
  'finger_gun',
  'three',
  'four',
  'call_me',
];

export const gestural: PlayProfile = {
  name: 'gestural',
  defaultDurationSec: 60,
  nextGestureState: (t, _rng) => {
    // 4-second bucket per shape so the 3-frame consensus has time to settle
    // and the per-shape cooldown can release.
    const bucket = Math.floor(t / 4) % ALL_SHAPES.length;
    const shape = ALL_SHAPES[bucket]!;
    const isFistShape = shape === 'fist';
    return makeGestureState({
      hands: [
        makeHand('left', { openness: 0.5 }),
        makeHand('right', {
          openness: isFistShape ? 0.05 : 0.8,
          shape,
          isClosed: isFistShape,
        }),
      ],
      rightOpenness: isFistShape ? 0.05 : 0.8,
      leftOpenness: 0.5,
      bothFists: false,
    });
  },
  nextFaceState: () => makeFaceState({ mouthOpen: 0 }),
};

// ---------------------------------------------------------------------------
// Profile 5: chaos
//
// Random everything: per-finger curl noise, random face detection toggles,
// random preset / vibe / key / scale / waveform changes. Designed to trip
// race conditions and bound-violation bugs.
// ---------------------------------------------------------------------------

export const chaos: PlayProfile = {
  name: 'chaos',
  defaultDurationSec: 30,
  nextGestureState: (_t, rng) => {
    return makeGestureState({
      rightOpenness: rng(),
      leftOpenness: rng(),
      handsDistance: rng(),
      handsDistance3D: rng(),
      meanHeight: rng(),
      meanDepth: rng(),
      rightRoll: rng() * 2 - 1,
      leftRoll: rng() * 2 - 1,
      meanPitch: rng() * 2 - 1,
      rightPinchActive: rng() < 0.05,
      leftPinchActive: rng() < 0.05,
      bothFists: rng() < 0.02,
      bothAboveHead: rng() < 0.02,
      fingerCount: Math.floor(rng() * 11),
    });
  },
  nextFaceState: (_t, rng) =>
    rng() < 0.7
      ? makeFaceState({
          detected: true,
          mouthOpen: rng(),
          smile: rng() * 0.6,
          frown: rng() * 0.4,
          surprise: rng() * 0.4,
          anger: rng() * 0.3,
          pose: {
            yaw: (rng() * 2 - 1) * 0.5,
            pitch: (rng() * 2 - 1) * 0.3,
            roll: (rng() * 2 - 1) * 0.4,
            depth: 0,
          },
        })
      : undefined,
  panelEvents: (() => {
    const events: PanelEvent[] = [];
    const presets = FACTORY_PRESETS;
    const vibeIds = VIBE_LIST.map((v) => v.id);
    const keys = KEY_OPTIONS;
    const scales = SCALE_OPTIONS;
    const waves = WAVEFORM_OPTIONS;
    // Drive 1 panel event per second-ish; pick deterministically from the
    // index. The harness reuses the same chaos RNG only for gesture/face
    // noise — panel scheduling is deterministic here.
    for (let i = 1; i <= 25; i += 1) {
      const pick = i % 4;
      if (pick === 0) {
        const preset = presets[i % presets.length]!;
        events.push({
          atSec: i,
          do: (audio: AudioEngine) => {
            const params = { ...preset.params };
            delete (params as { bpm?: number }).bpm;
            audio.setParams(params);
            if (preset.voice) {
              (
                audio as { applyVoiceShape?: (s: unknown) => void }
              ).applyVoiceShape?.(preset.voice);
            }
          },
        });
      } else if (pick === 1) {
        const vibeId = vibeIds[i % vibeIds.length]!;
        events.push({
          atSec: i,
          do: (audio: AudioEngine) => audio.loadVibe(VIBES[vibeId]),
        });
      } else if (pick === 2) {
        const k = keys[i % keys.length]!;
        const m = scales[i % scales.length]!;
        events.push({
          atSec: i,
          do: (_audio: AudioEngine, music: MusicBrain) => {
            (music as { setScale?: (k: string, m: string) => void })
              .setScale?.(k.id, m.id);
          },
        });
      } else {
        const w = waves[i % waves.length]!;
        events.push({
          atSec: i,
          do: (audio: AudioEngine) => {
            (
              audio as {
                setVoiceWaveform?: (v: 'pad' | 'lead' | 'bass', t: string) => void;
              }
            ).setVoiceWaveform?.('pad', w.id);
          },
        });
      }
    }
    return events;
  })(),
};

// ---------------------------------------------------------------------------
// Profile 6: calm-then-violent
//
// Alternates 10 s of ambient → 10 s of rhythmic, three times. Tests how
// the system handles abrupt transitions in input intensity.
// ---------------------------------------------------------------------------

export const calmThenViolent: PlayProfile = {
  name: 'calm-then-violent',
  defaultDurationSec: 60,
  nextGestureState: (t, rng) => {
    const phase = Math.floor(t / 10) % 2;
    return phase === 0
      ? ambient.nextGestureState(t, rng)
      : rhythmic.nextGestureState(t, rng);
  },
  nextFaceState: (t, rng) => {
    const phase = Math.floor(t / 10) % 2;
    return phase === 0
      ? ambient.nextFaceState(t, rng)
      : rhythmic.nextFaceState(t, rng);
  },
};

// ---------------------------------------------------------------------------
// Profile 7: per-finger-exercise
//
// Hand center steady, but rotates which finger is curled every 1.5 s.
// Tests the per-finger layer in isolation — the aggregate openness stays
// roughly constant, so any audible audio change is being driven by the
// per-finger mappings.
// ---------------------------------------------------------------------------

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

export const perFingerExercise: PlayProfile = {
  name: 'per-finger-exercise',
  defaultDurationSec: 30,
  nextGestureState: (t, _rng) => {
    const bucket = Math.floor(t / 1.5) % FINGERS.length;
    const curled = FINGERS[bucket]!;
    const curls: Record<(typeof FINGERS)[number], number> = {
      thumb: 0,
      index: 0,
      middle: 0,
      ring: 0,
      pinky: 0,
    };
    curls[curled] = 1;
    const rightHand = makeHand('right', {
      openness: 0.7,
      fingers: { ...curls },
    });
    const leftHand = makeHand('left', {
      openness: 0.7,
      fingers: { ...curls },
    });
    return makeGestureState({
      hands: [leftHand, rightHand],
      rightOpenness: 0.7,
      leftOpenness: 0.7,
    });
  },
  nextFaceState: () => makeFaceState({ mouthOpen: 0 }),
};

// ---------------------------------------------------------------------------
// Profile registry
// ---------------------------------------------------------------------------

export const PROFILES: Record<string, PlayProfile> = {
  ambient,
  rhythmic,
  'preset-hopper': presetHopper,
  gestural,
  chaos,
  'calm-then-violent': calmThenViolent,
  'per-finger-exercise': perFingerExercise,
};

export const PROFILE_NAMES = Object.keys(PROFILES);
