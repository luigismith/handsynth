// Owner: ux-curator
//
// Tiny helper that injects a single <style> tag with all UI styles into
// document.head. Called once from main.ts at boot. Splitting it out keeps
// Onboarding / VibeSelector free of CSS strings and lets us guarantee the
// stylesheet is present before any UI module tries to mount.

const STYLE_ID = 'handsynth-ui-styles';

export const UI_STYLES = `
.hs-onboard-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: rgba(20, 30, 80, 0.42);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 32px 40px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  text-align: center;
  max-width: 420px;
  pointer-events: auto;
  transition: opacity 200ms ease;
  opacity: 1;
}
.hs-onboard-card.hs-fade-out {
  opacity: 0;
  pointer-events: none;
}
.hs-onboard-title {
  margin: 0 0 6px 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.4px;
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
  transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
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

.hs-toast {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  background: rgba(20, 30, 80, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e7ecff;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: 999px;
  pointer-events: auto;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: opacity 240ms ease;
  opacity: 1;
}
.hs-toast.hs-fade-out { opacity: 0; }
`;

export function injectStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement('style');
  tag.id = STYLE_ID;
  tag.textContent = UI_STYLES;
  document.head.appendChild(tag);
}
