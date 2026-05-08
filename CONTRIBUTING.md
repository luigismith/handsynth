# Contributing to HandSynth

Thanks for considering a contribution. HandSynth is an experiment in body-as-instrument musical interfaces; it lives by a few opinions.

## Ground rules

- **Don't break the audio.** The app is real-time. Any change that introduces audio glitches under typical use is a regression and won't merge.
- **Don't make the wrong note possible.** The music brain (`src/music/`) snaps every generated pitch to a chord-tone or consonant tension. New generators must keep that property.
- **Honor the module contract.** Modules in `src/audio/`, `src/music/`, `src/hands/`, `src/face/`, `src/visual/`, `src/interaction/`, `src/ui/` are owned independently and connected only via interfaces in `src/types/contracts.ts`. Don't reach across module boundaries.

## Setup

```sh
pnpm install
pnpm dev
```

Tested on Node 20+. Webcam needed for the hand/face tracking modules to run end-to-end.

## Quality gates (run before opening a PR)

```sh
pnpm typecheck   # tsc strict
pnpm lint        # eslint
pnpm test        # vitest — everything must pass
pnpm build       # vite production build
```

CI runs all four on every push and PR.

## Adding a feature

### Adding a new gesture → audio mapping

1. If a new derived signal is needed, add it to `Hand` / `GestureState` / `FaceState` in `src/types/contracts.ts`.
2. Compute it as a pure function in `src/hands/gestures.ts` or `src/face/face-gestures.ts`. Add unit tests next to it.
3. Wire it into the corresponding tracker in `src/hands/HandTracker.ts` / `src/face/FaceTracker.ts`. Add One Euro filtering for the smoothed scalar.
4. Add the audio-param mapping in `src/interaction/InteractionMapper.ts` `handleGestureUpdate` or `applyFaceModulation`. Use a constant near the existing tuning constants and document its range in the file's top-of-file comment.
5. Add a test in `InteractionMapper.test.ts` asserting the input → output relationship.

### Adding a visual element

`src/visual/sketch.ts` is the single place all per-frame drawing happens. Follow the layered draw order documented at the top of the file. Avoid per-frame allocations — use the particle pool pattern in `particles.ts` if you need many objects.

### Adding a UI panel

Modules in `src/ui/` follow a consistent pattern: a class with `mount(parent, deps): void`, `unmount(): void`, plus optional `setVisible(b)`. CSS lives entirely in `src/ui/styles.ts` (cyberpunk orange/grey palette via the `--hs-*` tokens). Keep panels keyboard-accessible and `prefers-reduced-motion`-aware.

## Commits

- Conventional-commit-ish prefix: `feat:`, `fix:`, `perf:`, `ux:`, `chore:`, `test:`, `docs:`.
- Title under 70 chars; details in the body.
- One logical change per commit. The repo history is meant to be readable.

## License

By contributing you agree your contribution is licensed under the [MIT License](./LICENSE) along with the rest of the project.
