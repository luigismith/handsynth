// Owner: ux-curator
//
// Polished analog-synth-style patch editor. Shown at top-right via the gear
// toggle button (or the 'p' key). Owns 9 rotary knobs grouped by section,
// a vibe dropdown, and a Patches sub-section that reads/writes localStorage.
//
// We deliberately do NOT replicate every DebugPanel slider here — DebugPanel
// is the dev shortcut, this is the user-facing one. Both happily coexist:
// the panel writes audio params via deps.audio.setParams; manual intensity is
// exposed via deps.setManualIntensity (mirrors DebugPanel's contract).

import type {
  AudioEngine,
  AudioEngineParams,
  MusicBrain,
  VibeId,
} from '@contracts/contracts';
import { VIBES } from '@presets/vibes';
import { FACTORY_PRESETS, type FactoryPreset } from '@presets/factory-presets';
import { injectStyles } from './styles';
import { Knob, type KnobOpts } from './Knob';
import {
  loadPatches,
  savePatch,
  deletePatch,
  makePatchId,
  type Patch,
} from './patches';

export interface SettingsPanelDeps {
  audio: AudioEngine;
  music: MusicBrain;
  setVibe: (id: VibeId) => void;
  setManualIntensity: (v: number | null) => void;
  getCurrentVibeId: () => VibeId;
  getCurrentParams: () => Partial<AudioEngineParams> & { bpm: number };
}

const TOGGLE_KEY = 'p';

interface KnobDef {
  id: keyof AudioEngineParams | 'bpm' | 'intensity';
  label: string;
  section: 'Filter' | 'Drive' | 'Time FX' | 'Mix' | 'Tempo';
  min: number;
  max: number;
  step: number;
  fallback: number;
  log?: boolean;
  unit?: string;
  digits?: number;
}

const KNOB_DEFS: KnobDef[] = [
  { id: 'filterCutoff', label: 'Cutoff', section: 'Filter', min: 100, max: 16000, step: 1, fallback: 8000, log: true, unit: 'Hz', digits: 0 },
  { id: 'filterResonance', label: 'Q', section: 'Filter', min: 0.1, max: 18, step: 0.1, fallback: 1.0, digits: 1 },
  { id: 'brightness', label: 'Bright', section: 'Filter', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'saturatorDrive', label: 'Drive', section: 'Drive', min: 0.5, max: 3, step: 0.01, fallback: 1.0 },
  { id: 'reverbWet', label: 'Verb', section: 'Time FX', min: 0, max: 1, step: 0.01, fallback: 0.4 },
  { id: 'delayFeedback', label: 'Delay FB', section: 'Time FX', min: 0, max: 0.9, step: 0.01, fallback: 0.35 },
  { id: 'masterDuck', label: 'Duck', section: 'Mix', min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: 'intensity', label: 'Intens.', section: 'Mix', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'bpm', label: 'BPM', section: 'Tempo', min: 60, max: 180, step: 1, fallback: 92, digits: 0 },
];

const SECTION_ORDER: KnobDef['section'][] = ['Filter', 'Drive', 'Time FX', 'Mix', 'Tempo'];

function paramKnobInitial(
  def: KnobDef,
  current: Partial<AudioEngineParams> & { bpm: number },
): number {
  if (def.id === 'bpm') return current.bpm ?? def.fallback;
  if (def.id === 'intensity') return def.fallback; // mapper does not expose snapshot
  const v = (current as Partial<AudioEngineParams>)[def.id];
  return typeof v === 'number' ? v : def.fallback;
}

export class SettingsPanelImpl {
  private mounted = false;
  private deps: SettingsPanelDeps | null = null;
  private cardEl: HTMLDivElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private knobs = new Map<KnobDef['id'], Knob>();
  private patchListEl: HTMLDivElement | null = null;
  private vibeSelectEl: HTMLSelectElement | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private intensityOverride: number | null = null;
  private bpmCurrent = 92;

