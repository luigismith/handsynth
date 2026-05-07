# HandSynth — Architecture

**Stack:** Vite + Vanilla TS · Tone.js v15 · @mediapipe/tasks-vision · p5.js (instance mode) · @tonaljs/tonal · pnpm · ES2022 · static deploy.

**Targets:** gesture-to-sound latency < 20 ms · 60 fps stable · gzipped JS bundle < 500 KB excluding the MediaPipe model.

This document is the contract between the eight agents that build HandSynth. Module boundaries here match the interfaces in `src/types/contracts.ts` exactly. **Do not edit a module you do not own.** If you need a new public method, ask the architect to update the contract first.

---

## 1. Module map

| Folder | Owner | Purpose |
| --- | --- | --- |
| `src/audio/` | audio-engineer | Tone.js voices, FX chain, AudioWorklets, master analyser. |
| `src/audio/voices/` | audio-engineer | Pad / Lead / Bass / Perc voice classes. |
| `src/audio/fx/` | audio-engineer | Master FX chain (filter, saturator, delay, reverb, compressor, analyser). |
| `src/audio/worklets/` | audio-engineer | AudioWorkletProcessors (saturator, etc). |
| `src/music/` | music-brain | Generative engine: clock, harmony, sequencer, generator. |
| `src/hands/` | hand-tracker | MediaPipe wrapper, gesture derivations, One-Euro filter. |
| `src/interaction/` | interaction-mapper | Gesture → audio param + music input mapping. |
| `src/visual/` | visualizer | p5 instance-mode FFT visualization. |
| `src/ui/` | ux-curator | Onboarding flow, VibeSelector chip strip, autopilot fallback. |
| `src/presets/` | architect (data) | Vibe preset objects; consumed read-only. |
| `src/types/` | architect | Public contracts; no other agent edits this. |
| `tests/` | qa-listener | Latency tests, perf budgets, smoke tests. |

---

## 2. Data flow

```
┌────────────┐  GestureState   ┌──────────────────┐  AudioEngineParams   ┌────────────┐
│ HandTracker│ ──────────────▶ │InteractionMapper │ ───────────────────▶ │ AudioEngine│
└────────────┘                 │                  │   MusicBrainInput    │            │
                               │                  │ ───────────────────▶ │            │
                               └──────────────────┘                       │            │
                                                                          │            │
                               ┌──────────────────┐  NoteEvent /          │            │
                               │   MusicBrain     │  ChordEvent /         │            │
                               │ (clock, scale,   │  drum triggers        │            │
                               │  generator)      │ ───────────────────▶ │            │
                               └──────────────────┘                       └─────┬──────┘
                                                                                │
                                                                                │ AnalyserNode
                                                                                ▼
                                                                          ┌────────────┐
                                                                          │ Visualizer │
                                                                          └────────────┘
```

Two channels feed the AudioEngine:
1. **Continuous params** from `InteractionMapper.setParams()` — smoothed, never trigger sound on their own.
2. **Discrete events** from `MusicBrain` (notes, chords, drums) and from `InteractionMapper` (stab on right pinch).

The Visualizer is read-only relative to audio (it taps the master analyser).

---

## 3. Lifecycle

1. **Page load** — `index.html` mounts the canvas + video + UI overlay. `src/main.ts` constructs subsystems but does **not** start audio.
2. **Onboarding** — `Onboarding` shows the "permetti webcam" CTA + 3-icon gesture cheatsheet.
3. **User gesture (button click)** — required for autoplay policy. On click:
   - `await audio.init()` → starts `Tone.context`, builds master chain, loads worklets.
   - `await hands.init(videoEl)` → asks for `getUserMedia({ video: true })`, loads MediaPipe model.
   - `interaction.attach({ audio, music, hands })`.
   - `music.start()` and `hands.start()` and `interaction.start()`.
   - `visual.mount(canvas, ...)`.
4. **Steady state** — 60 fps loop. HandTracker runs via `requestVideoFrameCallback`. Music transport runs on Tone.js's worker-driven clock.
5. **No-hands fallback** — if `noHandsDuration > 2 s`, InteractionMapper enters drone mode (low intensity, no triggers), AudioEngine `setMute(false)` but with `masterDuck = 0.6`.
6. **Webcam denial** — Onboarding shows autopilot mode: HandTracker is not started; InteractionMapper drives Music with a synthetic gesture stream.

---

## 4. Audio context strategy

- **Single shared context.** Always use `Tone.getContext()` (or `Tone.context`). Never construct a raw `AudioContext` elsewhere.
- **Lazy init from user gesture.** `AudioEngine.init()` calls `await Tone.start()`. Calling it before a user gesture will leave the context suspended.
- **Resume on visibility regain.** If the tab is backgrounded the context may suspend; on `visibilitychange` → `Tone.context.resume()`.
- **Output: master analyser → destination.** Voices are routed through the master FX chain (see §6) before destination.

---

## 5. AudioWorklet integration

We use Vite's URL-import pattern — no custom plugin required.

```ts
// inside AudioEngine.init()
import saturatorUrl from './worklets/saturator-processor.ts?worker&url';
await (Tone.getContext().rawContext as AudioContext).audioWorklet.addModule(saturatorUrl);
```

Vite emits `saturator-processor.ts` as its own ES module chunk and provides a stable URL. The processor file declares `AudioWorkletProcessor` / `registerProcessor` ambiently (see `saturator-processor.ts`) because those globals exist only in the worklet scope.

