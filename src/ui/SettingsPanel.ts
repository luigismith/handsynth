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
import type { VoiceShape } from '@audio/voice-shape';
import { VIBES } from '@presets/vibes';
import { FACTORY_PRESETS, type FactoryPreset } from '@presets/factory-presets';
import { SCALE_OPTIONS, SCALE_OPTION_IDS } from '@presets/scale-options';
import {
  KEY_OPTIONS,
  KEY_OPTION_IDS,
  normalizeKeyId,
} from '@presets/key-options';

/**
 * The contract `AudioEngine` interface (in `@contracts/contracts`) is owned
 * by another agent and we deliberately don't extend it here. The concrete
 * `AudioEngineImpl` exposes `applyVoiceShape` for factory-preset timbre
 * overlays plus per-voice `setVoiceTimbre`/`getVoiceTimbre`/`getSmartVoicing`
 * for the analog "WAVE" knobs. We widen the dep type via this intersection
 * so SettingsPanel can call them without depending on the impl class. Each
 * call site guards in case the dep is a partial test stub.
 */
type VoiceKey = 'pad' | 'lead' | 'bass';
type AudioEngineExtended = AudioEngine & {
  applyVoiceShape?: (shape: VoiceShape | undefined) => void;
  setVoiceTimbre?: (voice: VoiceKey, value: number) => void;
  getVoiceTimbre?: (voice: VoiceKey) => number;
  getSmartVoicing?: () => boolean;
};
import { injectStyles } from './styles';
import { Knob, type KnobOpts } from './Knob';
import {
  loadPatches,
  savePatch,
  deletePatch,
  makePatchId,
  type Patch,
} from './patches';
import { t, subscribeLang } from '../i18n';
import type { DictKey } from '../i18n';

export interface SettingsPanelDeps {
  audio: AudioEngine;
  music: MusicBrain;
  setVibe: (id: VibeId) => void;
  setManualIntensity: (v: number | null) => void;
  getCurrentVibeId: () => VibeId;
  getCurrentParams: () => Partial<AudioEngineParams> & { bpm: number };
}

const TOGGLE_KEY = 'p';

/** localStorage key for the user's scale + key override. */
const MUSIC_SETTINGS_KEY = 'hs.musicSettings';

interface PersistedMusicSettings {
  key: string;
  mode: string;
}

