# `docs/` — README assets

This folder holds the marketing/visual assets referenced from the top-level `README.md`.

## Files

| File | Description |
|---|---|
| `hero.png` | Hero image at the top of the README. AI-generated rendering: laser eyes, hand skeleton, face mesh — the look HandSynth aims for. Replace with a real photograph or screenshot when you have one you like. |
| `screenshot-onboard.png` | The onboarding card (`HANDSYNTH` title, `> Alza le mani` terminal-style subtitle, orange CTA). |
| `screenshot-skeleton.png` | The visualizer in action with hand + face skeletons rendered. |
| `screenshot-patch.png` | The PATCH editor (gear icon, top-right) showing knobs + factory presets + patches list. |

## To replace the hero

Drop a 1920×1080 (or larger) PNG/JPG at `docs/hero.png`. The README references it via a relative path so the link will just work on GitHub.

If your asset is a JPG instead of PNG, update the `![hero](docs/hero.png)` line in the top-level `README.md` accordingly (or rename the file).

## Adding more screenshots

Capture them from the running app (`pnpm dev` or the production preview), crop to taste, save under this folder, then reference from the top-level README.
