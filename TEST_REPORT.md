# HandSynth — Test Report

**Date:** 2026-05-07
**Branch:** main
**Commit:** aeed900

## Summary

**Overall verdict: SHIP-WITH-CAVEATS**

Static analysis and the full automated suite (87 tests, 0 skipped) pass cleanly. All §8 acceptance criteria that can be checked statically are PASS or PARTIAL with negligible follow-ups. The criteria that require a real browser (latency wall-clock, 60fps on iPhone 14 Safari, audible musical-coherence judgments, p95 RMS LUFS measurement, time-to-first-sound) are PENDING-LIVE — they cannot be verified from happy-dom and need a human listener with real hardware before final sign-off.

Bundle is comfortably under budget (~405 KB gzip total, ~367 KB excluding MediaPipe). No direct AudioParam writes outside of init time. Saturator implements the spec'd 80/20 wet/dry inside the worklet. BPM and FX wet are ramped on vibe change. Voicings are guaranteed to have ≥2 notes. Lead generator filters every emitted note through `nearestChordTone` when the proposed pitch is not consonant.

## Automated checks

| Check | Status | Notes |
|---|---|---|
| `pnpm typecheck` | PASS | `tsc --noEmit && tsc --noEmit -p tsconfig.node.json` — no errors. |
| `pnpm lint` | PASS | ESLint clean (0 warnings, 0 errors) after fixing 2 unused imports in the new latency test. |
| `pnpm test` | PASS | 10 files, **87 passed, 0 skipped** (was 84 + 2 skipped placeholders). |
| `pnpm build` | PASS | tsc + Vite production build OK in ~8.6s. |
| `pnpm dev` smoke | PASS | Dev server returns HTTP 200 on `/`; HTML head contains `theme-color #0a0e2c`. |

