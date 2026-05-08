// Owner: ux-curator
//
// Tiny helper that injects a single <style> tag with all UI styles into
// document.head. Called once from main.ts at boot. Splitting it out keeps
// Onboarding / VibeSelector / SettingsPanel / Terminal free of CSS strings
// and lets us guarantee the stylesheet is present before any UI module
// tries to mount.

const STYLE_ID = 'handsynth-ui-styles';

export const UI_STYLES = `
@keyframes hs-rise {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes hs-toast-rise {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes hs-rec-pulse {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 1; }
}

.hs-onboard-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: linear-gradient(160deg, rgba(28,38,90,0.6), rgba(12,16,40,0.55));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 32px 40px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.04) inset, 0 18px 48px rgba(0,0,0,0.45);
  text-align: center;
  max-width: 420px;
  pointer-events: auto;
  transition: opacity 200ms ease;
  opacity: 1;
  animation: hs-rise 240ms ease-out both;
}
.hs-onboard-card.hs-fade-out {
  opacity: 0;
  pointer-events: none;
}
.hs-onboard-title {
  margin: 0 0 6px 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: #f3f6ff;
}
.hs-onboard-sub {
  margin: 0 0 22px 0;
  font-size: 15px;
  color: #b6c0e8;
}
.hs-onboard-btn {
  appearance: none;
  border: 0;
  background: linear-gradient(180deg, #5a76ff, #4256d8);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  padding: 12px 22px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.2px;
  box-shadow: 0 6px 18px rgba(70, 90, 220, 0.45);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}
.hs-onboard-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
.hs-onboard-btn:focus-visible {
  outline: 2px solid #c9d4ff;
  outline-offset: 3px;
}
.hs-onboard-btn:active { transform: translateY(0); }
.hs-onboard-cheats {
  margin-top: 14px;
  font-size: 12px;
  color: #8794c5;
  letter-spacing: 0.3px;
}
.hs-onboard-error {
  margin-top: 14px;
  font-size: 13px;
  color: #ffb8b8;
}

.hs-vibes {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 999px;
  background: rgba(10, 14, 44, 0.35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 255, 255, 0.05);
  pointer-events: auto;
  opacity: 0.25;
  transition: opacity 200ms ease;
}
.hs-vibes:hover, .hs-vibes:focus-within { opacity: 1; }
.hs-vibe-chip {
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  color: #cfd6ff;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.2px;
  transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease, filter 160ms ease;
}
.hs-vibe-chip:hover { background: rgba(255, 255, 255, 0.08); }
.hs-vibe-chip:focus-visible {
  outline: 2px solid #c9d4ff;
  outline-offset: 2px;
}
.hs-vibe-chip[aria-checked='true'] {
  background: rgba(120, 140, 255, 0.22);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(180, 200, 255, 0.6);
  filter: drop-shadow(0 0 8px rgba(120, 140, 255, 0.45));
}

.hs-error-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: rgba(40, 18, 28, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 120, 120, 0.25);
  border-radius: 14px;
  padding: 22px 26px;
  max-width: 380px;
  pointer-events: auto;
  text-align: center;
  color: #ffd9d9;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
}
.hs-error-msg { margin: 0 0 14px 0; font-size: 14px; line-height: 1.45; }
.hs-error-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
}
.hs-error-btn:hover { background: rgba(255, 255, 255, 0.12); }
.hs-error-btn:focus-visible {
  outline: 2px solid #c9d4ff;
  outline-offset: 2px;
}

.hs-toast {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  background: rgba(20, 30, 80, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e7ecff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 999px;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset;
  transition: opacity 240ms ease;
  opacity: 1;
  animation: hs-toast-rise 220ms ease-out both;
}
.hs-toast.hs-fade-out { opacity: 0; }

/* =========================================================================
 * Settings panel (analog-synth aesthetic)
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
  background: rgba(10, 14, 44, 0.55);
  color: #cfd6ff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0.55;
  padding: 0;
  transition: opacity 120ms ease, transform 200ms ease;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.hs-settings-toggle:hover { opacity: 1; transform: rotate(45deg); }
.hs-settings-toggle:focus-visible {
  outline: 2px solid #c9d4ff;
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
  color: #f5e6c8;
  font: 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.04)),
    repeating-linear-gradient(90deg, rgba(255,224,170,0.012) 0 2px, transparent 2px 5px),
    linear-gradient(180deg, #1a1620, #0e0a14);
  border: 1px solid rgba(255, 212, 126, 0.18);
  border-radius: 14px;
  padding: 14px 16px 12px 16px;
  box-shadow:
    0 0 0 1px rgba(255, 212, 126, 0.06) inset,
    0 18px 46px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
  transform-origin: top right;
  transition: transform 200ms ease, opacity 200ms ease;
  opacity: 1;
  transform: scale(1);
}
.hs-settings-card[hidden] { display: none; }
.hs-settings-card.hs-collapsed {
  opacity: 0;
  transform: scale(0.96);
  pointer-events: none;
}
/* CRT scanline overlay */
.hs-settings-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: repeating-linear-gradient(
    180deg,
    rgba(255,255,255,0.025) 0 1px,
    transparent 1px 3px
  );
  mix-blend-mode: overlay;
}
.hs-settings-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.hs-settings-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
  color: #ffd47e;
  text-transform: uppercase;
}
.hs-settings-sub {
  font-size: 10px;
  color: #998668;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.hs-settings-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 212, 126, 0.08);
}
.hs-settings-section-label {
  font-size: 10px;
  letter-spacing: 1.5px;
  color: #c79c4c;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.hs-knob-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 6px;
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
    radial-gradient(circle at 35% 30%, #4a4250, #1d1822 70%),
    radial-gradient(circle at 50% 50%, #3a3540, #161218);
  border: 1px solid rgba(0, 0, 0, 0.45);
  box-shadow:
    0 0 0 1px rgba(255, 212, 126, 0.06) inset,
    0 2px 4px rgba(0, 0, 0, 0.5),
    0 0 6px rgba(255, 212, 126, 0.02);
  cursor: ns-resize;
  outline: none;
  transition: box-shadow 120ms ease;
}
.hs-knob-dial:focus-visible {
  box-shadow:
    0 0 0 2px #c9d4ff,
    0 2px 4px rgba(0, 0, 0, 0.5);
}
.hs-knob-indicator {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 18px;
  background: linear-gradient(180deg, #ffd47e, #d49b3e);
  transform-origin: 50% 100%;
  transform: translate(-50%, -100%);
  border-radius: 1px;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(255, 212, 126, 0.55);
}
.hs-knob-label {
  margin-top: 4px;
  font-size: 9px;
  color: #c79c4c;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  text-align: center;
}
.hs-knob-value {
  margin-top: 1px;
  font: 10px ui-monospace, "JetBrains Mono", "Fira Code", Consolas, monospace;
  color: #f5e6c8;
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
  font-size: 10px;
  color: #c79c4c;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.hs-settings-vibe select {
  background: rgba(0,0,0,0.35);
  color: #f5e6c8;
  border: 1px solid rgba(255, 212, 126, 0.18);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 11px;
  font-family: inherit;
}
.hs-settings-vibe select:focus-visible {
  outline: 2px solid #c9d4ff;
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
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.02);
  margin-bottom: 4px;
}
.hs-patches-row .hs-patches-name {
  flex: 1 1 auto;
  font-size: 11px;
  color: #f5e6c8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hs-patches-empty {
  font-size: 10px;
  color: #6b5a3c;
  letter-spacing: 0.4px;
  padding: 4px 0;
}
.hs-btn {
  appearance: none;
  border: 1px solid rgba(255, 212, 126, 0.2);
  background: rgba(255, 212, 126, 0.08);
  color: #ffd47e;
  font: 11px ui-monospace, "JetBrains Mono", "Fira Code", Consolas, monospace;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  transition: background 120ms ease;
}
.hs-btn:hover { background: rgba(255, 212, 126, 0.16); }
.hs-btn:focus-visible {
  outline: 2px solid #c9d4ff;
  outline-offset: 2px;
}
.hs-btn-tiny {
  padding: 2px 6px;
  font-size: 10px;
}
.hs-btn-danger {
  border-color: rgba(255, 138, 92, 0.35);
  color: #ff8a5c;
  background: rgba(255, 138, 92, 0.08);
}
.hs-btn-danger:hover { background: rgba(255, 138, 92, 0.18); }
.hs-actions { display: flex; gap: 6px; margin-top: 6px; }

.hs-prompt {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.hs-prompt input[type="text"] {
  flex: 1 1 auto;
  background: rgba(0,0,0,0.35);
  color: #f5e6c8;
  border: 1px solid rgba(255, 212, 126, 0.18);
  border-radius: 6px;
  padding: 5px 8px;
  font: 11px ui-monospace, "JetBrains Mono", "Fira Code", Consolas, monospace;
}
.hs-prompt input[type="text"]:focus-visible {
  outline: 2px solid #c9d4ff;
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
  left: 0;
  right: 0;
  bottom: 0;
  height: 30vh;
  z-index: 12;
  background: rgba(2, 8, 4, 0.78);
  color: #9ff8c0;
  font: 12px ui-monospace, "JetBrains Mono", "Fira Code", Consolas, monospace;
  line-height: 1.45;
  padding: 0;
  pointer-events: auto;
  border-top: 1px solid rgba(125, 247, 192, 0.15);
  display: flex;
  flex-direction: column;
  animation: hs-term-flicker 0.125s steps(2) infinite;
  box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.45);
}
.hs-terminal[hidden] { display: none; }
.hs-terminal::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    180deg,
    rgba(125, 247, 192, 0.025) 0 1px,
    transparent 1px 3px
  );
}
.hs-term-status {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 5px 10px;
  background: #031208;
  border-bottom: 1px solid rgba(125, 247, 192, 0.12);
  font-size: 11px;
  color: #9ff8c0;
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}
.hs-term-status .hs-term-rec {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff5a5a;
  box-shadow: 0 0 6px rgba(255, 90, 90, 0.7);
  animation: hs-rec-pulse 1.4s ease-in-out infinite;
}
.hs-term-status .hs-term-stat {
  display: inline-flex;
  gap: 4px;
}
.hs-term-status .hs-term-stat-label {
  color: #5a8a72;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.hs-term-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 10px 6px 10px;
  scroll-behavior: smooth;
}
.hs-term-line {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 0;
  opacity: 1;
  transition: opacity 1.5s linear;
  text-shadow: 0 0 4px rgba(159, 248, 192, 0.3);
}
.hs-term-line.hs-fade { opacity: 0.45; }
.hs-term-line.hs-fresh {
  background: rgba(159, 248, 192, 0.06);
}
.hs-term-prefix {
  color: #5a8a72;
  margin-right: 6px;
}
.hs-term-line[data-kind="lead"]    { color: #ffd47e; }
.hs-term-line[data-kind="bass"]    { color: #ff8a5c; }
.hs-term-line[data-kind="chord"]   { color: #a3a8ff; }
.hs-term-line[data-kind="kick"],
.hs-term-line[data-kind="hat"],
.hs-term-line[data-kind="perc"]    { color: #7df7ff; }
.hs-term-line[data-kind="gesture"] { color: #a0a0a0; }
.hs-term-line[data-kind="beat"]    { color: #5a8a72; }
.hs-term-line[data-kind="info"]    { color: #9ff8c0; }
`;

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = UI_STYLES;
  document.head.appendChild(tag);
}