> If a future processor needs DOM types, set its file's first line to `/// <reference no-default-lib="true" />` and pull in `@types/audioworklet`. Until then ambient declarations keep the build simple.

---

## 6. Master FX chain (immutable order)

```
voice ──> filter (LP, resonance) ──> saturator (worklet) ──> delay (ping-pong) ──┐
                                                                                  │
                            ┌──────────────────────────────────────────────────────┘
                            ▼
              reverb (convolver, /ir/hall.wav with algorithmic fallback)
                            │
                            ▼
              compressor (master glue, side-chain input from kick)
                            │
                            ▼
              analyser (FFT 1024) ──> destination
```

The order is contractual. Voices connect only to `MasterChain.input`; nothing else taps the destination directly.

---

## 7. Latency budget (< 20 ms gesture → audio)

| Stage | Budget |
| --- | --- |
| Webcam frame → MediaPipe inference (CPU/GPU) | ~10 ms |
| GestureState derivation + One-Euro filter | < 1 ms |
| InteractionMapper mapping + setParams | < 2 ms |
| AudioEngine.trigger* → Tone scheduling → audible | < 8 ms (one render quantum @ 128/48000 = 2.7 ms + scheduling slack) |
| **Total p95** | **≤ 20 ms** |

`qa-listener` enforces this via `tests/integration/latency.test.ts`.

---

## 8. Threading

**Default: main thread.** MediaPipe runs in the same context as the rest of the app; HandTracker uses `videoEl.requestVideoFrameCallback` to sync inference to actual frames (avoids redundant work and is wall-clock cheaper than `requestAnimationFrame`).

**Fallback: worker.** If profiling shows MediaPipe stealing > 6 ms from the main thread, move it into a `Worker` and post `GestureState` back. Tone.js already runs its scheduler in its own worker, so the audio thread is unaffected either way.

**Audio render thread:** isolated via AudioWorklet (`saturator-processor.ts`). No DOM access, no shared mutable state.

---

## 9. State ownership matrix

| State | Owner |
| --- | --- |
| `Tone.context`, voice nodes, FX nodes, master analyser | AudioEngine |
| Smoothed `AudioEngineParams` | AudioEngine (signals) |
| Transport, current chord index, scale, bar/beat | MusicBrain |
| Generative motif memory, fill state | MusicBrain |
| MediaPipe runtime, One-Euro filter state, derived `GestureState` | HandTracker |
| Active `VibePreset` (shared mutable ref) | InteractionMapper (sets), Audio + Music (read) |
| p5 sketch instance, FFT bins | Visualizer |
| Onboarding stage, autopilot toggle | ux-curator (UI module) |

---

## 10. Error / recovery contract

| Failure | Behavior |
| --- | --- |
| Webcam permission denied | Onboarding shows autopilot mode banner; HandTracker.start() is not called; InteractionMapper.start() runs in autopilot. |
| MediaPipe model fetch fails | `HandTracker.init()` rejects; UI shows retry CTA. |
| AudioContext suspended (tab background) | `visibilitychange` → `Tone.context.resume()`. |
| `hall.wav` missing | AudioEngine logs a warning and substitutes Tone.js algorithmic Reverb. |
| `noHandsDuration > 2 s` | InteractionMapper enters drone mode (low intensity, fades pad). |
| Frame inference timeout > 50 ms repeatedly | HandTracker emits `error`; ux-curator shows soft-fallback toast. |
| Worklet add fails | AudioEngine substitutes a Tone.js `Distortion` for saturator. |

---

## 11. Performance contract

- 60 fps wall-clock, p99 frame ≤ 20 ms.
- JS bundle ≤ 500 KB gzipped (excluding MediaPipe model + IR wav). Tone, MediaPipe, p5 each go in their own manual chunk (see `vite.config.ts`).
- No Garbage spikes > 4 MB/s during steady-state play.
- AudioContext load (Web Audio dev tools) ≤ 30 % on a 2020-class laptop.

---

## 12. Testing strategy

- **Unit:** `src/hands/gestures.ts`, `src/hands/one-euro-filter.ts`, `src/music/harmony.ts` are pure and easily testable. qa-listener writes targeted tests for each.
- **Integration:** `tests/integration/latency.test.ts` measures synthetic-gesture-to-audio latency.
- **Smoke:** boot the app in headless Chromium (Vitest + happy-dom or Playwright follow-up) and assert no console errors.
- **Manual:** vibe walkthrough — for each of the four vibes, verify timbre and mood match the spec.

---

## 13. Agent ownership matrix

Each row lists files an agent may write. Anything not listed is read-only for that agent.

| Agent | Files |
| --- | --- |
| architect | `ARCHITECTURE.md`, `README.md`, `package.json`, `vite.config.ts`, `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `index.html`, `src/types/contracts.ts`, `src/presets/vibes.ts`, `src/main.ts` (initial stub), `.claude/agents/*.md`. |
| audio-engineer | `src/audio/**`. May ask architect for a new param in contracts; never edits contracts directly. |
| music-brain | `src/music/**`. |
| hand-tracker | `src/hands/**`. May add `public/models/*` for MediaPipe assets if checked-in is preferred. |
| interaction-mapper | `src/interaction/**`. |
| visualizer | `src/visual/**`. |
| ux-curator | `src/ui/**`, `src/main.ts` (final wiring), updates to `index.html` for layout. |
| qa-listener | `tests/**`, may emit a `TEST_REPORT.md` at the project root. |

> Collisions: `src/main.ts` starts as architect's stub, then is owned by ux-curator from Phase 2 onward. `index.html` likewise.
