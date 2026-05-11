# HandSynth — User Manual

> **Italiano:** una traduzione completa di questo manuale è disponibile in
> [`USER_MANUAL.it.md`](./USER_MANUAL.it.md). The whole UI is bilingual —
> use the **IT / EN** pill in the bottom-right HUD to switch live.

## Welcome

HandSynth is a **gestural synthesizer for live performance** that you play with
your body. Move your hands, turn your head, open your mouth, smile, frown,
point, swipe — every motion becomes part of the sound. There are no keys to
learn and no scales to memorize. The music brain inside the app stays inside
the active key, so it is genuinely impossible to play a wrong note. Your job
is to feel.

Designed for stage: a laptop, a webcam, and your hands. Output through laptop
speakers, a USB audio interface, or routed via BlackHole into a DAW for mix
and record. Installation walkthrough for macOS — including Gatekeeper, audio
routing, and stage tips — lives in [`INSTALL.md`](./INSTALL.md).

The aesthetic is cyberpunk on purpose. Orange-on-charcoal, low-poly skeletons,
a thin scanline sweep over the panels. This manual walks through every gesture,
every panel, every keyboard shortcut, and a few troubleshooting tips for when
things go sideways.

## First start

When you first open HandSynth a small orange card appears in the centre asking
permission to use your webcam. Click **Permetti webcam e iniziare** ("allow
webcam and start"). Your browser will ask for camera permission — accept it.

If permission is denied or no camera is available, the app drops into
**autopilot mode**: a synthetic gesture stream wanders slowly through density
and tonality so you can still hear what HandSynth sounds like without a camera.
A small toast at the bottom tells you which mode you ended up in.

Once the onboarding card disappears you should hear a short C-major chord
(the boot test) and see the live visualizer light up. Raise your hands toward
the camera and the visualizer skeleton picks them up.

## Basic controls (hands)

These are the always-on hand mappings. Each one is continuous — there is no
threshold, no on/off. Move slowly to feel the parameter slide.

| Gesture | Audio effect | Range |
|---|---|---|
| Hands distance (3D) | Master filter cutoff | 200 Hz to 12 kHz, log curve |
| Mean hand height | Note density and brightness | quarter notes to sixteenths, dim to bright |
| Right palm openness | Reverb wet and delay feedback | dry to wash |
| Left palm openness | Saturator drive and filter resonance Q | clean to screaming |
| Right pinch (thumb-index) | Trigger a harmony-aware lead stab | one-shot |
| Left pinch | Advance to the next chord in the progression | one-shot |
| Both fists held closed | Master mute (releases on open) | toggle |
| Both hands above your head | The "drop" — max reverb, filter wide open | held |

**Tip on pinches.** A pinch is a rising-edge event: bring thumb and index tip
together. The mapper debounces re-pinches inside 120 ms so a clumsy gesture
won't fire twice.

**Tip on fists.** "Both fists" means both hands closed at the same time. Useful
for a sudden stop — you can stab silence into a phrase by snapping both fists.

## 3D controls

HandSynth reads depth too. These are layered on top of the basic mappings.

| Gesture | Audio effect | Notes |
|---|---|---|
| Hand depth (mean Z) | Master volume | Closer to camera = louder |
| Right palm roll | Brightness fine-tune | Plus or minus 0.15 |
| Left palm roll | Saturator drive fine-tune | Plus or minus 0.4 |
| Mean palm pitch | Delay feedback fine-tune | Plus or minus 0.15 |

"Roll" is when you twist your wrist around the forearm axis — palm-down to
palm-up. "Pitch" is tilting the palm forward and back, fingers toward and away
from the camera.

## Per-finger controls

HandSynth reads each finger independently. Beyond the aggregate "openness"
of a whole hand, every individual finger emits a continuous 0..1 curl scalar
(0 = fully extended, 1 = fully curled) that drives its own audio dimension.

The per-finger layer is **additive on top of the aggregate openness mapping**
with a 35% weight: a fully-extended hand sounds the same as before, but
flexing a single finger produces an audible per-dimension change. Sensitivity
is tuned high (One-Euro `beta=0.08`, double the standard scalar smoothing)
so small deliberate motions register.

### Right hand — the FX hand

| Finger | Audio effect | Range (extended → curled) |
|---|---|---|
| Thumb | Delay feedback | 0.7 wet repeats → 0.1 dry |
| Index | Filter cutoff (log) | 14 kHz bright → 600 Hz dark |
| Middle | Reverb wet | 0.85 hall → 0.05 dry |
| Ring | Brightness offset | +0.15 → −0.15 (additive) |
| Pinky | Delay wet | 0.6 → 0.05 |

### Left hand — the drive hand

| Finger | Audio effect | Range (extended → curled) |
|---|---|---|
| Thumb | Saturator drive | 2.6 grit → 0.8 clean |
| Index | Filter resonance Q | 12 → 1.5 |
| Middle | Reverb wet (extra layer) | 0.7 → 0.05 |
| Ring | Master volume offset | +0.10 louder → −0.10 quieter |
| Pinky | Tremolo depth (brightness LFO at 5 Hz) | 0 → 1 |

**Tip on calibration.** The per-finger curl uses the finger geometry
(tip-vs-PIP-vs-MCP distance ratio) rather than absolute position, so it
works regardless of hand size or distance from the camera. If a finger
doesn't seem to register, exaggerate the flex by curling it past the PIP
joint, then extending it fully — the calibration sees the full range.

**Tip on layering.** Because every finger maps to a unique parameter, you
can "play" the audio like an instrument. Try: hold the right hand mostly
open, then curl just the middle finger — you'll hear the reverb drop out
while everything else stays put. Or curl the left pinky to add a steady
tremolo wobble.

## Face controls

The face layer is additive. When the FaceTracker can see your face, all of the
mappings below modulate the existing hand-driven sound.

| Gesture | Audio effect | Visual |
|---|---|---|
| Apparent face size | Reverb wet blend | closer = drier |
| Head roll (tilt) | Brightness offset, plus or minus 0.15 | — |
| Head yaw (turn) | Filter resonance offset, plus or minus 5 Q | — |
| Head pitch (chin up) | Note density boost | — |
| Mouth open | Delay wet sweep, filter cutoff +6k, reverb +0.3, brightness +0.4 | mouth-emitted particles |
| Mouth open (rising edge) | Lead chord-tone stab | — |
| Smile | Brightness +0.2, masterDuck reduced 0.15 | (sound brightens, pushes forward) |
| Frown | Filter cutoff pulled toward 1.5 kHz | (sound darkens) |
| Surprise (jaw + brow up) | Reverb +0.3, delay feedback +0.1 | (sound opens up) |
| Anger (brows down, no smile) | Drive +0.6, filter Q +5 | (sound peaks and grits) |
| Face lost > 1.5 s | Master ducks +0.15 | — |

**Calibration note for expressions.** The four expression scalars come from
MediaPipe's blendshape outputs. They saturate near 1.0 on a clear, deliberate
expression. A subtle smile registers as ~0.3 and contributes proportionally.
If an expression isn't triggering, exaggerate it — point your face at the
camera, hold the expression for half a second.

## Gesture cheat sheet

The discrete-gesture interpreter recognizes 12 static hand shapes and 5
velocity gestures. Each one fires a one-shot musical action. The interpreter
is conservative on purpose — every shape has to hold for three frames in a
row before it counts, and the same gesture can't re-fire inside its
cooldown window. Better to miss a deliberate gesture than fire one you
didn't mean.

### Static hand shapes

| Hand shape | Hand | Effect |
|---|---|---|
| Point | right | Filter Q spike — sharp focus, decays over 600 ms |
| Peace (V) | right | Brightness pulse (vibrato shimmer approximation) |
| Rock on (horns) | right | Distortion crank — drive +0.35 for 1.5 s |
| OK (ring) | right | Tape flutter — delay feedback +0.2 for 1 s |
| Finger gun (L-shape) | right | Lead chord-tone stab |
| Thumbs up | right | Save quick-patch (logged to console) |
| Thumbs down | right | Reset to INIT factory preset |
| Three (I+M+R) | right | Apply factory preset slot 3 (ACID) |
| Four (I+M+R+P) | right | Apply factory preset slot 4 (DUB) |
| Call me (shaka) | right | Percussion one-shot |
| Fist | both | (Velocity gesture — see below) |
| Open palm | either | Reset / no special action (releases held shapes) |

### Velocity gestures

| Velocity gesture | Hand | Effect |
|---|---|---|
| Snap (fast index extend) | either | Percussion one-shot |
| Swipe right | right | Next factory PATCH preset |
| Swipe left | right | Previous factory PATCH preset |
| Fist pump (both hands, fast down) | both | Drop bomb — delay feedback +0.3 + reverb +0.3 for 1.5 s |
| Wave (oscillating L↔R, ≥3 sign-flips in 1.2 s) | either | Tremolo wobble (brightness LFO at 5 Hz) |

### Tips for discrete gestures

- **Hold the shape briefly.** The interpreter requires three identical
  frames (~125 ms at 24 Hz) before it commits — flicker between similar
  shapes is rejected.
- **Wait a beat between fires.** Each shape has a 350 ms cooldown; snap
  has 250 ms; swipe has 600 ms. Slamming through gestures spams the
  cooldown, not the audio engine.
- **Snap requires curl-then-extend.** Going from a closed fist to an open
  index in one fast motion fires it. Slow extension doesn't qualify.
- **Swipes need sustained velocity.** A blip across the frame won't fire —
  you have to keep moving for at least 150 ms.
- **Wave is continuous.** Once you wave, the brightness wobbles for as long
  as you keep oscillating. Stopping the motion fades the wobble out.

## Vibes

Four built-in vibes set the tonality, BPM, and timbral signature. Click a chip
at the top of the screen, or open the PATCH editor and use the Vibe dropdown.

- **Tycho** — bright, airy, modal pads. Mid-tempo (~92 BPM). Default.
- **Bonobo** — warm, organic, rolling bass. Slightly slower, downtempo feel.
- **Hopkins** — spectral, evolving, drone-heavy. Soundtrack mood.
- **Floating Points** — punchy, club-tempo, more rhythmic emphasis.

Switching vibes crossfades the engine; you don't have to stop playing.

## PATCH presets

Click the gear icon in the top right (or press `p`) to open the PATCH editor.
At the top is a row of eight factory chips:

- **LUSH** — wide reverb, soft saturator, slow movement
- **ACID** — high resonance, fast envelopes, biting drive
- **DUB** — long delay, ducking bass, smoke-filled space
- **BRIGHT** — open filter, high brightness, sparkling top
- **DARK** — low cutoff, low brightness, brooding
- **TAPE** — gentle saturation, pitch wobble, vintage feel
- **SPACE** — maximum reverb, ambient pad-forward
- **INIT** — clean defaults; start your patch from zero here

Click a chip to apply it instantly. The knobs below show the current state
and are fully editable — drag a knob vertically to change its value.

To save your own patch: type a name into the box at the bottom, hit **Save**.
Your patches persist in `localStorage` and re-appear next session. Click
**Load** on a row to recall it; **Del** to remove.

The **Reset to vibe** button returns every knob to the active vibe's defaults
without losing your saved patches.

### Voice section — the analog WAVE knobs

Below the main FX knobs lives a **Voice** section with three small dials:

- **Pad Wave** — crossfades the pad between its current waveform (set by the
  vibe / factory preset, e.g. `fatsawtooth`) and a clean sine destination.
- **Lead Wave** — crossfades the lead between its current oscillator
  (typically `fmsawtooth` or `fmsine`) and a hollow pulse destination.
- **Bass Wave** — crossfades the bass between its current waveform (e.g.
  `fatsquare`) and a warm triangle destination.

Each knob is continuous (0..1, default 0.5 = balanced mix) and uses an
equal-power crossfade, so dragging through the morph is smooth — analog-synth
"WAVE" knob feel, never abrupt. Both oscillator stacks are always sounding;
the crossfade just controls audibility, so morphing mid-note cleanly slides
between the two timbres instead of cutting in.

### SMART pill — intelligent voicing router

To the right of the **Voice** section header sits a small **SMART** pill,
**ON by default**. When ON, HandSynth nudges each voice's `timbre` toward a
musically-sensible destination based on the running FX state:

| Trigger | Nudge | Why |
|---|---|---|
| Filter cutoff < 800 Hz | pad → +0.15 toward sine; bass → -0.15 (keep harmonics) | dark filter wants a clean pad and a present bass |
| Filter cutoff > 10 kHz | lead → -0.15 (toward harmonic-rich oscillator) | bright filter needs harmonics to shine |
| Drive > 2.0 | all voices → -0.15 (toward A side) | saturator wants harmonics to bite |
| Drive < 1.0 | all voices → +0.15 (toward sine/pulse/triangle) | clean drive wants soft tone |
| Filter Q > 8 | lead → +0.15 (toward pulse) | resonant Q + pulse = vocal honk |
| Reverb wet > 0.7 | pad → +0.15 (toward sine) | sine washes glassy through reverb |

Each rule contributes at most ±0.15, and the per-voice total is clamped to
±0.15 — the router is a subtle nudge, **never an override**. Your knob value
is always the dominant signal. Click the SMART pill to turn the router off
and hear only the user-set timbre.

## Scale & key

The synth's harmonic engine plays in a key + scale (e.g. C minor, F# lydian).
By default each vibe ships with its own preferred scale, but you can override
it independently of the vibe's BPM, voicing, and FX.

Open the **PATCH editor** (gear icon, top right, or press `p`) and look for
the **KEY** and **SCALE** dropdowns above the knob grid.

- **Key** — the root note. Twelve options: `C`, `C# / Db`, `D`, `D# / Eb`,
  `E`, `F`, `F# / Gb`, `G`, `G# / Ab`, `A`, `A# / Bb`, `B`.
- **Scale** — Major (Ionian), Minor (Aeolian), Harmonic Minor, Melodic Minor,
  Dorian, Phrygian, Lydian, Mixolydian, Locrian, Pentatonic Major,
  Pentatonic Minor, Blues, Chromatic.

Changing either snaps every generated lead and bass note to the new scale.
The chord progression stays as the vibe wrote it, so you keep the song's
character — the music brain's snap-to-consonance filter gracefully
reharmonizes any out-of-scale chord tones, so you can play the Bonobo
progression in C-minor (or anything else) without it sounding wrong.

Hit the small **↺** button to the right of the dropdowns to reset both back
to the active vibe's defaults.

Your selection is sticky: it persists across vibe changes for the rest of
the session, and is remembered in `localStorage` between sessions. The reset
button clears the stored override.

## Keyboard shortcuts

All shortcuts are letter keys or function/control keys, so they stay in the
same physical position on every international keyboard layout (US, IT, FR,
DE, etc.). No symbol-key dependencies.

| Key | Action |
|---|---|
| `t` | Toggle the live event terminal (left side) |
| `p` | Toggle the PATCH editor |
| `h` or `F1` | Toggle this help panel |
| `m` | Flip the selfie mirror |
| `Escape` | Mute / unmute the audio (STOP) |

When the help panel or the patch editor is open, `Escape` closes the panel
first; press it again to mute.

## HUD controls

In the bottom-right corner you'll see three tiny icon buttons:

- **Power (⏻)** — STOP. Click once to mute the audio. Click again to unmute.
  When muted, the icon glows orange so you can tell at a glance.
- **Terminal (⌐)** — toggle the translucent event log on the left side. Useful
  for seeing exactly which notes and gestures are firing in real time.
- **Help (?)** — toggle this manual.

The strip is intentionally small and translucent so it never blocks the
visualizer behind it. All three buttons have keyboard shortcuts (see above)
if you prefer not to reach for the mouse.

## Tips

- **Calibration.** The wide-eye trigger needs a deliberate stare ("BANG, eyes
  open wide"). Smiles, frowns, and anger expressions register at fractional
  values — don't expect a tiny smirk to flip the brightness lamp. Hold the
  expression for half a second so the One-Euro filter catches up.
- **Silencing quickly.** `Escape` mutes everything. `Both fists held` does the
  same gesture-side, with a 200 ms fade.
- **Audio glitches.** If you hear crackling, try `pnpm preview` instead of
  `pnpm dev`. The production build is much lighter on the main thread; the
  Vite dev-server adds HMR overhead that can starve the audio scheduler.
- **MediaPipe load-time.** The first start fetches ~10 MB of MediaPipe models
  from a CDN. Subsequent loads are cached.
- **Webcam pre-mirrored.** Some virtual cameras (OBS, Snap Camera) hand
  HandSynth a pre-mirrored stream. If your hand skeleton lands on the wrong
  side of the screen, press `m` to flip.

## Troubleshooting

**Webcam not detected.** The browser's permission prompt may have been
dismissed. Reload the page — the prompt re-appears when you click the
onboarding button. If denied at the OS level (Windows Privacy → Camera, or
macOS System Settings → Camera), grant access and reload.

**No audio.** Audio requires a user gesture to start (the onboarding click).
If you got past onboarding and still hear nothing, click anywhere in the
window — some browsers suspend the AudioContext on tab-switch. The terminal
HUD's status bar shows the current context state (running / suspended).

**Audio is glitchy / dropping.** Close other tabs running real-time webcam
or audio (Zoom, Meet, Discord with video on, etc). HandSynth shares the
main thread with two MediaPipe models and a p5.js sketch.

**Gestures lag.** Check the terminal HUD's CTX line. If it shows `suspended`,
the audio context has been deprioritized — click anywhere to wake it back up.

## Credits / license

Built with [Claude Code](https://claude.com/claude-code). Audio engine
powered by [Tone.js](https://tonejs.github.io/). Hand and face tracking via
[MediaPipe Tasks Vision](https://developers.google.com/mediapipe). Visualizer
in [p5.js](https://p5js.org/). Smoothing courtesy of the One-Euro filter
(Casiez, Roussel, Vogel — CHI 2012).

MIT license — see [`LICENSE`](./LICENSE). Use it, fork it, install it on your
friends' machines, run a live show, build a follow-on with it. Attribution
is appreciated but not required.