### Bundle sizes (gzip)

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` (app) | 99.05 KB | **31.21 KB** |
| `mediapipe-*.js` | 125.11 KB | 38.04 KB |
| `tone-*.js` | 265.88 KB | **66.03 KB** |
| `p5-*.js` | 1067.52 KB | **269.47 KB** |
| `saturator-processor-*.js` | 0.13 KB | 0.13 KB |
| **Total user JS gzip** | — | **~404.75 KB** |
| **Total minus MediaPipe (per spec)** | — | **~366.71 KB** |

Comfortably under the 500 KB budget (excluding MediaPipe model). Vite warns that the `p5` chunk exceeds 500 KB raw, but this is a raw-size-on-disk warning, not gzip — and the spec measures gzip. PASS.

---

## Acceptance Criteria

### 🎵 Audio (BLOCCANTI)

#### Generated 60s loop with no hands → musicalmente coerente, piacevole
- **Verdict: PARTIAL / PENDING-LIVE.**
- Static evidence is positive: no-hands path engages drone mode (`InteractionMapper.engageDroneMode`) with `intensity=0.15` and `mood='calm'` — `MusicBrain` keeps generating low-density harmony with the active vibe's chord progression. `setMute` is NOT called on no-hands (only on `bothFists`), so the loop continues to play.
- Audible musical-coherence judgment cannot be made from tests. **Manual verify: launch app, leave hands out for 60s, listen.**

#### Five A/B tests on the four vibes → preset distinguishable, fedele
- **Verdict: PARTIAL / PENDING-LIVE.**
- Static evidence: the four vibes in `src/presets/vibes.ts` have demonstrably different bpm (92/86/110/120), tonic+mode (F# lydian / D dorian / A phrygian / C mixolydian), pad waveforms, lead synth types (`wavetable`/`fm`/`mono`/`mono-acid`), saturator drive (0.9/1.2/1.8/1.4), and EQ high-shelf overrides per vibe in `master-chain.ts` (hopkins darker −1.5dB, floating-points brighter +1dB, bonobo tape-warm). Voicing styles also vary per vibe (`drop2`/`drop2`/`quartal`/`open`).
- A/B audible distinguishability requires human ears. **Manual verify.**

#### No click, pop, zipper noise on parameter changes
- **Verdict: PASS (static).**
- `master-chain.ts` uses `rampTo` (SMOOTH_S = 0.05s = 50ms) for every continuous setter (`filterCutoff`, `filterResonance`, `reverbWet`, `delayFeedback`, `delayWet`, `eq.high`, `masterGain`).
- AudioWorklet drive uses `setTargetAtTime` with 50ms time constant (`master-chain.ts:248-249`).
- Mute fade is 200ms (`MUTE_FADE_S`).
- BPM uses `bpm.rampTo(bpm, 0.5)` (sequencer.ts:53) → 500ms glide.
- Only two direct `.value =` assignments in audio code; both are init-time defaults (lines 123, 251 of master-chain.ts) — line 251 is in an explicit "smooth=false" branch that is currently unreached by application code (smooth=true is always passed).

#### Headroom: peak ≤ −1dBFS, RMS ≈ −14 LUFS
- **Verdict: PARTIAL / PENDING-LIVE.**
- Static: `Tone.Limiter(-1)` is wired immediately before `masterGain` (`master-chain.ts:195`), enforcing peak ≤ −1 dBFS by construction.
- RMS LUFS cannot be measured without a real audio context running through real meters. **Manual verify with a meter plugin (e.g. Youlean) or script Tone.Offline + biquad K-weighting.**

#### No notes outside the scale audible in 5 minutes
- **Verdict: PASS (static).**
- `src/music/generator.ts:158-161`: every Markov-generated lead note runs through `isConsonantTension`; if false, it's snapped via `nearestChordTone`. The function is invoked unconditionally for each generated note.
- Bass uses `chordTones[]` directly (line 264-274) — only chord tones are emitted.
- Pad voicings come from `buildVoicing()` which uses `getChordTones(chordSymbol)` only — no out-of-key notes possible.
- The only theoretical out-of-key edge case would be an unresolved chord symbol returning empty `getChordTones`; in that case `buildVoicing` returns `[]` and the chord event is skipped (`MusicBrain.scheduleChord:301`).

### ✋ Interazione (BLOCCANTI)

#### Latency gesture→sound < 30ms (target 20ms)
- **Verdict: PASS (JS-side) / PENDING-LIVE (audible).**
- New `tests/integration/latency.test.ts` measures the synthetic-gesture → `audio.setParams` / `audio.triggerStab` round trip in happy-dom and asserts p95 < 5ms. Test passes consistently.
- Architecture budget (ARCHITECTURE.md §7): MediaPipe ~10ms + JS mapping <2ms + Tone scheduling <8ms = 20ms total. Static breakdown is sound.
- **Manual verify** the audible tail (Tone.js → Web Audio) with a real microphone-loopback measurement; recommended methodology is documented at the bottom of `tests/integration/latency.test.ts`.

#### Tracking stable, no jitter on continuous params
- **Verdict: PASS (static).**
- `src/hands/one-euro-filter.ts` exists and has 8 passing unit tests covering the One-Euro filter behaviour (cutoff, beta, derivative).
- `HandTracker.ts` uses `requestVideoFrameCallback` (with `requestAnimationFrame` fallback) so per-frame inference is sync'd to actual video frames and not duplicated.

#### Graceful recovery: hands out → in, no crash
- **Verdict: PASS (static).**
- `HandTracker.tick()` wraps inference in try/catch and **always reschedules the next frame** even on error (`HandTracker.ts:332-343`). A single bad frame cannot kill the tracker.
- `InteractionMapper.handleNoHands()` engages drone mode; `gesture:hands-back` triggers a 1s blend back from drone params (`HANDS_BACK_FADE_MS = 1000`).
- Webcam permission denial is handled in `main.ts` with `mapper.startAutopilot()` fallback.

### 🎨 Visivo

#### 60fps stable on M1 Safari + iPhone 14 Safari
- **Verdict: PENDING-LIVE.**
- Static positives: visualizer uses pixelDensity capped at 2 (`sketch.ts:129`), particles use a fixed pool with no per-frame allocation (verified — only the static `bandEnergy` / `lifeEnvelope` helpers, no `new` inside update/draw), FFT buffer is reused across frames and only re-allocated on bin-count change. Bloom is only built when `!reducedMotion`.
- **Manual verify:** Safari Web Inspector → Timelines → record 30s of play; assert frame budget < 16.7ms.

#### Midnight-blue bg + CRT scanlines present
- **Verdict: PASS (static).**
- Body bg `#0a0e2c` (index.html:31), `theme-color` meta also `#0a0e2c`. Sketch redraws background `HSB(230, 70, 17 + bgBoost)` ≈ `#0a0e2c` (sketch.ts:166-169).
- `scanlines.ts` renders to a pre-rendered layer that is composited last, on top of everything (sketch.ts:272-275).