function loadMusicSettings(): PersistedMusicSettings | null {
  try {
    const raw = localStorage.getItem(MUSIC_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedMusicSettings>;
    if (
      typeof parsed.key === 'string' &&
      typeof parsed.mode === 'string' &&
      KEY_OPTION_IDS.has(parsed.key) &&
      SCALE_OPTION_IDS.has(parsed.mode)
    ) {
      return { key: parsed.key, mode: parsed.mode };
    }
    return null;
  } catch {
    return null;
  }
}

function saveMusicSettings(s: PersistedMusicSettings): void {
  try {
    localStorage.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* localStorage may be denied (private mode); silently noop */
  }
}

function clearMusicSettings(): void {
  try {
    localStorage.removeItem(MUSIC_SETTINGS_KEY);
  } catch {
    /* noop */
  }
}

type KnobSection = 'Filter' | 'Drive' | 'Time FX' | 'Mix' | 'Tempo' | 'Voice';

/**
 * Knob ids fall into a few buckets:
 *   * AudioEngineParams keys (filterCutoff / Q / drive / verb / ...) → routed
 *     through audio.setParams.
 *   * 'bpm' → routed to Tone.Transport.
 *   * 'intensity' → routed to deps.setManualIntensity.
 *   * 'padTimbre' / 'leadTimbre' / 'bassTimbre' → the analog "WAVE" knobs,
 *     routed to audio.setVoiceTimbre(voice, v). They're NOT
 *     AudioEngineParams keys because they're per-voice (not master-level).
 */
type KnobId =
  | keyof AudioEngineParams
  | 'bpm'
  | 'intensity'
  | 'padTimbre'
  | 'leadTimbre'
  | 'bassTimbre';

interface KnobDef {
  id: KnobId;
  /** English fallback label — also the assertion target in tests. */
  label: string;
  /** i18n key for the localized label. Resolved at render time. */
  labelKey: DictKey;
  section: KnobSection;
  /** i18n key for the localized section heading. */
  sectionKey: DictKey;
  min: number;
  max: number;
  step: number;
  fallback: number;
  log?: boolean;
  unit?: string;
  digits?: number;
}

const KNOB_DEFS: KnobDef[] = [
  { id: 'filterCutoff', label: 'Cutoff', labelKey: 'panel.patch.knob.cutoff', section: 'Filter', sectionKey: 'panel.patch.section.filter', min: 100, max: 16000, step: 1, fallback: 8000, log: true, unit: 'Hz', digits: 0 },
  { id: 'filterResonance', label: 'Q', labelKey: 'panel.patch.knob.q', section: 'Filter', sectionKey: 'panel.patch.section.filter', min: 0.1, max: 18, step: 0.1, fallback: 1.0, digits: 1 },
  { id: 'brightness', label: 'Bright', labelKey: 'panel.patch.knob.bright', section: 'Filter', sectionKey: 'panel.patch.section.filter', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'saturatorDrive', label: 'Drive', labelKey: 'panel.patch.knob.drive', section: 'Drive', sectionKey: 'panel.patch.section.drive', min: 0.5, max: 3, step: 0.01, fallback: 1.0 },
  { id: 'reverbWet', label: 'Verb', labelKey: 'panel.patch.knob.verb', section: 'Time FX', sectionKey: 'panel.patch.section.timefx', min: 0, max: 1, step: 0.01, fallback: 0.4 },
  { id: 'delayFeedback', label: 'Delay FB', labelKey: 'panel.patch.knob.delayfb', section: 'Time FX', sectionKey: 'panel.patch.section.timefx', min: 0, max: 0.9, step: 0.01, fallback: 0.35 },
  { id: 'masterDuck', label: 'Duck', labelKey: 'panel.patch.knob.duck', section: 'Mix', sectionKey: 'panel.patch.section.mix', min: 0, max: 1, step: 0.01, fallback: 0 },
  { id: 'intensity', label: 'Intens.', labelKey: 'panel.patch.knob.intens', section: 'Mix', sectionKey: 'panel.patch.section.mix', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'bpm', label: 'BPM', labelKey: 'panel.patch.knob.bpm', section: 'Tempo', sectionKey: 'panel.patch.section.tempo', min: 60, max: 180, step: 1, fallback: 92, digits: 0 },
  // Per-voice analog "WAVE" knobs — crossfade A (vibe/preset oscillator)
  // toward B (sine for pad, pulse for lead, triangle for bass). The
  // continuous WAVE feel: 0..1, default 0.5 = balanced mix.
  { id: 'padTimbre', label: 'Pad Wave', labelKey: 'panel.patch.knob.padTimbre', section: 'Voice', sectionKey: 'panel.patch.section.voice', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'leadTimbre', label: 'Lead Wave', labelKey: 'panel.patch.knob.leadTimbre', section: 'Voice', sectionKey: 'panel.patch.section.voice', min: 0, max: 1, step: 0.01, fallback: 0.5 },
  { id: 'bassTimbre', label: 'Bass Wave', labelKey: 'panel.patch.knob.bassTimbre', section: 'Voice', sectionKey: 'panel.patch.section.voice', min: 0, max: 1, step: 0.01, fallback: 0.5 },
];

const SECTION_ORDER: KnobSection[] = ['Filter', 'Drive', 'Time FX', 'Mix', 'Tempo', 'Voice'];

const SECTION_KEY_BY_NAME: Record<KnobSection, DictKey> = {
  Filter: 'panel.patch.section.filter',
  Drive: 'panel.patch.section.drive',
  'Time FX': 'panel.patch.section.timefx',
  Mix: 'panel.patch.section.mix',
  Tempo: 'panel.patch.section.tempo',
  Voice: 'panel.patch.section.voice',
};

/** Map voice-knob ids → underlying voice key for audio.setVoiceTimbre. */
const VOICE_KNOB_TO_VOICE: Partial<Record<KnobId, VoiceKey>> = {
  padTimbre: 'pad',
  leadTimbre: 'lead',
  bassTimbre: 'bass',
};

function paramKnobInitial(
  def: KnobDef,
  current: Partial<AudioEngineParams> & { bpm: number },
): number {
  if (def.id === 'bpm') return current.bpm ?? def.fallback;
  if (def.id === 'intensity') return def.fallback; // mapper does not expose snapshot
  // Voice timbre knobs are per-voice state on the AudioEngine, not on the
  // AudioEngineParams snapshot. We seed from the fallback (0.5) at mount;
  // the caller can sync from audio.getVoiceTimbre via a separate path if
  // needed (today the engine's userTimbre defaults to 0.5 too, so they
  // already agree).
  if (def.id === 'padTimbre' || def.id === 'leadTimbre' || def.id === 'bassTimbre') {
    return def.fallback;
  }
  const v = (current as Partial<AudioEngineParams>)[def.id];
  return typeof v === 'number' ? v : def.fallback;
}

export class SettingsPanelImpl {
  private mounted = false;
  private deps: SettingsPanelDeps | null = null;
  private cardEl: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private subEl: HTMLSpanElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private knobs = new Map<KnobDef['id'], Knob>();
  private patchListEl: HTMLDivElement | null = null;
  private vibeSelectEl: HTMLSelectElement | null = null;
  private keySelectEl: HTMLSelectElement | null = null;
  private scaleSelectEl: HTMLSelectElement | null = null;
  private keyLabelEl: HTMLLabelElement | null = null;
  private scaleLabelEl: HTMLLabelElement | null = null;
  private musicResetBtn: HTMLButtonElement | null = null;
  private vibeFieldLabelEl: HTMLLabelElement | null = null;
  private patchSaveBtn: HTMLButtonElement | null = null;
  private patchNameInputEl: HTMLInputElement | null = null;
  private patchResetVibeBtn: HTMLButtonElement | null = null;
  private sectionLabelEls = new Map<KnobSection | 'Vibe' | 'Patches', HTMLDivElement>();
  private presetChips: Array<{ chip: HTMLButtonElement; preset: FactoryPreset }> = [];
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private intensityOverride: number | null = null;
  private bpmCurrent = 92;
  /** The SMART pill button + its on/off state mirror. The audio engine is
   * the source of truth (via getSmartVoicing); this mirror is just so the
   * pill aria/class doesn't have to round-trip through the engine. */
  private smartPillEl: HTMLButtonElement | null = null;
  private smartOn = true;
  private unsubLang: (() => void) | null = null;

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

    // Header.
    const header = document.createElement('div');
    header.className = 'hs-settings-header';
    const title = document.createElement('h2');
    title.className = 'hs-settings-title';
    const sub = document.createElement('span');
    sub.className = 'hs-settings-sub';
    header.append(title, sub);
    card.appendChild(header);
    this.titleEl = title;
    this.subEl = sub;

    // Factory preset chip strip — quick-apply timbre banks above the knobs.
    // Distinct from the user-saved patch list (below the knobs).
    const presetRow = document.createElement('div');
    presetRow.className = 'hs-preset-row';
    presetRow.setAttribute('role', 'group');
    for (const preset of FACTORY_PRESETS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hs-preset-chip';
      // Display name stays uppercase 4-char (LUSH / ACID / etc.) — these are
      // brand-style labels that read the same in any language.
      chip.textContent = preset.name;
      chip.dataset.presetId = preset.id;
      chip.addEventListener('click', () => this.applyFactoryPreset(preset, chip));
      presetRow.appendChild(chip);
      this.presetChips.push({ chip, preset });
    }
    card.appendChild(presetRow);

    // Key + scale selectors. Sit above the knobs so the harmonic identity
    // is the first thing the user sees after the factory chips. The vibe
    // still seeds these on first load; the user override is sticky and
    // persists to localStorage.
    card.appendChild(this.buildMusicRow());

    // Sections.
    const initial = deps.getCurrentParams();
    this.bpmCurrent = initial.bpm;

    for (const section of SECTION_ORDER) {
      const sec = document.createElement('div');
      sec.className = 'hs-settings-section';
      const lbl = document.createElement('div');
      lbl.className = 'hs-settings-section-label';
      sec.appendChild(lbl);
      this.sectionLabelEls.set(section, lbl);

      // The Voice section gets a SMART toggle pill anchored to the header.
      // It controls the intelligent-voicing router — when ON (default), the
      // AudioEngine nudges each voice's timbre by ±0.15 based on the
      // running FX state (low cutoff → sine, high drive → square, etc.).
      // When OFF, the nudge collapses to zero and only the user-set
      // timbre knobs apply.
      if (section === 'Voice') {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'hs-smart-pill';
        pill.dataset.smartPill = '';
        const initialSmart =
          (this.deps?.audio as AudioEngineExtended).getSmartVoicing?.() ?? true;
        this.smartOn = initialSmart;
        pill.setAttribute('aria-pressed', String(initialSmart));
        if (initialSmart) pill.classList.add('hs-smart-pill-on');
        pill.addEventListener('click', () => this.toggleSmartVoicing());
        this.smartPillEl = pill;
        // Wrap label + pill on the same row so the pill floats right.
        const header = document.createElement('div');
        header.className = 'hs-settings-section-header';
        // Move the label into the header row.
        sec.removeChild(lbl);
        header.appendChild(lbl);
        header.appendChild(pill);
        sec.appendChild(header);
      }

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
    vibeSec.appendChild(vibeLbl);
    this.sectionLabelEls.set('Vibe', vibeLbl);
    const vibeRow = document.createElement('div');
    vibeRow.className = 'hs-settings-vibe';
    const vlbl = document.createElement('label');
    vlbl.htmlFor = 'hs-settings-vibe-select';
    this.vibeFieldLabelEl = vlbl;
    const vsel = document.createElement('select');
    vsel.id = 'hs-settings-vibe-select';
    for (const id of Object.keys(VIBES) as VibeId[]) {
      const opt = document.createElement('option');
      opt.value = id;
      // Vibe display name flows through i18n at render time. Falls back to
      // the data file's English `displayName` if a key is missing — which
      // the parity meta-test prevents at CI.
      opt.textContent = t(`vibe.${id}.displayName` as DictKey);
      opt.dataset.vibeId = id;
      vsel.appendChild(opt);
    }
    vsel.value = deps.getCurrentVibeId();
    vsel.addEventListener('change', () => {
      const id = vsel.value as VibeId;
      deps.setVibe(id);
      // If no user override is active, the vibe just (re)installed its own
      // scale; mirror that into the dropdowns. If an override IS active,
      // MusicBrain keeps the override and getCurrentScale still reports it
      // — syncMusicRowFromBrain therefore leaves the dropdowns alone.
      this.syncMusicRowFromBrain();
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
    patchSec.appendChild(patchLbl);
    this.sectionLabelEls.set('Patches', patchLbl);

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
    nameInput.maxLength = 40;
    this.patchNameInputEl = nameInput;
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'hs-btn hs-btn-tiny hs-btn-primary';
    this.patchSaveBtn = saveBtn;
    saveBtn.addEventListener('click', () => {
      const raw = nameInput.value.trim();
      const name =
        raw.length > 0
          ? raw
          : `${t('panel.patch.untitledPrefix')} ${new Date().toLocaleTimeString()}`;
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
    this.patchResetVibeBtn = resetBtn;
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
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    btn.addEventListener('click', () => this.setVisible(!this.isVisible()));
    parent.appendChild(btn);
    this.toggleBtn = btn;

    // Keybinding.
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === TOGGLE_KEY && !this.isTypingTarget(e.target)) {
        this.setVisible(!this.isVisible());
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    // Apply persisted scale/key override AFTER the panel is fully built so
    // the dropdowns reflect the just-restored selection.
    this.applyPersistedMusicSettings();

    // Apply localized labels onto every node we just built, then subscribe
    // for future lang changes (lang switcher in HudControls fires this).
    this.applyLang();
    this.unsubLang = subscribeLang(() => this.applyLang());
  }

  /**
   * Re-apply localized strings to every static element of the panel: header,
   * subtitles, section labels, knob labels, factory chip tooltips, vibe
   * dropdown options + scale dropdown options + key dropdown labels +
   * patches section, and the toggle gear button. Knob values themselves
   * stay untouched; only labels flip.
   */
  applyLang(): void {
    if (this.titleEl) this.titleEl.textContent = t('panel.patch.title');
    if (this.subEl) this.subEl.textContent = t('panel.patch.subtitle');
    if (this.cardEl)
      this.cardEl.setAttribute('aria-label', t('panel.patch.dialogAria'));
    if (this.toggleBtn)
      this.toggleBtn.setAttribute('aria-label', t('panel.patch.toggleAria'));

    // Section labels.
    for (const [section, el] of this.sectionLabelEls) {
      if (section === 'Vibe') {
        el.textContent = t('panel.patch.section.vibe');
      } else if (section === 'Patches') {
        el.textContent = t('panel.patch.section.patches');
      } else {
        el.textContent = t(SECTION_KEY_BY_NAME[section]);
      }
    }

    // Knob labels.
    for (const def of KNOB_DEFS) {
      const k = this.knobs.get(def.id);
      k?.setLabel(t(def.labelKey));
    }

    // Factory preset chips: tooltip + aria-label.
    for (const { chip, preset } of this.presetChips) {
      const taglineKey = `factory.${preset.id}.tagline` as DictKey;
      const tagline = t(taglineKey);
      chip.title = tagline;
      chip.setAttribute(
        'aria-label',
        t('factory.applyAria', { name: preset.name, tagline }),
      );
    }

    // Vibe dropdown option text.
    if (this.vibeSelectEl) {
      for (const opt of Array.from(this.vibeSelectEl.options)) {
        const id = opt.dataset.vibeId;
        if (id) opt.textContent = t(`vibe.${id}.displayName` as DictKey);
      }
    }
    if (this.vibeFieldLabelEl)
      this.vibeFieldLabelEl.textContent = t('panel.patch.vibeLabel');

    // Scale dropdown option text.
    if (this.scaleSelectEl) {
      for (const opt of Array.from(this.scaleSelectEl.options)) {
        const id = opt.value;
        opt.textContent = t(`scale.${id}.displayName` as DictKey);
      }
    }

    // Music row labels.
    if (this.keyLabelEl) this.keyLabelEl.textContent = t('panel.patch.keyLabel');
    if (this.scaleLabelEl)
      this.scaleLabelEl.textContent = t('panel.patch.scaleLabel');
    if (this.keySelectEl)
      this.keySelectEl.setAttribute('aria-label', t('panel.patch.keyAria'));
    if (this.scaleSelectEl)
      this.scaleSelectEl.setAttribute('aria-label', t('panel.patch.scaleAria'));
    if (this.musicResetBtn) {
      this.musicResetBtn.title = t('panel.patch.resetTooltip');
      this.musicResetBtn.setAttribute('aria-label', t('panel.patch.resetAria'));
    }

    // Patch save / reset buttons + name input.
    if (this.patchSaveBtn) this.patchSaveBtn.textContent = t('panel.patch.saveBtn');
    if (this.patchResetVibeBtn)
      this.patchResetVibeBtn.textContent = t('panel.patch.resetVibeBtn');
    if (this.patchNameInputEl) {
      this.patchNameInputEl.placeholder = t('panel.patch.patchNamePlaceholder');
      this.patchNameInputEl.setAttribute(
        'aria-label',
        t('panel.patch.patchNameAria'),
      );
    }

    // Group aria-labels on the chip strip + music row.
    const presetGroup = this.cardEl?.querySelector('.hs-preset-row');
    presetGroup?.setAttribute('aria-label', t('panel.patch.factoryAria'));
    const musicGroup = this.cardEl?.querySelector('.hs-music-row');
    musicGroup?.setAttribute('aria-label', t('panel.patch.scaleKeyAria'));

    // SMART pill label + aria.
    if (this.smartPillEl) {
      this.smartPillEl.textContent = this.smartOn
        ? t('panel.patch.smartOn')
        : t('panel.patch.smartOff');
      this.smartPillEl.setAttribute('aria-label', t('panel.patch.smartAria'));
      this.smartPillEl.title = t('panel.patch.smartTooltip');
    }

    // Refresh the patch list so the empty state + Load/Del buttons follow
    // the new lang.
    this.refreshPatchList();
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
    for (const k of this.knobs.values()) k.destroy();
    this.knobs.clear();
    if (this.cardEl) this.cardEl.remove();
    if (this.toggleBtn) this.toggleBtn.remove();
    this.cardEl = null;
    this.titleEl = null;
    this.subEl = null;
    this.toggleBtn = null;
    this.patchListEl = null;
    this.vibeSelectEl = null;
    this.keySelectEl = null;
    this.scaleSelectEl = null;
    this.keyLabelEl = null;
    this.scaleLabelEl = null;
    this.musicResetBtn = null;
    this.vibeFieldLabelEl = null;
    this.patchSaveBtn = null;
    this.patchNameInputEl = null;
    this.patchResetVibeBtn = null;
    this.smartPillEl = null;
    this.sectionLabelEls.clear();
    this.presetChips = [];
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.deps = null;
  }

  /**
   * Build the KEY + SCALE + reset row. Each dropdown writes through to
   * MusicBrain (via deps.music) and persists to localStorage. The reset
   * button clears localStorage and tells the brain to re-derive from the
   * current vibe.
   */
  private buildMusicRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'hs-music-row';
    row.setAttribute('role', 'group');

    const keyLbl = document.createElement('label');
    keyLbl.className = 'hs-music-label';
    keyLbl.htmlFor = 'hs-music-key';
    this.keyLabelEl = keyLbl;

    const keySel = document.createElement('select');
    keySel.id = 'hs-music-key';
    keySel.className = 'hs-music-select';
    keySel.dataset.musicKey = '';
    for (const k of KEY_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = k.id;
      // Key display names are language-neutral note labels ("C", "C# / Db",
      // …) — no translation needed.
      opt.textContent = k.displayName;
      keySel.appendChild(opt);
    }
    keySel.addEventListener('change', () => {
      this.handleKeyChange(keySel.value);
    });
    this.keySelectEl = keySel;

    const scaleLbl = document.createElement('label');
    scaleLbl.className = 'hs-music-label';
    scaleLbl.htmlFor = 'hs-music-scale';
    this.scaleLabelEl = scaleLbl;

    const scaleSel = document.createElement('select');
    scaleSel.id = 'hs-music-scale';
    scaleSel.className = 'hs-music-select';
    scaleSel.dataset.musicScale = '';
    for (const s of SCALE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = t(`scale.${s.id}.displayName` as DictKey);
      scaleSel.appendChild(opt);
    }
    scaleSel.addEventListener('change', () => {
      this.handleModeChange(scaleSel.value);
    });
    this.scaleSelectEl = scaleSel;

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'hs-music-reset';
    resetBtn.textContent = '↺'; // counter-clockwise arrow
    this.musicResetBtn = resetBtn;
    resetBtn.addEventListener('click', () => this.handleScaleReset());

    // Seed the dropdowns with the current vibe's defaults; the actual
    // displayed selection is later overridden by applyPersistedMusicSettings
    // if a user preference is saved.
    this.syncMusicRowFromBrain();

    row.append(keyLbl, keySel, scaleLbl, scaleSel, resetBtn);
    return row;
  }

  /**
   * Reflect MusicBrain's current scale (or, if not yet started, the vibe
   * default) in the dropdowns. Called on mount and after `setVibe` so the
   * UI doesn't drift from the model.
   */
  private syncMusicRowFromBrain(): void {
    if (!this.keySelectEl || !this.scaleSelectEl || !this.deps) return;
    const current = this.deps.music.getCurrentScale?.();
    let tonic: string;
    let mode: string;
    if (current) {
      tonic = current.tonic;
      mode = current.mode;
    } else {
      const vibe = VIBES[this.deps.getCurrentVibeId()];
      tonic = vibe.scale.tonic;
      mode = vibe.scale.mode;
    }
    const keyId = normalizeKeyId(tonic);
    if (KEY_OPTION_IDS.has(keyId)) this.keySelectEl.value = keyId;
    if (SCALE_OPTION_IDS.has(mode)) this.scaleSelectEl.value = mode;
  }

  private applyPersistedMusicSettings(): void {
    if (!this.deps) return;
    const persisted = loadMusicSettings();
    if (!persisted) {
      // No override — dropdowns already match the vibe default from
      // syncMusicRowFromBrain().
      return;
    }
    if (this.keySelectEl) this.keySelectEl.value = persisted.key;
    if (this.scaleSelectEl) this.scaleSelectEl.value = persisted.mode;
    this.deps.music.setScale?.(persisted.key, persisted.mode);
  }

  private handleKeyChange(value: string): void {
    if (!this.deps) return;
    if (!KEY_OPTION_IDS.has(value)) return;
    const mode = this.scaleSelectEl?.value ?? 'major';
    this.deps.music.setKey?.(value);
    saveMusicSettings({ key: value, mode });
  }

  private handleModeChange(value: string): void {
    if (!this.deps) return;
    if (!SCALE_OPTION_IDS.has(value)) return;
    const key = this.keySelectEl?.value ?? 'C';
    this.deps.music.setMode?.(value);
    saveMusicSettings({ key, mode: value });
  }

  private handleScaleReset(): void {
    if (!this.deps) return;
    clearMusicSettings();
    const result = this.deps.music.clearScaleOverride?.();
    if (result) {
      if (this.keySelectEl) {
        const id = normalizeKeyId(result.tonic);
        if (KEY_OPTION_IDS.has(id)) this.keySelectEl.value = id;
      }
      if (this.scaleSelectEl && SCALE_OPTION_IDS.has(result.mode)) {
        this.scaleSelectEl.value = result.mode;
      }
    } else {
      // Fallback: pull from the active vibe directly.
      const vibe = VIBES[this.deps.getCurrentVibeId()];
      if (this.keySelectEl) {
        const id = normalizeKeyId(vibe.scale.tonic);
        if (KEY_OPTION_IDS.has(id)) this.keySelectEl.value = id;
      }
      if (this.scaleSelectEl && SCALE_OPTION_IDS.has(vibe.scale.mode)) {
        this.scaleSelectEl.value = vibe.scale.mode;
      }
    }
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
    // Voice timbre knobs — route to audio.setVoiceTimbre (the analog "WAVE"
    // morph axis). Guarded so test stubs without the impl method don't
    // crash.
    const voice = VOICE_KNOB_TO_VOICE[def.id];
    if (voice) {
      const audio = this.deps.audio as AudioEngineExtended;
      audio.setVoiceTimbre?.(voice, v);
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

    // Apply the voice-shape overlay (oscillator + envelope per engine).
    // Without this the FX chain changes but every preset keeps the vibe's
    // baseline oscillator — which is exactly the "i preset sembrano tutti
    // uguali" complaint that motivated this feature.
    if (preset.voice) {
      const audio = this.deps.audio as AudioEngineExtended;
      audio.applyVoiceShape?.(preset.voice);
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
      // Voice-timbre knobs: mirror from preset.voice.{pad,lead,bass}.timbre
      // — `preset.params` doesn't carry those.
      const voice = VOICE_KNOB_TO_VOICE[def.id];
      if (voice) {
        const tv = preset.voice?.[voice]?.timbre;
        if (typeof tv === 'number') {
          const k = this.knobs.get(def.id);
          k?.setValue(tv, false);
        }
        continue;
      }
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
      // Voice timbres are saved separately as `timbre` on the Patch object,
      // not as AudioEngineParams — skip them here.
      if (VOICE_KNOB_TO_VOICE[def.id]) continue;
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

  /**
   * Capture the three voice-timbre knob values into a Patch.timbre block.
   * Skips knobs that haven't been mounted (e.g. test stubs that mounted
   * a subset of the panel).
   */
  private currentTimbreSnapshot(): { pad?: number; lead?: number; bass?: number } {
    const out: { pad?: number; lead?: number; bass?: number } = {};
    for (const [knobId, voice] of Object.entries(VOICE_KNOB_TO_VOICE)) {
      if (!voice) continue;
      const k = this.knobs.get(knobId as KnobId);
      if (!k) continue;
      const dial = k.el.querySelector('.hs-knob-dial');
      const raw = dial?.getAttribute('aria-valuenow');
      if (raw === null || raw === undefined) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) out[voice] = n;
    }
    return out;
  }

  private handleSavePatch(name: string): void {
    if (!this.deps) return;
    const vibe = this.deps.getCurrentVibeId();
    const params = this.currentParamsSnapshot();
    const timbre = this.currentTimbreSnapshot();
    const patch: Patch = {
      id: makePatchId(),
      name,
      vibe,
      params,
      timbre: Object.keys(timbre).length > 0 ? timbre : undefined,
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
      // Voice-timbre knobs are restored from p.timbre separately below.
      if (VOICE_KNOB_TO_VOICE[def.id]) continue;
      const v = (p.params as Record<string, number | undefined>)[def.id];
      if (typeof v === 'number') {
        const k = this.knobs.get(def.id);
        k?.setValue(v, true);
      }
    }

    // Restore per-voice timbre knobs (analog "WAVE" trio). Patches saved
    // before this feature ship without `timbre` — leave the knobs at their
    // current value in that case.
    if (p.timbre) {
      if (typeof p.timbre.pad === 'number')
        this.knobs.get('padTimbre')?.setValue(p.timbre.pad, true);
      if (typeof p.timbre.lead === 'number')
        this.knobs.get('leadTimbre')?.setValue(p.timbre.lead, true);
      if (typeof p.timbre.bass === 'number')
        this.knobs.get('bassTimbre')?.setValue(p.timbre.bass, true);
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
      empty.textContent = t('panel.patch.patchesEmpty');
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
      loadBtn.textContent = t('panel.patch.loadBtn');
      loadBtn.addEventListener('click', () => this.loadPatch(p));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'hs-btn hs-btn-tiny hs-btn-danger';
      delBtn.textContent = t('panel.patch.delBtn');
      delBtn.addEventListener('click', () => {
        deletePatch(p.id);
        this.refreshPatchList();
      });
      row.append(name, loadBtn, delBtn);
      list.appendChild(row);
    }
  }

  /**
   * Flip the SMART pill. Writes the new state into the audio engine via
   * setParams({ smartVoicing }) — the engine is the source of truth, the
   * pill's visual mirror updates afterwards.
   */
  private toggleSmartVoicing(): void {
    if (!this.deps) return;
    this.smartOn = !this.smartOn;
    this.deps.audio.setParams({ smartVoicing: this.smartOn } as Partial<AudioEngineParams>);
    if (this.smartPillEl) {
      this.smartPillEl.setAttribute('aria-pressed', String(this.smartOn));
      this.smartPillEl.classList.toggle('hs-smart-pill-on', this.smartOn);
      // Refresh label to follow the on/off state.
      this.smartPillEl.textContent = this.smartOn ? t('panel.patch.smartOn') : t('panel.patch.smartOff');
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
