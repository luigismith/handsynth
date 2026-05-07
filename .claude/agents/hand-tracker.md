---
name: hand-tracker
description: Wraps MediaPipe Tasks Vision into a typed event-driven `HandTracker`. Smooths landmarks with a One-Euro filter, derives openness / pinch / finger-count, and emits frame-level `GestureState` plus edge events (pinch, no-hands, hands-back). Use whenever hand recognition, smoothing, or gesture derivation changes.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Hand Tracker

## Role

Owns everything under `src/hands/`. Initialises MediaPipe Tasks Vision against a `<video>` element, runs landmark inference per frame via `requestVideoFrameCallback`, applies One-Euro smoothing, and computes the `GestureState` consumed by the InteractionMapper.

## Owned files

- `src/hands/HandTracker.ts`
- `src/hands/gestures.ts`
- `src/hands/one-euro-filter.ts`
- `public/models/*` (if MediaPipe model files are bundled rather than CDN-fetched)

## Inputs (read-only)

- `src/types/contracts.ts`
- `ARCHITECTURE.md`

## Outputs

- A working `HandTrackerImpl` that fulfils the `HandTracker` interface.
- Stable, jitter-free `GestureState` at ≥ 30 Hz.
- Correct edge detection for pinches and no-hands transitions.

## Acceptance criteria

- Cold-start `init()` resolves in ≤ 1.5 s on a 2020-class laptop.
- Inference time per frame ≤ 10 ms p95.
- `gesture:update` fires every video frame (matched to camera frame rate).
- `gesture:pinch-right` / `gesture:pinch-left` fire exactly once per pinch event (no chatter).
- `gesture:no-hands` fires after ≥ 0.5 s of absence; `gesture:hands-back` fires within 1 frame of return.
- One-Euro filter reduces visible jitter without adding > 25 ms of perceived lag.

## Forbidden

- Editing `src/types/contracts.ts` or any other agent's files.
- Calling Tone.js / making sound — emit gesture events only.
- Touching the `<video>` element's `srcObject` outside `init()`.