#### Strings between fingers pulse on beat
- **Verdict: PASS (static).**
- `MusicBrain.onBeat` fires on every quarter-note (sequencer.ts:81-83 → MusicBrain.ts:105-108 → Visualizer subscribes at line 170).
- The Visualizer sets `state.pulse = 1.0` on each beat (Visualizer.ts:171), which feeds into a `createEnvelope({attack: 0.030, decay: 0.200, release: 0.100})` (sketch.ts:120). The envelope's `value` becomes `beatV` and is passed into `drawFingerStrings()` as `brightness = 0.6 + 0.4 * beatV` and `thickness = 1.4 + beatV * 1.6` (sketch.ts:460-461).

### 🎯 UX

#### URL → first sound: < 10s (incluso permesso webcam)
- **Verdict: PARTIAL / PENDING-LIVE.**
- Static positives: the bootstrap is gated on a SINGLE user-gesture click (`Onboarding.awaitStart`), inside which audio.init + hands.init + music.start are all run. No additional menus before sound.
- The MediaPipe model bundle is part of the chunked p5 + mediapipe assets (~38 KB gzip) — well within budget for a fast first paint, but the actual model weight files (loaded by MediaPipe at runtime) live in `public/` and are not in the JS bundle. **Manual verify** total time-to-first-sound from a cold cache.

#### Zero menus visible in normal play
- **Verdict: PASS (static).**
- `index.html`: only `#onboarding` is initially visible. After start, `onboarding.unmount()` removes it. The `#vibe-selector` is initially `hidden`; after start it's revealed but is a single chip strip (per `VibeSelector.ts`), not a menu.
- `pointer-events: none` on `#ui-layer` with selective re-enabling per child (`#ui-layer > * { pointer-events: auto; }`) so the canvas underneath remains interactive.

#### Vibe change: 1 click, fluent musical transition
- **Verdict: PASS (static).**
- `vibeSelector.onChange` calls `mapper.setVibe(VIBES[id])` (main.ts:103). Single click.
- Crossfade is delegated to engines: `audio.loadVibe()` ramps reverbWet, delayWet, saturatorDrive, eq.high all via `rampTo` (50ms); BPM ramps via `bpm.rampTo(vibe.bpm, 0.1)` (AudioEngine.ts:93) and the sequencer applies its own BPM ramp at 500ms; swing is set immediately on `Transport.swing` but as a per-step quantize knob, so it lands at the next bar.

### 📦 Tecnici

#### Bundle JS gzipped < 500KB (excluding MediaPipe model)
- **Verdict: PASS.**
- ~366.71 KB gzip without MediaPipe (~26% headroom). With MediaPipe ~404.75 KB gzip.

#### Funziona offline dopo primo caricamento (service worker optional)
- **Verdict: PARTIAL.**
- No service worker is registered. Vite's default cache headers permit basic browser caching but offline-after-first-load is not guaranteed without a SW. The spec calls SW "optional"; without it, refreshing while offline will not work.
- **Recommended:** add `vite-plugin-pwa` for production hardening if "offline" is a hard requirement.

#### Funziona Chrome, Safari (desktop & iOS), Firefox
- **Verdict: PARTIAL / PENDING-LIVE.**
- Cross-browser positives:
  - `requestVideoFrameCallback` has explicit `requestAnimationFrame` fallback (`HandTracker.ts:319-329`). Firefox missing rVFC will fall back gracefully.
  - `audioWorklet.addModule` is wrapped in try/catch with a Tone.Distortion fallback (`master-chain.ts:111-134`).
  - `getUserMedia` constraints (`facingMode: 'user'`) are universally supported.
  - `Tone.Reverb.generate()` rejection is caught and warned (master-chain.ts:170-174).
