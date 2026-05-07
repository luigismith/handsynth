# Impulse Response Files

Place convolution-reverb impulse responses (IRs) in this folder.

## Required

- **`hall.wav`** — main hall reverb used by the master FX chain.
  - Format: 24-bit / 48 kHz preferred (16-bit / 44.1 kHz also fine).
  - Length: 2.5 - 5 seconds, stereo.
  - License: must be free for commercial redistribution (CC0 or similar).
  - Suggested sources: openairlib.net, EchoThief, free convolution-reverb packs.

The audio engine references `/ir/hall.wav` at runtime via Tone.js `Convolver`. If the file is
missing, the engine should gracefully fall back to an algorithmic reverb (see `AudioEngine`
contract in `src/types/contracts.ts`).

> **Follow-up for `audio-engineer` agent:** source and commit `hall.wav` here, or wire the
> fallback path explicitly.
