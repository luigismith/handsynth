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
import { injectStyles } from './styles';
import { t, subscribeLang } from '../i18n';
import type { DictKey } from '../i18n';

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

// 'd' for debug — letter keys are reachable on every international layout
// (the original '?' requires Shift+/ on US but moves elsewhere on IT/FR/DE).
const KEY = 'd';

interface SliderDef {
  id: keyof AudioEngineParams | 'bpm' | 'intensity';
  /** English fallback label. */
  label: string;
  /** i18n key resolved at render time. */
  labelKey: DictKey;
  min: number;
  max: number;
  step: number;
  initial: number;
  log?: boolean;
}

const SLIDERS: SliderDef[] = [
  { id: 'filterCutoff', label: 'Filter cutoff (Hz)', labelKey: 'debug.slider.cutoff', min: 100, max: 16000, step: 1, initial: 8000, log: true },
  { id: 'filterResonance', label: 'Filter resonance Q', labelKey: 'debug.slider.q', min: 0.1, max: 18, step: 0.1, initial: 1.0 },
  { id: 'reverbWet', label: 'Reverb wet', labelKey: 'debug.slider.reverbWet', min: 0, max: 1, step: 0.01, initial: 0.4 },
  { id: 'delayFeedback', label: 'Delay feedback', labelKey: 'debug.slider.delayFb', min: 0, max: 0.9, step: 0.01, initial: 0.35 },
  { id: 'saturatorDrive', label: 'Saturator drive', labelKey: 'debug.slider.drive', min: 0.5, max: 3, step: 0.01, initial: 1.0 },
  { id: 'brightness', label: 'Brightness', labelKey: 'debug.slider.brightness', min: 0, max: 1, step: 0.01, initial: 0.5 },
  { id: 'masterDuck', label: 'Master duck', labelKey: 'debug.slider.duck', min: 0, max: 1, step: 0.01, initial: 0 },
  { id: 'intensity', label: 'Intensity (overrides gesture)', labelKey: 'debug.slider.intensity', min: 0, max: 1, step: 0.01, initial: 0.5 },
  { id: 'bpm', label: 'BPM', labelKey: 'debug.slider.bpm', min: 60, max: 180, step: 1, initial: 92 },
];

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
  private statTimer: number | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private overrides: Partial<AudioEngineParams> = {};
  private bpmCurrent = 92;
  private intensityOverride: number | null = null;
  private toggleEl2: HTMLButtonElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private vibeFieldLabelEl: HTMLLabelElement | null = null;
  private sliderLabelEls = new Map<string, HTMLLabelElement>();
  private vibeOptionEls: HTMLOptionElement[] = [];
  private unsubLang: (() => void) | null = null;

  mount(parent: HTMLElement, deps: DebugPanelDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;

    injectStyles();

    const toggle = document.createElement('button');
    toggle.className = 'hs-debug-toggle';
    toggle.type = 'button';
    parent.appendChild(toggle);
    this.toggleEl = toggle;
    this.toggleEl2 = toggle;

    const card = document.createElement('div');
    card.className = 'hs-debug-card';
    card.hidden = true;
    const title = document.createElement('h3');
    card.appendChild(title);
    this.titleEl = title;
    parent.appendChild(card);
    this.cardEl = card;

    for (const def of SLIDERS) {
      const row = document.createElement('div');
      row.className = 'hs-debug-row';
      const lbl = document.createElement('label');
      lbl.htmlFor = `hs-dbg-${def.id}`;
      this.sliderLabelEls.set(def.id, lbl);
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
    this.vibeFieldLabelEl = vibeLbl;
    vibeRow.appendChild(vibeLbl);
    const vibeSelect = document.createElement('select');
    vibeSelect.style.gridColumn = '1 / 3';
    vibeSelect.style.background = 'var(--hs-bg-deep)';
    vibeSelect.style.color = 'var(--hs-text)';
    vibeSelect.style.border = '1px solid var(--hs-grey-2)';
    vibeSelect.style.borderRadius = '0';
    vibeSelect.style.padding = '4px 8px';
    vibeSelect.style.fontFamily = 'var(--hs-mono)';
    vibeSelect.style.fontSize = '11px';
    vibeSelect.style.textTransform = 'uppercase';
    vibeSelect.style.letterSpacing = '0.6px';
    for (const id of Object.keys(VIBES) as VibeId[]) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.dataset.vibeId = id;
      opt.textContent = t(`vibe.${id}.displayName` as DictKey);
      vibeSelect.appendChild(opt);
      this.vibeOptionEls.push(opt);
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
    this.hintEl = hint;
    card.appendChild(hint);

    this.statEls = {
      intensity: stat.querySelector('[data-hs-stat="intensity"]') as HTMLElement,
      mood: stat.querySelector('[data-hs-stat="mood"]') as HTMLElement,
      bpm: stat.querySelector('[data-hs-stat="bpm"]') as HTMLElement,
    };

    toggle.addEventListener('click', () => this.setVisible(card.hidden));

    this.keydownHandler = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === KEY && !this.isTypingTarget(e.target)) {
        this.setVisible(this.cardEl?.hidden ?? true);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    // Live stat refresh.
    this.statTimer = window.setInterval(() => this.refreshStats(), 250);

    this.applyLang();
    this.unsubLang = subscribeLang(() => this.applyLang());
  }

  /** Re-apply localized labels onto every static element. */
  applyLang(): void {
    if (this.toggleEl2) {
      this.toggleEl2.textContent = t('debug.toggle');
      this.toggleEl2.setAttribute('aria-label', t('debug.toggleAria'));
    }
    if (this.titleEl) this.titleEl.textContent = t('debug.title');
    if (this.hintEl) this.hintEl.textContent = t('debug.hint');
    if (this.vibeFieldLabelEl)
      this.vibeFieldLabelEl.textContent = t('debug.vibeLabel');
    for (const def of SLIDERS) {
      const lbl = this.sliderLabelEls.get(def.id);
      if (lbl) lbl.textContent = t(def.labelKey);
    }
    for (const opt of this.vibeOptionEls) {
      const id = opt.dataset.vibeId;
      if (id) opt.textContent = t(`vibe.${id}.displayName` as DictKey);
    }
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
    if (this.toggleEl) this.toggleEl.remove();
    if (this.cardEl) this.cardEl.remove();
    this.toggleEl = null;
    this.toggleEl2 = null;
    this.titleEl = null;
    this.hintEl = null;
    this.vibeFieldLabelEl = null;
    this.sliderLabelEls.clear();
    this.vibeOptionEls = [];
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
    // Cast through `unknown`: AudioEngineParams now carries a non-numeric
    // field (`smartVoicing: boolean`) so the indexed assignment widens to
    // `number | boolean | undefined`. The DebugPanel only ever drives the
    // numeric sliders; the boolean is set via its own toggle elsewhere.
    (this.overrides as Record<keyof AudioEngineParams, unknown>)[id] = v;
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
