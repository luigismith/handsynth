// Owner: ux-curator
//
// Debug / manual-control panel. Toggleable with the `?` key. Shows live
// values from the InteractionMapper (intensity, mood, BPM, last gesture
// state) and exposes sliders that override key audio params with the
// mouse — useful for tuning without needing webcam input.
//
// Mouse overrides are HOLD-AND-DRAG: while the user is dragging a slider,
// the panel pushes the value via `setParams` directly. When released, the
// gesture-driven InteractionMapper takes over again on the next frame.
//
// Layout: collapsed pill in the top-right corner; expanded into a
// translucent card with sliders + readout.

import type { AudioEngine, AudioEngineParams, MusicBrain, VibeId } from '@contracts/contracts';
import { VIBES } from '@presets/vibes';

export interface DebugPanelDeps {
  audio: AudioEngine;
  music: MusicBrain;
  /** Read-only — the panel reads currentInputIntensity / currentMood. */
  getMapperState: () => { intensity: number; mood: string };
  /** Set intensity manually (overrides gesture-derived value). */
  setManualIntensity: (v: number | null) => void;
  /** Set vibe by id. */
  setVibe: (id: VibeId) => void;
}

const KEY = '?';

interface SliderDef {
  id: keyof AudioEngineParams | 'bpm' | 'intensity';
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  log?: boolean;
}

const SLIDERS: SliderDef[] = [
  { id: 'filterCutoff', label: 'Filter cutoff (Hz)', min: 100, max: 16000, step: 1, initial: 8000, log: true },
  { id: 'filterResonance', label: 'Filter resonance Q', min: 0.1, max: 18, step: 0.1, initial: 1.0 },
  { id: 'reverbWet', label: 'Reverb wet', min: 0, max: 1, step: 0.01, initial: 0.4 },
  { id: 'delayFeedback', label: 'Delay feedback', min: 0, max: 0.9, step: 0.01, initial: 0.35 },
  { id: 'saturatorDrive', label: 'Saturator drive', min: 0.5, max: 3, step: 0.01, initial: 1.0 },
  { id: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, initial: 0.5 },
  { id: 'masterDuck', label: 'Master duck', min: 0, max: 1, step: 0.01, initial: 0 },
  { id: 'intensity', label: 'Intensity (overrides gesture)', min: 0, max: 1, step: 0.01, initial: 0.5 },
  { id: 'bpm', label: 'BPM', min: 60, max: 180, step: 1, initial: 92 },
];

const STYLES = `
.hs-debug-toggle {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  background: rgba(10, 14, 44, 0.6);
  color: #cfd6ff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  padding: 6px 12px;
  font: 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0.45;
  transition: opacity 120ms ease;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.hs-debug-toggle:hover { opacity: 1; }
.hs-debug-card {
  position: absolute;
  top: 50px;
  right: 14px;
  z-index: 10;
  width: 320px;
  background: rgba(8, 12, 36, 0.78);
  color: #e0e6ff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 14px 16px 12px 16px;
  font: 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  pointer-events: auto;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
}
.hs-debug-card[hidden] { display: none; }
.hs-debug-card h3 {
  margin: 0 0 10px 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #f3f6ff;
}
.hs-debug-row {
  display: grid;
  grid-template-columns: 1fr 56px;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.hs-debug-row label {
  font-size: 11px;
  color: #b6c0e8;
  grid-column: 1 / 3;
  margin-bottom: 2px;
}
.hs-debug-row input[type="range"] {
  width: 100%;
  accent-color: #6c80ff;
}
.hs-debug-row .hs-debug-val {
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: #cfd6ff;
  text-align: right;
}
.hs-debug-stat {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 8px;
  font-size: 11px;
  color: #9aa6d4;
  font-variant-numeric: tabular-nums;
}
.hs-debug-stat strong { color: #e0e6ff; font-weight: 500; }
.hs-debug-hint {
  margin-top: 8px;
  color: #6f7baa;
  font-size: 10px;
}
`;

