# HandSynth — Desktop Build Pipeline

Distribution wrappers for the HandSynth web app, packaged via **Electron** +
**electron-builder**. The renderer is the same Vite-built bundle that ships to
the web — no code paths fork on platform.

## Prerequisites

- Node ≥ 20, pnpm 9
- Run `pnpm install` once after pulling — this fetches Electron (~120 MB) and
  electron-builder.

## Develop locally

```sh
pnpm electron:dev
```

Spawns Vite (`http://localhost:5173`) and waits for it to be ready, then
launches Electron pointed at the dev server. Hot-module reload works exactly
as in the browser. DevTools opens detached.

## Build a Windows installer (run on Windows)

```sh
pnpm electron:build:win
```

Output: `release/HandSynth-Setup-<version>.exe` — an NSIS installer with
component selection, configurable install dir, and Start-Menu + Desktop
shortcuts.

## Build a macOS installer (run on macOS)

```sh
pnpm electron:build:mac
```

Output: `release/HandSynth-<version>-<arch>.dmg`.

> **Cross-build note**: building a usable `.dmg` on Windows is unreliable —
> code-signing, notarization, and the `dmg` license/background helpers all
> require a real macOS host (or a Mac CI runner). For end-user distribution,
> always build the macOS artifact on a Mac.

## Build for the current platform (auto-detect)

```sh
pnpm electron:build
```

## Where artifacts land

```
release/
├── HandSynth-Setup-0.1.0.exe          # Windows NSIS installer
├── HandSynth-0.1.0-arm64.dmg          # macOS Apple-Silicon DMG
├── HandSynth-0.1.0-x64.dmg            # macOS Intel DMG
└── win-unpacked/   mac-arm64/   mac/  # the unpacked app trees
```

## Replacing the placeholder icon

The current `electron/icons/icon.png` is a programmatically-generated orange
"H" on charcoal. To ship a properly-iconned installer:

1. Drop a 1024×1024 PNG of the real icon at `electron/icons/icon.png`.
2. Generate the platform-specific formats per
   [`electron/icons/README.md`](./icons/README.md).
3. Re-run the relevant `pnpm electron:build:*` command.

## Code signing & notarization (out of scope here)

For public macOS distribution you'll need:

- An Apple Developer ID (`Developer ID Application` certificate)
- App-specific password for `notarytool`, set as
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env vars
- Add an `afterSign` hook to `package.json` that runs `electron-notarize`

For Windows, an EV / OV code-signing certificate plus
`CSC_LINK` + `CSC_KEY_PASSWORD` env vars is enough for electron-builder to
sign the resulting `.exe` automatically.

These are deliberately *not* wired up in this initial setup — the unsigned
artefacts are usable for internal testing and friends-and-family distribution,
which is the current goal.

## Permissions / CSP

The main process auto-grants the **camera** permission to the loaded origin —
the in-app onboarding click is the gate. The Content-Security-Policy is set
via `webRequest.onHeadersReceived` to allow:

- `connect-src` / `script-src` from `cdn.jsdelivr.net` (MediaPipe WASM)
- `connect-src` from `storage.googleapis.com` (the `.task` model files)

If you change MediaPipe asset hosts, update `buildCspHeader()` in
`electron/main.cjs`.