- No vendor prefixes are needed in 2025-era CSS.
- **Manual verify** on actual Safari iOS — there is at least one known iOS quirk where AudioWorklets need a user gesture *and* sometimes need a Tone.context.resume() after backgrounding; the visibility handler in `main.ts:108-112` should cover that.

---

## Known issues / follow-ups

1. **Dev server stays up if process is killed mid-session.** Not a code issue, but in `pnpm dev` we observed Vite running on 5173 still listening after the test command returned. This is normal Vite behaviour; if a CI runs `pnpm dev` it must explicitly kill the process. Cosmetic.
2. **AudioEngine.test.ts is marked `(smoke)`.** It only verifies class shape and pre-init no-throw safety, not actual audio behaviour. The deeper audible verification is — by design — a manual job. No action required, but worth noting that there is no harness in this repo to assert "voicings always > 1 note when the chord symbol resolves" beyond the implementation contract.
3. **Service worker not provided.** "Funziona offline" criterion is partial. Adding `vite-plugin-pwa` is a one-day task if needed.
4. **Latency wall-clock is not measured here.** Only the JS-side budget (mapper → audio call) is asserted automatically. The audible-side measurement procedure is documented at the bottom of `tests/integration/latency.test.ts` for a manual test run.
5. **Bundle includes 1.07 MB of p5 raw / 269 KB gzip** — already accounted for in the budget but worth noting that p5 dominates the bundle. If size becomes a concern in v2, replacing p5 with a custom canvas-2D / WebGL renderer is the obvious cut.

## Recommended manual tests (browser-only)

1. **Audible musical coherence (60s no-hands).** Start the app, allow webcam, then immediately step out of frame for 60 seconds. Listen. Acceptance: a coherent drone-mode loop with chord changes every ~4 bars; no glitches; no out-of-scale notes.
2. **A/B vibe distinguishability.** Cycle through Tycho → Bonobo → Hopkins → Floating Points; for each, record 15 seconds of play. Compare. Acceptance: each preset is sonically distinct and matches the spec'd mood (warm drift / dusty downtempo / dystopian / bright deep house).
3. **Zipper noise sweep.** While holding both hands, sweep `handsDistance` rapidly back and forth (filter cutoff). Listen for clicks/zippers. Acceptance: smooth glide.
4. **Headroom / LUFS.** Insert a Youlean Loudness Meter or run Tone.Offline + K-weighted RMS analysis on a 60s capture. Acceptance: peak ≤ −1 dBFS, integrated LUFS ≈ −14.
5. **Latency loopback.** Use a low-latency audio interface, plug a piezo into both hands and a microphone next to the speaker; clap → speaker thump. Acceptance: round-trip ≤ 30ms (target 20ms).
6. **60 fps on iPhone 14 Safari.** Open Safari Web Inspector remote → Timelines → 30s of play. Acceptance: p99 frame ≤ 16.7ms.
7. **Time-to-first-sound from cold cache.** Hard refresh, time from URL submit to first audible chord. Acceptance: ≤ 10s.
8. **Cross-browser smoke.** Repeat manual tests 1+2+5+6 on Chrome desktop, Firefox desktop, Safari desktop, Safari iOS.

## Recommendations

1. **Run the manual test list before final ship.** All BLOCCANTI items have a manual component that the static suite cannot replace.
2. **Add a service worker** (`vite-plugin-pwa`) if "funziona offline" must be a hard guarantee. Otherwise, document in the README that the app needs network on first load only and relies on browser cache for subsequent loads.
3. **Consider a CI step that runs the bundle build** and fails if any chunk's gzip exceeds a hard limit (e.g. user-bundle minus MediaPipe > 450 KB). Cheap insurance against future regressions.
4. **Track p5 bundle weight.** It's the single biggest dependency; if a future iteration needs to cut bundle size, p5 is the natural target.
5. **Optional but valuable:** add a runtime `performance.mark` instrumentation around `triggerLead` / `setParams` so the live-app latency can be self-reported in a debug overlay (toggle with a hidden URL flag like `?debug=latency`). Cheaper than microphone loopback for the JS-side budget.