  mount(parent: HTMLElement, deps: SettingsPanelDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;
    injectStyles();

    // Build card.
    const card = document.createElement('div');
    card.className = 'hs-settings-card hs-collapsed';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Patch editor');

    // Header.
    const header = document.createElement('div');
    header.className = 'hs-settings-header';
    const title = document.createElement('h2');
    title.className = 'hs-settings-title';
    title.textContent = 'PATCH';
    const sub = document.createElement('span');
    sub.className = 'hs-settings-sub';
    sub.textContent = 'EDIT · SAVE · LOAD';
    header.append(title, sub);
    card.appendChild(header);

    // Factory preset chip strip — quick-apply timbre banks above the knobs.
    // Distinct from the user-saved patch list (below the knobs).
    const presetRow = document.createElement('div');
    presetRow.className = 'hs-preset-row';
    presetRow.setAttribute('role', 'group');
    presetRow.setAttribute('aria-label', 'Factory presets');
    for (const preset of FACTORY_PRESETS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hs-preset-chip';
      chip.textContent = preset.name;
      chip.title = preset.tagline;
      chip.setAttribute('aria-label', `Apply preset ${preset.name}: ${preset.tagline}`);
      chip.dataset.presetId = preset.id;
      chip.addEventListener('click', () => this.applyFactoryPreset(preset, chip));
      presetRow.appendChild(chip);
    }
    card.appendChild(presetRow);

    // Sections.
    const initial = deps.getCurrentParams();
    this.bpmCurrent = initial.bpm;

    for (const section of SECTION_ORDER) {
      const sec = document.createElement('div');
      sec.className = 'hs-settings-section';
      const lbl = document.createElement('div');
      lbl.className = 'hs-settings-section-label';
      lbl.textContent = section;
      sec.appendChild(lbl);

      const grid = document.createElement('div');
      grid.className = 'hs-knob-grid';

      for (const def of KNOB_DEFS.filter((d) => d.section === section)) {
        const knob = this.makeKnob(def, paramKnobInitial(def, initial));
        grid.appendChild(knob.el);
        this.knobs.set(def.id, knob);
      }
      sec.appendChild(grid);
      card.appendChild(sec);
    }

    // Vibe dropdown.
    const vibeSec = document.createElement('div');
    vibeSec.className = 'hs-settings-section';
    const vibeLbl = document.createElement('div');
    vibeLbl.className = 'hs-settings-section-label';
    vibeLbl.textContent = 'Vibe';
    vibeSec.appendChild(vibeLbl);
    const vibeRow = document.createElement('div');
    vibeRow.className = 'hs-settings-vibe';
    const vlbl = document.createElement('label');
    vlbl.htmlFor = 'hs-settings-vibe-select';
    vlbl.textContent = 'Preset';
    const vsel = document.createElement('select');
    vsel.id = 'hs-settings-vibe-select';
    for (const id of Object.keys(VIBES) as VibeId[]) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = VIBES[id].displayName;
      vsel.appendChild(opt);
    }
    vsel.value = deps.getCurrentVibeId();
    vsel.addEventListener('change', () => {
      const id = vsel.value as VibeId;
      deps.setVibe(id);
    });
    vibeRow.append(vlbl, vsel);
    vibeSec.appendChild(vibeRow);
    card.appendChild(vibeSec);
    this.vibeSelectEl = vsel;

    // Patches.
    const patchSec = document.createElement('div');
    patchSec.className = 'hs-settings-section';
    const patchLbl = document.createElement('div');
    patchLbl.className = 'hs-settings-section-label';
    patchLbl.textContent = 'Patches';
    patchSec.appendChild(patchLbl);

    const list = document.createElement('div');
    list.className = 'hs-patches';
    patchSec.appendChild(list);
    this.patchListEl = list;
    this.refreshPatchList();

