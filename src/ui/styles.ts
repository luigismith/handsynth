// Owner: ux-curator
//
// Tiny helper that injects a single <style> tag with all UI styles into
// document.head. Called once from main.ts at boot. Splitting it out keeps
// Onboarding / VibeSelector / SettingsPanel / Terminal free of CSS strings
// and lets us guarantee the stylesheet is present before any UI module
// tries to mount.
//
// Aesthetic: cyberpunk low-poly. Orange / black / grey palette, monospace
// labels, sharp 1 px edges, notched-corner panels (clip-path), no
// glassmorphism, no blur. Subtle PCB-trace highlights and an occasional
// scanline sweep. Animations are dropped under prefers-reduced-motion.

const STYLE_ID = 'handsynth-ui-styles';

export const UI_STYLES = `
:root {
  --hs-bg-deep:      #0a0a0c;
  --hs-bg-panel:     #14141a;
  --hs-bg-panel-2:   #1c1c24;
  --hs-grey:         #2a2a36;
  --hs-grey-2:       #3a3a48;
  --hs-text-dim:     #7e7e90;
  --hs-text:         #c8c8d4;
  --hs-text-bright:  #f0f0f6;
  --hs-orange:       #ff6a14;
  --hs-orange-dim:   #cc4d0a;
  --hs-orange-glow:  #ff8c4a;
  --hs-amber:        #ffaa44;
  --hs-warning:      #ff3030;
  --hs-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@keyframes hs-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes hs-toast-rise {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes hs-rec-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@keyframes hs-cta-glow {
  0%, 100% { box-shadow: 0 0 0 1px var(--hs-orange-dim), 0 0 0 0 rgba(255, 106, 20, 0.0); }
  50%      { box-shadow: 0 0 0 1px var(--hs-orange-dim), 0 0 14px 2px rgba(255, 140, 74, 0.45); }
}
@keyframes hs-scan-sweep {
  0%   { transform: translateY(-100%); opacity: 0; }
  10%  { opacity: 0.15; }
  90%  { opacity: 0.15; }
  100% { transform: translateY(2600%); opacity: 0; }
}
@keyframes hs-line-glow {
  0%   { background: rgba(255, 106, 20, 0.12); }
  100% { background: rgba(255, 106, 20, 0.0); }
}

/* =========================================================================
 * Onboarding card
 * ========================================================================= */

.hs-onboard-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: var(--hs-bg-panel);
  border: 1px solid var(--hs-grey-2);
  padding: 30px 36px;
  text-align: center;
  max-width: 440px;
  pointer-events: auto;
  transition: opacity 180ms ease;
  opacity: 1;
  animation: hs-fade-in 180ms ease-out both;
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
  overflow: hidden;
}
.hs-onboard-card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--hs-orange);
  opacity: 0.6;
  pointer-events: none;
}
.hs-onboard-card::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--hs-orange);
  pointer-events: none;
  animation: hs-scan-sweep 5s linear infinite;
}
.hs-onboard-card.hs-fade-out {
  opacity: 0;
  pointer-events: none;
}
.hs-onboard-title {
  margin: 0 0 8px 0;
  font-family: var(--hs-mono);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  color: var(--hs-text-bright);
  text-transform: uppercase;
}
.hs-onboard-sub {
  margin: 0 0 22px 0;
  font-family: var(--hs-mono);
  font-size: 13px;
  color: var(--hs-text-dim);
  letter-spacing: 0.4px;
}
.hs-onboard-btn {
  appearance: none;
  border: 0;
  background: var(--hs-orange);
  color: #0a0a0c;
  font-family: var(--hs-mono);
  font-size: 13px;
  font-weight: 600;
  padding: 11px 22px;
  border-radius: 0;
  cursor: pointer;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  transition: background 120ms ease, color 120ms ease;
  animation: hs-cta-glow 2s ease-in-out infinite;
}
.hs-onboard-btn:hover { background: var(--hs-amber); animation: none; }
.hs-onboard-btn:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
}
.hs-onboard-btn:active { background: var(--hs-orange-dim); }
.hs-onboard-cheats {
  margin-top: 16px;
  font-family: var(--hs-mono);
  font-size: 11px;
  color: var(--hs-text-dim);
  letter-spacing: 1.2px;
  text-transform: uppercase;
}
.hs-onboard-error {
  margin-top: 14px;
  font-family: var(--hs-mono);
  font-size: 12px;
  color: var(--hs-warning);
  letter-spacing: 0.5px;
}

/* =========================================================================
 * Vibe selector
 * ========================================================================= */

.hs-vibes {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: var(--hs-bg-panel);
  border: 1px solid var(--hs-grey-2);
  pointer-events: auto;
  opacity: 0.35;
  transition: opacity 200ms ease;
}
.hs-vibes:hover, .hs-vibes:focus-within { opacity: 1; }
.hs-vibe-chip {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--hs-text-dim);
  font-family: var(--hs-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  transition: color 120ms ease, border-color 120ms ease, box-shadow 160ms ease;
}
.hs-vibe-chip:hover { color: var(--hs-text); }
.hs-vibe-chip:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
}
.hs-vibe-chip[aria-checked='true'] {
  color: var(--hs-orange);
  border-color: var(--hs-orange);
  box-shadow: 0 0 8px rgba(255, 140, 74, 0.45);
}

/* =========================================================================
 * Error overlay
 * ========================================================================= */

.hs-error-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: var(--hs-bg-panel-2);
  border: 1px solid var(--hs-warning);
  padding: 22px 26px;
  max-width: 380px;
  pointer-events: auto;
  text-align: center;
  color: var(--hs-text);
  font-family: var(--hs-mono);
  animation: hs-fade-in 180ms ease-out both;
}
.hs-error-msg {
  margin: 0 0 14px 0;
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: 0.3px;
}
.hs-error-btn {
  appearance: none;
  border: 1px solid var(--hs-orange);
  background: transparent;
  color: var(--hs-orange);
  font-family: var(--hs-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: 0;
  cursor: pointer;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  transition: background 120ms ease, color 120ms ease;
}
.hs-error-btn:hover { background: var(--hs-orange); color: #0a0a0c; }
.hs-error-btn:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
}

.hs-toast {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  background: rgba(20, 20, 28, 0.85);
  border: 1px solid var(--hs-orange-glow);
  color: var(--hs-text);
  font-family: var(--hs-mono);
  font-size: 12px;
  letter-spacing: 0.4px;
  padding: 8px 16px;
  border-radius: 0;
  pointer-events: auto;
  transition: opacity 240ms ease;
  opacity: 1;
  animation: hs-toast-rise 220ms ease-out both;
}
.hs-toast.hs-fade-out { opacity: 0; }

/* =========================================================================
 * Settings panel
 * ========================================================================= */

.hs-settings-toggle {
  position: absolute;
  top: 14px;
  right: 92px;
  z-index: 10;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--hs-bg-panel);
  color: var(--hs-text);
  border: 1px solid var(--hs-grey-2);
  border-radius: 0;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0.7;
  padding: 0;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease, transform 200ms ease;
}
.hs-settings-toggle:hover {
  opacity: 1;
  color: var(--hs-orange);
  border-color: var(--hs-orange);
  transform: rotate(45deg);
}
.hs-settings-toggle:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
  opacity: 1;
}
.hs-settings-toggle svg { width: 16px; height: 16px; display: block; }

.hs-settings-card {
  position: absolute;
  top: 56px;
  right: 14px;
  z-index: 11;
  width: 360px;
  max-height: calc(100vh - 80px);
  overflow: auto;
  color: var(--hs-text);
  font: 12px var(--hs-mono);
  background: var(--hs-bg-panel);
  border: 1px solid var(--hs-grey-2);
  padding: 16px 18px 14px 18px;
  pointer-events: auto;
  transform-origin: top right;
  transition: transform 180ms ease, opacity 180ms ease;
  opacity: 1;
  transform: scale(1);
  clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
}
.hs-settings-card[hidden] { display: none; }
.hs-settings-card.hs-collapsed {
  opacity: 0;
  transform: scale(0.97);
  pointer-events: none;
}
.hs-settings-card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--hs-orange);
  pointer-events: none;
}
.hs-settings-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.hs-settings-title {
  margin: 0;
  font-family: var(--hs-mono);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--hs-text-bright);
  text-transform: uppercase;
}
.hs-settings-sub {
  font-family: var(--hs-mono);
  font-size: 9px;
  color: var(--hs-text-dim);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.hs-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.hs-preset-chip {
  appearance: none;
  background: transparent;
  border: 1px solid var(--hs-grey-2);
  color: var(--hs-text-dim);
  font-family: var(--hs-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  padding: 3px 10px;
  height: 20px;
  min-width: 50px;
  border-radius: 999px;
  cursor: pointer;
  pointer-events: auto;
  transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
}
.hs-preset-chip:hover {
  color: var(--hs-text);
  border-color: var(--hs-orange-glow);
}
.hs-preset-chip:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
}
@keyframes hs-preset-flash {
  0%   { background: var(--hs-orange); color: #0a0a0c; border-color: var(--hs-orange); }
  100% { background: transparent;       color: var(--hs-text-dim); border-color: var(--hs-grey-2); }
}
.hs-preset-chip.hs-preset-flash {
  animation: hs-preset-flash 600ms ease-out both;
}

.hs-settings-section {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--hs-grey);
}
.hs-settings-section-label {
  font-family: var(--hs-mono);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--hs-orange);
  text-transform: uppercase;
  margin-bottom: 8px;
  position: relative;
  padding-left: 10px;
}
.hs-settings-section-label::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 8px;
  background: var(--hs-orange);
}
.hs-knob-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 6px;
}

.hs-knob {
  display: flex;
  flex-direction: column;
  align-items: center;
  user-select: none;
  padding: 4px 2px;
}
.hs-knob-dial {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  position: relative;
  background:
    radial-gradient(circle at 35% 30%, #4a4a58, #1a1a24 70%),
    radial-gradient(circle at 50% 50%, #3a3a48, #14141a);
  border: 1px solid #000;
  box-shadow:
    0 0 0 1px var(--hs-grey) inset,
    0 2px 4px rgba(0, 0, 0, 0.6);
  cursor: ns-resize;
  outline: none;
  transition: box-shadow 160ms ease;
}
.hs-knob-dial::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  background: var(--hs-orange-glow);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.hs-knob-dial:hover,
.hs-knob-dial:active {
  box-shadow:
    0 0 0 1px var(--hs-orange) inset,
    0 2px 4px rgba(0, 0, 0, 0.6),
    0 0 12px 2px rgba(255, 140, 74, 0.35);
}
.hs-knob-dial:focus-visible {
  box-shadow:
    0 0 0 2px var(--hs-orange),
    0 2px 4px rgba(0, 0, 0, 0.6);
}
.hs-knob-indicator {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 18px;
  background: var(--hs-orange);
  transform-origin: 50% 100%;
  transform: translate(-50%, -100%);
  border-radius: 0;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(255, 106, 20, 0.7);
}
.hs-knob-label {
  margin-top: 5px;
  font-family: var(--hs-mono);
  font-size: 9px;
  color: var(--hs-text-dim);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  text-align: center;
}
.hs-knob-value {
  margin-top: 1px;
  font: 11px var(--hs-mono);
  color: var(--hs-text);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.hs-settings-vibe {
  display: grid;
  grid-template-columns: 60px 1fr;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.hs-settings-vibe label {
  font-family: var(--hs-mono);
  font-size: 9px;
  color: var(--hs-text-dim);
  letter-spacing: 2px;
  text-transform: uppercase;
}
.hs-settings-vibe select {
  background: var(--hs-bg-deep);
  color: var(--hs-text);
  border: 1px solid var(--hs-grey-2);
  border-radius: 0;
  padding: 5px 8px;
  font: 11px var(--hs-mono);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.hs-settings-vibe select:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 1px;
}

.hs-patches {
  margin-top: 4px;
}
.hs-patches-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 4px;
  border-bottom: 1px solid var(--hs-grey);
  margin-bottom: 0;
}
.hs-patches-row:last-child { border-bottom: 1px solid var(--hs-grey); }
.hs-patches-row .hs-patches-name {
  flex: 1 1 auto;
  font-family: var(--hs-mono);
  font-size: 11px;
  color: var(--hs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hs-patches-empty {
  font-family: var(--hs-mono);
  font-size: 10px;
  color: var(--hs-text-dim);
  letter-spacing: 1px;
  padding: 6px 0;
  text-transform: uppercase;
}
.hs-btn {
  appearance: none;
  border: 1px solid var(--hs-grey-2);
  background: transparent;
  color: var(--hs-text);
  font: 11px var(--hs-mono);
  padding: 5px 10px;
  border-radius: 0;
  cursor: pointer;
  letter-spacing: 1px;
  text-transform: uppercase;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.hs-btn:hover {
  border-color: var(--hs-orange);
  color: var(--hs-orange);
}
.hs-btn:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
}
.hs-btn-tiny {
  padding: 3px 8px;
  font-size: 10px;
}
.hs-btn-primary {
  border-color: var(--hs-orange);
  background: var(--hs-orange);
  color: #0a0a0c;
}
.hs-btn-primary:hover {
  background: var(--hs-amber);
  border-color: var(--hs-amber);
  color: #0a0a0c;
}
.hs-btn-danger {
  border-color: var(--hs-grey-2);
  color: var(--hs-text-dim);
}
.hs-btn-danger:hover {
  border-color: var(--hs-warning);
  color: var(--hs-warning);
  background: transparent;
}
.hs-actions { display: flex; gap: 6px; margin-top: 8px; }

.hs-prompt {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.hs-prompt input[type="text"] {
  flex: 1 1 auto;
  background: var(--hs-bg-deep);
  color: var(--hs-text);
  border: 1px solid var(--hs-grey-2);
  border-radius: 0;
  padding: 5px 8px;
  font: 11px var(--hs-mono);
}
.hs-prompt input[type="text"]:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 1px;
}

/* =========================================================================
 * Terminal HUD
 * ========================================================================= */

@keyframes hs-term-flicker {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.985; }
}

.hs-terminal {
  position: absolute;
  left: 12px;
  top: 70px;
  bottom: 80px;
  width: 320px;
  z-index: 12;
  /* Translucent overlay — meant to be readable but never block what's
   * happening on the canvas behind it. Was a 0.85-alpha bottom strip;
   * now a 0.32-alpha left column. */
  background: rgba(10, 10, 12, 0.32);
  color: var(--hs-text);
  font: 11px var(--hs-mono);
  line-height: 1.45;
  padding: 0;
  /* Don't intercept clicks/drags — the user's gestures and the gear
   * button must reach the canvas / settings panel through the terminal. */
  pointer-events: none;
  border-left: 1px solid rgba(255, 106, 20, 0.35);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  /* Drop the global flicker animation here — at 0.32 alpha the flicker
   * is distracting noise on top of the visualizer rather than CRT flair. */
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.35);
}
.hs-terminal[hidden] { display: none; }
.hs-terminal::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* Very faint scanline overlay — was 0.025 alpha, now 0.018 to keep
   * the panel non-invasive. */
  background: repeating-linear-gradient(
    180deg,
    rgba(255, 140, 74, 0.018) 0 1px,
    transparent 1px 3px
  );
}
.hs-term-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.22);
  border-bottom: 1px solid rgba(255, 106, 20, 0.18);
  font-size: 10px;
  color: var(--hs-text);
  letter-spacing: 0.6px;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.hs-term-status .hs-term-rec {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hs-orange);
  box-shadow: 0 0 8px rgba(255, 106, 20, 0.85);
  animation: hs-rec-pulse 1s ease-in-out infinite;
}
.hs-term-status .hs-term-stat {
  display: inline-flex;
  gap: 4px;
}
.hs-term-status .hs-term-stat-label {
  color: var(--hs-text-dim);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}
.hs-term-status .hs-term-stat-int  > span:last-child { color: var(--hs-amber); }
.hs-term-status .hs-term-stat-mood > span:last-child { color: var(--hs-amber); }
.hs-term-status .hs-term-stat-bpm  > span:last-child { color: var(--hs-orange); }
.hs-term-status .hs-term-stat-ctx  > span:last-child { color: var(--hs-orange); }
.hs-term-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 10px 6px 10px;
  scroll-behavior: smooth;
  /* Pointer events back ON only inside the body so the user can scroll
   * the log if they want to read older lines. The outer .hs-terminal
   * is pointer-events:none so the rest of the panel stays click-through. */
  pointer-events: auto;
  /* Subtle fade at the top so newly-arriving lines feel like they
   * scroll INTO existence rather than popping in mid-air. */
  mask-image: linear-gradient(180deg, transparent 0, #000 18px, #000 calc(100% - 6px), transparent 100%);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 18px, #000 calc(100% - 6px), transparent 100%);
  /* Hide the scrollbar visually but keep scrolling functional. The
   * terminal auto-scrolls to bottom on each new line; users can still
   * wheel back to read older entries. */
  scrollbar-width: none;          /* Firefox */
  -ms-overflow-style: none;        /* legacy IE / old Edge */
}
.hs-term-body::-webkit-scrollbar {
  /* Chromium / Safari / new Edge */
  width: 0;
  height: 0;
  display: none;
}
.hs-term-line {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 0;
  opacity: 1;
  transition: opacity 1.5s linear;
  text-shadow: 0 0 4px rgba(255, 140, 74, 0.18);
}
.hs-term-line.hs-fade { opacity: 0.45; }
.hs-term-line.hs-fresh {
  background: rgba(255, 106, 20, 0.08);
  animation: hs-line-glow 600ms ease-out;
}
.hs-term-prefix {
  color: var(--hs-text-dim);
  margin-right: 6px;
}
.hs-term-line[data-kind="lead"]    { color: var(--hs-orange); }
.hs-term-line[data-kind="bass"]    { color: #ff8a3c; }
.hs-term-line[data-kind="chord"]   { color: var(--hs-amber); }
.hs-term-line[data-kind="kick"],
.hs-term-line[data-kind="hat"],
.hs-term-line[data-kind="perc"]    { color: var(--hs-text-dim); }
.hs-term-line[data-kind="gesture"] { color: var(--hs-grey-2); }
.hs-term-line[data-kind="beat"]    { color: var(--hs-text-dim); }
.hs-term-line[data-kind="info"]    { color: var(--hs-text); }

/* =========================================================================
 * Debug panel pill
 * ========================================================================= */

.hs-debug-toggle {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  background: var(--hs-bg-panel);
  color: var(--hs-text);
  border: 1px solid var(--hs-grey-2);
  border-radius: 999px;
  padding: 6px 14px;
  font: 11px var(--hs-mono);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0.7;
  transition: opacity 120ms ease, color 120ms ease, border-color 120ms ease;
}
.hs-debug-toggle:hover {
  opacity: 1;
  color: var(--hs-orange);
  border-color: var(--hs-orange);
}
.hs-debug-toggle:focus-visible {
  outline: 2px solid var(--hs-orange);
  outline-offset: 2px;
  opacity: 1;
}
.hs-debug-card {
  position: absolute;
  top: 50px;
  right: 14px;
  z-index: 10;
  width: 320px;
  background: var(--hs-bg-panel);
  color: var(--hs-text);
  border: 1px solid var(--hs-grey-2);
  border-radius: 0;
  padding: 14px 16px 12px 16px;
  font: 12px var(--hs-mono);
  pointer-events: auto;
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
}
.hs-debug-card::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--hs-orange);
  pointer-events: none;
}
.hs-debug-card[hidden] { display: none; }
.hs-debug-card h3 {
  margin: 0 0 10px 0;
  font-family: var(--hs-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: var(--hs-text-bright);
  text-transform: uppercase;
}
.hs-debug-row {
  display: grid;
  grid-template-columns: 1fr 56px;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.hs-debug-row label {
  font-family: var(--hs-mono);
  font-size: 10px;
  color: var(--hs-text-dim);
  letter-spacing: 1px;
  text-transform: uppercase;
  grid-column: 1 / 3;
  margin-bottom: 2px;
}
.hs-debug-row input[type="range"] {
  width: 100%;
  accent-color: var(--hs-orange);
}
.hs-debug-row .hs-debug-val {
  font-family: var(--hs-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--hs-text);
  text-align: right;
}
.hs-debug-stat {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--hs-grey);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  font-family: var(--hs-mono);
  font-size: 11px;
  color: var(--hs-text-dim);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.6px;
}
.hs-debug-stat strong { color: var(--hs-orange); font-weight: 600; }
.hs-debug-hint {
  margin-top: 8px;
  color: var(--hs-text-dim);
  font-family: var(--hs-mono);
  font-size: 10px;
  letter-spacing: 0.4px;
}

@media (prefers-reduced-motion: reduce) {
  .hs-onboard-card::after,
  .hs-onboard-btn,
  .hs-term-status .hs-term-rec,
  .hs-terminal,
  .hs-preset-chip.hs-preset-flash {
    animation: none !important;
  }
}
`;

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = UI_STYLES;
  document.head.appendChild(tag);
}