export interface DebugPanelApi {
  mount(parent: HTMLElement, deps: DebugPanelDeps): void;
  unmount(): void;
  /** Show (or hide) the panel programmatically. */
  setVisible(visible: boolean): void;
}

export class DebugPanelImpl implements DebugPanelApi {
  private mounted = false;
  private deps: DebugPanelDeps | null = null;
  private toggleEl: HTMLButtonElement | null = null;
  private cardEl: HTMLDivElement | null = null;
  private statEls: { intensity: HTMLElement; mood: HTMLElement; bpm: HTMLElement } | null = null;
  private styleTagId = 'hs-debug-styles';
  private statTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private overrides: Partial<AudioEngineParams> = {};
  private bpmCurrent = 92;
  private intensityOverride: number | null = null;

  mount(parent: HTMLElement, deps: DebugPanelDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;

    if (!document.getElementById(this.styleTagId)) {
      const tag = document.createElement('style');
      tag.id = this.styleTagId;
      tag.textContent = STYLES;
      document.head.appendChild(tag);
    }

    const toggle = document.createElement('button');
    toggle.className = 'hs-debug-toggle';
    toggle.type = 'button';
    toggle.textContent = 'controls';
    toggle.setAttribute('aria-label', 'Show controls panel');
    parent.appendChild(toggle);
    this.toggleEl = toggle;

    const card = document.createElement('div');
    card.className = 'hs-debug-card';
    card.hidden = true;
    card.innerHTML = `<h3>Controls</h3>`;
    parent.appendChild(card);
    this.cardEl = card;

    for (const def of SLIDERS) {
      const row = document.createElement('div');
      row.className = 'hs-debug-row';
      const lbl = document.createElement('label');
      lbl.htmlFor = `hs-dbg-${def.id}`;
      lbl.textContent = def.label;
      row.appendChild(lbl);
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `hs-dbg-${def.id}`;
      input.min = String(def.log ? 0 : def.min);
      input.max = String(def.log ? 1000 : def.max);
      input.step = String(def.log ? 1 : def.step);
      input.value = String(def.log ? this.toLog(def.initial, def) : def.initial);
      row.appendChild(input);
      const val = document.createElement('div');
      val.className = 'hs-debug-val';
      val.textContent = formatValue(def.initial, def.id);
      row.appendChild(val);

      const onInput = (): void => {
        const raw = parseFloat(input.value);
        const v = def.log ? this.fromLog(raw, def) : raw;
        val.textContent = formatValue(v, def.id);
        this.applyOverride(def.id, v);
      };
      input.addEventListener('input', onInput);
      // Reset specific overrides on dblclick — gesture takes back over.
      input.addEventListener('dblclick', () => {
        if (def.id === 'intensity') {
          this.intensityOverride = null;
          deps.setManualIntensity(null);
          val.textContent = 'auto';
        } else if (def.id === 'bpm') {
          // bpm reset isn't trivial — leave it
        } else {
          delete this.overrides[def.id as keyof AudioEngineParams];
          val.textContent = 'auto';
        }
      });

      card.appendChild(row);
    }

    // Vibe row
    const vibeRow = document.createElement('div');
    vibeRow.className = 'hs-debug-row';
    const vibeLbl = document.createElement('label');
    vibeLbl.textContent = 'Vibe';
    vibeRow.appendChild(vibeLbl);
    const vibeSelect = document.createElement('select');
    vibeSelect.style.gridColumn = '1 / 3';
    vibeSelect.style.background = 'rgba(255,255,255,0.06)';
    vibeSelect.style.color = '#e0e6ff';
    vibeSelect.style.border = '1px solid rgba(255,255,255,0.1)';
    vibeSelect.style.borderRadius = '6px';
    vibeSelect.style.padding = '4px 6px';
    vibeSelect.style.fontSize = '12px';
    for (const id of Object.keys(VIBES) as VibeId[]) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = VIBES[id].displayName;
      vibeSelect.appendChild(opt);
    }
    vibeSelect.addEventListener('change', () => {
      deps.setVibe(vibeSelect.value as VibeId);
    });
    vibeRow.appendChild(vibeSelect);
    card.appendChild(vibeRow);

