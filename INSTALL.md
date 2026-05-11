# HandSynth — Install & Run

> 🇮🇹 [Versione italiana →](./INSTALL.it.md)

HandSynth is a **gestural instrument for live performance**. It runs in three ways:

1. **Web (recommended for stage)** — `pnpm dev` or `pnpm preview` in a desktop Chrome / Edge / Safari window. Lowest overhead, fastest startup, easiest to relaunch mid-show if something goes wrong.
2. **Desktop app** — packaged Electron binary (`.dmg` on Mac, `.exe` on Windows). Slightly heavier but lives in the dock and runs offline once installed.
3. **From source** — for tweaking, building, or contributing.

This guide covers **macOS** end-to-end. Windows users: see the [v0.2.0 release page](https://github.com/luigismith/handsynth/releases/tag/v0.2.0) for the pre-built `.exe` installer, or follow the same `pnpm install` / `pnpm dev` flow.

---

## Quick start (web — no install, just clone)

If you just want to play, the web mode is the fastest path. No Electron build, no DMG, no code signing.

### Prerequisites

You need three things on your Mac:

- **macOS 12 Monterey or newer** (older versions don't ship a Tone.js-friendly Safari)
- **Node 20+** — `node -v` to check
- **pnpm 9.15+** — `pnpm -v` to check

If you don't have Node, install it via [nvm](https://github.com/nvm-sh/nvm):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
# restart your terminal, then:
nvm install 20
nvm use 20
```

If you don't have pnpm:

```sh
npm install -g pnpm@9.15.0
```

### Clone and run

```sh
git clone https://github.com/luigismith/handsynth.git
cd handsynth
pnpm install
pnpm dev
```

Open **http://localhost:5173** in Chrome, Edge, or Safari. Click the orange **PERMETTI WEBCAM E INIZIARE** button (or **ALLOW WEBCAM AND BEGIN** if your browser is in English — the UI auto-detects locale). Raise your hands.

That's the whole install. Everything is bundled — Tone.js, MediaPipe, p5.js, the music brain. No Docker, no Python, no audio drivers to configure.

### For stage use

Once you've verified `pnpm dev` works, use this command instead during the actual show:

```sh
pnpm preview
```

This serves the **production build** — no Vite HMR overhead, lighter on the main thread, much more stable for a long set. Run `pnpm build` once first, then `pnpm preview` for every subsequent launch.

Pre-show ritual:

```sh
git pull          # if you've been pulling new features mid-tour
pnpm install      # only if deps changed
pnpm build        # produces dist/
pnpm preview      # serves dist/ at http://localhost:4173
```

Always do a 30-second sound check on the actual show machine + lighting + webcam before going live.

---

## Desktop app build (`.dmg`)

The Electron desktop build wraps the web app in a native window. Useful if you want HandSynth in your Mac dock, or if the venue's network blocks localhost-style web apps.

### Prerequisites

In addition to Node + pnpm:

- **Xcode Command Line Tools** — `xcode-select --install` (Electron's native deps need this)
- Approximately **2 GB of free disk** for the Electron build cache

### Build both arm64 + x64

```sh
pnpm electron:build:mac
```

This produces two DMG files in `release/`:

- `HandSynth-0.x.0-arm64.dmg` — Apple Silicon (M1 / M2 / M3 / M4)
- `HandSynth-0.x.0-x64.dmg` — Intel Macs

Pick the one matching your machine. Double-click the DMG, drag **HandSynth** into Applications.

### First launch — "unidentified developer" warning

The DMG is **not signed** with an Apple Developer certificate (HandSynth is a free open-source project, not an App Store app). The first time you open it, macOS will block it.

To allow it:

1. Try to open the app once — macOS will refuse and show a Gatekeeper dialog
2. Open **System Settings → Privacy & Security**
3. Scroll to **Security** section — you'll see "HandSynth was blocked from use because it is not from an identified developer"
4. Click **Open Anyway**
5. Confirm the dialog that appears

You only need to do this once per install. After that, HandSynth opens normally.

If you prefer command-line:

```sh
xattr -dr com.apple.quarantine /Applications/HandSynth.app
```

This strips the quarantine flag and skips the dialog.

### Webcam permission

The first time HandSynth needs the webcam, macOS shows a permission prompt. **Click Allow**. If you accidentally clicked Deny, fix it in **System Settings → Privacy & Security → Camera** — toggle HandSynth on.

If you don't see HandSynth in the Camera list, the permission grant didn't get recorded. Quit the app, then relaunch and trigger the camera request again.

### Dev mode (live reload)

For developing or tweaking the source against the desktop window:

```sh
pnpm electron:dev
```

This starts Vite + Electron with HMR — your edits in `src/` apply immediately in the running app window. Don't use this on stage; use `pnpm preview` instead.

---

## Build from source (any platform)

Same as the web flow above — `pnpm dev` is the from-source experience. The only difference vs. the cloned repo is you'd typically branch off, commit, push.

```sh
git clone https://github.com/luigismith/handsynth.git
cd handsynth
pnpm install
pnpm typecheck          # tsc strict — 0 errors expected
pnpm lint               # 0 errors expected (3 pre-existing warnings in src/visual/ are fine)
pnpm exec vitest run    # unit + integration tests — all should pass
pnpm build              # produces dist/
pnpm preview            # serves dist/
```

The CI workflow in `.github/workflows/ci.yml` runs all four gates on every push and pull request. If your local gates pass, CI will too.

---

## Audio routing for live shows

Web Audio defaults to the system output (whichever speaker or audio interface your Mac is sending to). To send HandSynth into a mixer or a DAW for monitoring + recording, use a virtual audio device.

### BlackHole (free, recommended)

[BlackHole](https://existential.audio/blackhole/) is a free macOS virtual audio cable.

1. Install BlackHole 2ch (or 16ch if you need more channels)
2. In **Audio MIDI Setup**, create an **Aggregate Device** combining your real output (built-in or USB interface) + BlackHole
3. Set your Mac's system output to the aggregate device
4. In your DAW (Logic, Ableton, Reaper, etc.) set BlackHole as an input

HandSynth's output is now both audible on your speakers AND a track in your DAW for recording / processing.

### Loopback (paid, simpler GUI)

If you want a GUI tool, [Loopback by Rogue Amoeba](https://rogueamoeba.com/loopback/) does the same thing with a friendlier interface.

---

## Webcam choice for stage

The hand and face tracking models work with any webcam, but quality matters more than resolution:

- **Built-in MacBook camera** — fine for testing, slightly soft for stage if the venue is dim
- **USB webcam (Logitech C920 / Brio / similar)** — recommended for shows. Wider FOV, better low-light, the autofocus locks faster
- **External cinema camera via HDMI capture** — works (HandSynth doesn't care about the source) but the capture latency varies; test before the show
- **Phone-as-webcam (Camo, Iriun, etc.)** — works but adds ~30-80 ms of latency that's noticeable on rhythmic gestures. OK for textural play, less great for snappy stabs

Position the camera so your hands are clearly framed when arms are out. The face only needs to be visible enough for the mouth/expression detector — chin-to-eyebrows is enough.

---

## Troubleshooting

### "Webcam denied" overlay won't go away

Check **System Settings → Privacy & Security → Camera** and toggle HandSynth (or your browser) on. Quit and relaunch the app — the permission only applies on next start.

### Audio is glitchy or dropping out

The most common cause is the dev server's HMR overhead on the main thread. Switch to production mode:

```sh
pnpm build
pnpm preview
```

If glitches persist even in preview, close other apps using the camera or audio (Zoom, Meet, Discord, OBS). HandSynth's MediaPipe inference + Tone.js scheduler need the main thread reasonably free.

### The page froze mid-set

This is a known issue under prolonged heavy load — the JS event loop can starve when MediaPipe + Tone.js + p5.js + InteractionMapper all share the main thread. Mitigations are in place but the root cause (no Web Worker offload for MediaPipe — Vite compatibility issue) is not fully solved.

If it happens on stage:

1. **Open the Terminal HUD** (press `t`) before going live — the DIAG row shows `subs/lines/voices/q/at`. Watch for monotonic growth in `voices` or `q` over a few minutes — that's the leak signal
2. **Have a second tab pre-warmed** — if the active tab freezes mid-song, `Cmd+Tab` to the backup
3. **Use the Electron app** if web freezes are happening more often — it gets its own process and isolates the audio context from browser extensions

### MediaPipe model download stalls on first run

The hand + face models (~10 MB) download from `storage.googleapis.com` on first launch. Some venues block GCS. Workarounds:

- Pre-warm your laptop at home with the models cached
- The browser cache survives across `pnpm preview` restarts — once you've loaded the page once with internet, you don't need internet again

### Code-signing / Gatekeeper warning won't go away

See the **First launch** section above — `xattr -dr com.apple.quarantine /Applications/HandSynth.app` is the one-liner.

### Audio is too quiet through the DAW

Web Audio output through BlackHole is at line level. If your DAW input gain is at 0 dB, expect to need +6 to +12 dB of gain on the track. Compress lightly to even out the gesture dynamic range.

---

## Tips for live performance

- **Sound check 30 minutes before doors** — calibrate the openness range, the pinch threshold, and the face position with the actual stage lighting. Tracking accuracy depends on lighting.
- **Bind a panic shortcut on stage** — `Escape` mutes the audio instantly. Both fists closed do the same gesture-side. Practice these so they're muscle memory.
- **Pre-select your scale and vibe** — open the PATCH editor (`p`), pick KEY + SCALE + factory preset, and save the patch. Recall it from `localStorage` on the next launch.
- **Don't change your starting position mid-song** — the One-Euro filter calibrates over the first few frames; if you shift dramatically, the smoothing can lag the change by 100-200 ms.
- **Plan for the freeze** — see Troubleshooting. Always have a backup tab open. A 5-second silent gap is recoverable mid-song; a 60-second crashed-tab gap is not.
- **Record everything** — even rehearsals. HandSynth is a generative instrument; some of your best phrases will be impossible to repeat.

---

## Need help

Open an issue at https://github.com/luigismith/handsynth/issues. Include:
- macOS version (`sw_vers`)
- Node version (`node -v`)
- Browser + version (or "Electron build")
- Exactly what gesture / action triggered the problem
- Console output (`Cmd+Opt+I` → Console tab — last 20 lines)

If the issue is webcam or audio related, attach a screenshot of the relevant System Settings privacy panel.