    // Inline name prompt + save / reset.
    const prompt = document.createElement('div');
    prompt.className = 'hs-prompt';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Patch name';
    nameInput.maxLength = 40;
    nameInput.setAttribute('aria-label', 'Patch name');
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'hs-btn hs-btn-tiny hs-btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const raw = nameInput.value.trim();
      const name = raw.length > 0 ? raw : `Patch ${new Date().toLocaleTimeString()}`;
      this.handleSavePatch(name);
      nameInput.value = '';
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });
    prompt.append(nameInput, saveBtn);
    patchSec.appendChild(prompt);

    const actions = document.createElement('div');
    actions.className = 'hs-actions';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'hs-btn hs-btn-tiny';
    resetBtn.textContent = 'Reset to vibe';
    resetBtn.addEventListener('click', () => this.resetToVibe());
    actions.appendChild(resetBtn);
    patchSec.appendChild(actions);

    card.appendChild(patchSec);

    parent.appendChild(card);
    this.cardEl = card;

    // Gear toggle button.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'settings-toggle-btn';
    btn.className = 'hs-settings-toggle';
    btn.setAttribute('aria-label', 'Toggle patch editor');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    btn.addEventListener('click', () => this.setVisible(!this.isVisible()));
    parent.appendChild(btn);
    this.toggleBtn = btn;

    // Keybinding.
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === TOGGLE_KEY && !this.isTypingTarget(e.target)) {
        this.setVisible(!this.isVisible());
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    for (const k of this.knobs.values()) k.destroy();
    this.knobs.clear();
    if (this.cardEl) this.cardEl.remove();
    if (this.toggleBtn) this.toggleBtn.remove();
    this.cardEl = null;
    this.toggleBtn = null;
    this.patchListEl = null;
    this.vibeSelectEl = null;
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.deps = null;
  }

  setVisible(visible: boolean): void {
    if (!this.cardEl || !this.toggleBtn) return;
    if (visible) {
      this.cardEl.hidden = false;
      // Force reflow so the transition sees the hidden→visible state change.
      void this.cardEl.offsetWidth;
      this.cardEl.classList.remove('hs-collapsed');
      this.toggleBtn.setAttribute('aria-expanded', 'true');
      this.refreshPatchList();
    } else {
      this.cardEl.classList.add('hs-collapsed');
      this.toggleBtn.setAttribute('aria-expanded', 'false');
      // Hide after transition completes.
      const card = this.cardEl;
      window.setTimeout(() => {
        if (card.classList.contains('hs-collapsed')) card.hidden = true;
      }, 220);
    }
  }

  isVisible(): boolean {
    return this.cardEl !== null && !this.cardEl.hidden && !this.cardEl.classList.contains('hs-collapsed');
  }

  // ------------------------------------------------------------------------
  // Knob construction & mapping
  // ------------------------------------------------------------------------

  private makeKnob(def: KnobDef, initial: number): Knob {
    const opts: KnobOpts = {
      label: def.label,
      min: def.min,
      max: def.max,
      step: def.step,
      value: initial,
      defaultValue: def.fallback,
      onChange: (v) => this.applyKnobValue(def, v),
    };
    if (def.log) opts.log = def.log;
    if (def.unit !== undefined) opts.unit = def.unit;
    if (def.digits !== undefined) opts.digits = def.digits;
    return new Knob(opts);
  }

  private applyKnobValue(def: KnobDef, v: number): void {
    if (!this.deps) return;
    if (def.id === 'bpm') {
      this.bpmCurrent = v;
      // Lazy import + guard — in test environments Tone.Transport.bpm may
      // not be a real Param; in that case we just record the value locally.
      void import('tone').then((Tone) => {
        try {
          const bpm = Tone.getTransport()?.bpm;
          if (bpm && typeof (bpm as { rampTo?: unknown }).rampTo === 'function') {
            bpm.rampTo(v, 0.2);
          }
        } catch {
          /* noop — outside the audio context */
        }
      });
      return;
    }
    if (def.id === 'intensity') {
      this.intensityOverride = v;
      this.deps.setManualIntensity(v);
      return;
    }
    const partial: Partial<AudioEngineParams> = {
      [def.id]: v,
    } as Partial<AudioEngineParams>;
    this.deps.audio.setParams(partial);
  }

  // ------------------------------------------------------------------------
  // Factory preset application
  // ------------------------------------------------------------------------

  /**
   * Apply a factory preset as a one-shot: push params to the audio engine,
   * update knob visuals to match, ramp BPM if specified, and flash the
   * clicked chip briefly to confirm. There's no persistent "active" state —
   * the user can keep tweaking afterwards.
   */
  private applyFactoryPreset(preset: FactoryPreset, chip: HTMLButtonElement): void {
    if (!this.deps) return;

    // Split out bpm — it isn't an AudioEngineParam, it goes to Tone.Transport.
    const { bpm, ...audioParams } = preset.params;

    // Push timbral params first so the engine smooths them.
    if (Object.keys(audioParams).length > 0) {
      this.deps.audio.setParams(audioParams as Partial<AudioEngineParams>);
    }

    // Ramp BPM if the preset has a tempo identity.
    if (typeof bpm === 'number') {
      this.bpmCurrent = bpm;
      void import('tone').then((Tone) => {
        try {
          const t = Tone.getTransport()?.bpm;
          if (t && typeof (t as { rampTo?: unknown }).rampTo === 'function') {
            t.rampTo(bpm, 0.5);
          }
        } catch {
          /* noop — outside the audio context */
        }
      });
    }

    // Mirror knob visuals — fire=false so we don't double-push to audio.
    for (const def of KNOB_DEFS) {
      if (def.id === 'intensity') continue;
      const k = this.knobs.get(def.id);
      if (!k) continue;
      const v = (preset.params as Record<string, number | undefined>)[def.id];
      if (typeof v === 'number') k.setValue(v, false);
    }

    // Brief flash to confirm — class auto-removes when the animation ends.
    chip.classList.remove('hs-preset-flash');
    // Force reflow so re-adding the class restarts the keyframe animation.
    void chip.offsetWidth;
    chip.classList.add('hs-preset-flash');
    const onEnd = (): void => {
      chip.classList.remove('hs-preset-flash');
      chip.removeEventListener('animationend', onEnd);
    };
    chip.addEventListener('animationend', onEnd);
  }

  // ------------------------------------------------------------------------
  // Patch save / load
  // ------------------------------------------------------------------------

  private currentParamsSnapshot(): Patch['params'] {
    const out: Partial<AudioEngineParams> = {};
    for (const def of KNOB_DEFS) {
      if (def.id === 'bpm' || def.id === 'intensity') continue;
      const k = this.knobs.get(def.id);
      if (!k) continue;
      // We read the numeric value through the dial's aria-valuenow, which the
      // Knob component keeps in sync with its internal state.
      const dial = k.el.querySelector('.hs-knob-dial');
      const raw = dial?.getAttribute('aria-valuenow');
      if (raw !== null && raw !== undefined) {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          (out as Record<string, number>)[def.id] = n;
        }
      }
    }
    return out;
  }

  private handleSavePatch(name: string): void {
    if (!this.deps) return;
    const vibe = this.deps.getCurrentVibeId();
    const params = this.currentParamsSnapshot();
    const patch: Patch = {
      id: makePatchId(),
      name,
      vibe,
      params,
      bpm: this.bpmCurrent,
      createdAt: Date.now(),
    };
    savePatch(patch);
    this.refreshPatchList();
  }

  private loadPatch(p: Patch): void {
    if (!this.deps) return;
    // Apply vibe first so the engines retune before parameter overrides.
    this.deps.setVibe(p.vibe);
    if (this.vibeSelectEl) this.vibeSelectEl.value = p.vibe;

    // Apply params via knobs (they push to audio).
    for (const def of KNOB_DEFS) {
      if (def.id === 'bpm') {
        const k = this.knobs.get('bpm');
        k?.setValue(p.bpm, true);
        continue;
      }
      if (def.id === 'intensity') continue;
      const v = (p.params as Record<string, number | undefined>)[def.id];
      if (typeof v === 'number') {
        const k = this.knobs.get(def.id);
        k?.setValue(v, true);
      }
    }
  }

  private refreshPatchList(): void {
    if (!this.patchListEl) return;
    const list = this.patchListEl;
    list.replaceChildren();
    const patches = loadPatches();
    if (patches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hs-patches-empty';
      empty.textContent = 'No saved patches.';
      list.appendChild(empty);
      return;
    }
    for (const p of patches) {
      const row = document.createElement('div');
      row.className = 'hs-patches-row';
      const name = document.createElement('div');
      name.className = 'hs-patches-name';
      name.textContent = p.name;
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'hs-btn hs-btn-tiny';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => this.loadPatch(p));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'hs-btn hs-btn-tiny hs-btn-danger';
      delBtn.textContent = 'Del';
      delBtn.addEventListener('click', () => {
        deletePatch(p.id);
        this.refreshPatchList();
      });
      row.append(name, loadBtn, delBtn);
      list.appendChild(row);
    }
  }

  private resetToVibe(): void {
    if (!this.deps) return;
    const vibeId = this.deps.getCurrentVibeId();
    const v = VIBES[vibeId];
    // Map known vibe defaults -> knobs.
    const defaults: Record<string, number | undefined> = {
      reverbWet: v.reverbWet,
      delayFeedback: 0.35,
      saturatorDrive: v.saturatorDrive,
      filterCutoff: 8000,
      filterResonance: 1.0,
      brightness: 0.5,
      masterDuck: 0,
      bpm: v.bpm,
    };
    for (const def of KNOB_DEFS) {
      if (def.id === 'intensity') {
        this.intensityOverride = null;
        this.deps.setManualIntensity(null);
        const k = this.knobs.get('intensity');
        k?.setValue(def.fallback, false);
        continue;
      }
      const dv = defaults[def.id as string];
      const k = this.knobs.get(def.id);
      if (k && typeof dv === 'number') k.setValue(dv, true);
    }
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
  }
}