    // Live stats
    const stat = document.createElement('div');
    stat.className = 'hs-debug-stat';
    stat.innerHTML = `
      <span>intensity</span><strong data-hs-stat="intensity">—</strong>
      <span>mood</span><strong data-hs-stat="mood">—</strong>
      <span>bpm</span><strong data-hs-stat="bpm">—</strong>
    `;
    card.appendChild(stat);

    const hint = document.createElement('div');
    hint.className = 'hs-debug-hint';
    hint.textContent = '? to toggle · double-click a slider to release control';
    card.appendChild(hint);

    this.statEls = {
      intensity: stat.querySelector('[data-hs-stat="intensity"]') as HTMLElement,
      mood: stat.querySelector('[data-hs-stat="mood"]') as HTMLElement,
      bpm: stat.querySelector('[data-hs-stat="bpm"]') as HTMLElement,
    };

    toggle.addEventListener('click', () => this.setVisible(card.hidden));

    this.keydownHandler = (e: KeyboardEvent): void => {
      if (e.key === KEY && !this.isTypingTarget(e.target)) {
        this.setVisible(this.cardEl?.hidden ?? true);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    // Live stat refresh.
    this.statTimer = window.setInterval(() => this.refreshStats(), 250);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.toggleEl) this.toggleEl.remove();
    if (this.cardEl) this.cardEl.remove();
    this.toggleEl = null;
    this.cardEl = null;
    if (this.statTimer !== null) {
      clearInterval(this.statTimer);
      this.statTimer = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.deps = null;
  }

  setVisible(visible: boolean): void {
    if (!this.cardEl) return;
    this.cardEl.hidden = !visible;
  }

  private applyOverride(
    id: keyof AudioEngineParams | 'bpm' | 'intensity',
    v: number,
  ): void {
    if (!this.deps) return;
    if (id === 'bpm') {
      this.bpmCurrent = v;
      // Push BPM into the music brain via setInput — but we don't carry the
      // current vibe here, so the simplest is to write directly to
      // Tone.Transport.bpm.
      // Lazy import to avoid a hard tone dependency in this UI module.
      void import('tone').then((Tone) => {
        Tone.getTransport().bpm.rampTo(v, 0.2);
      });
      return;
    }
    if (id === 'intensity') {
      this.intensityOverride = v;
      this.deps.setManualIntensity(v);
      return;
    }
    this.overrides[id] = v;
    this.deps.audio.setParams({ [id]: v } as Partial<AudioEngineParams>);
  }

  private refreshStats(): void {
    if (!this.deps || !this.statEls) return;
    const s = this.deps.getMapperState();
    this.statEls.intensity.textContent =
      this.intensityOverride !== null
        ? `${this.intensityOverride.toFixed(2)} (override)`
        : s.intensity.toFixed(2);
    this.statEls.mood.textContent = s.mood;
    this.statEls.bpm.textContent = String(Math.round(this.bpmCurrent));
  }

  private toLog(linear: number, def: SliderDef): number {
    // Map linear value in [def.min, def.max] to log-scaled slider in [0, 1000].
    const lo = Math.log(def.min);
    const hi = Math.log(def.max);
    const t = (Math.log(Math.max(linear, def.min)) - lo) / (hi - lo);
    return Math.round(t * 1000);
  }

  private fromLog(rawSliderValue: number, def: SliderDef): number {
    const t = rawSliderValue / 1000;
    const lo = Math.log(def.min);
    const hi = Math.log(def.max);
    return Math.exp(lo + (hi - lo) * t);
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }
}

function formatValue(v: number, id: string): string {
  if (id === 'filterCutoff') return `${Math.round(v)}`;
  if (id === 'bpm') return `${Math.round(v)}`;
  if (id === 'filterResonance') return v.toFixed(1);
  return v.toFixed(2);
}
