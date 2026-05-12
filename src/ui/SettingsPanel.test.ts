// Owner: ux-curator
//
// Smoke tests for SettingsPanelImpl + the Knob component + the patches
// helper. happy-dom is enough — we only assert DOM wiring, basic interactions,
// and localStorage persistence.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsPanelImpl, type SettingsPanelDeps } from './SettingsPanel';
import { Knob } from './Knob';
import {
  loadPatches,
  savePatch,
  deletePatch,
  makePatchId,
} from './patches';
import { FACTORY_PRESETS } from '@presets/factory-presets';
import type { AudioEngine, MusicBrain, AudioEngineParams, VibeId } from '@contracts/contracts';
import { setLang, __resetForTests } from '../i18n';

function stubAudio(): AudioEngine & {
  lastSet: Partial<AudioEngineParams>;
  applyVoiceShape: ReturnType<typeof vi.fn>;
  setVoiceTimbre: ReturnType<typeof vi.fn>;
  getVoiceTimbre: ReturnType<typeof vi.fn>;
  getSmartVoicing: ReturnType<typeof vi.fn>;
  setVoiceWaveform: ReturnType<typeof vi.fn>;
  getVoiceWaveform: ReturnType<typeof vi.fn>;
} {
  const lastSet: Partial<AudioEngineParams> = {};
  const timbres: Record<string, number> = { pad: 0.5, lead: 0.5, bass: 0.5 };
  const waveforms: Record<string, string | null> = { pad: null, lead: null, bass: null };
  let smartOn = true;
  return {
    lastSet,
    init: vi.fn().mockResolvedValue(undefined),
    loadVibe: vi.fn(),
    triggerLead: vi.fn(),
    triggerBass: vi.fn(),
    triggerChord: vi.fn(),
    triggerKick: vi.fn(),
    triggerHat: vi.fn(),
    triggerPerc: vi.fn(),
    triggerStab: vi.fn(),
    setParams: vi.fn((p: Partial<AudioEngineParams>) => {
      Object.assign(lastSet, p);
      if (typeof p.smartVoicing === 'boolean') smartOn = p.smartVoicing;
    }),
    setMute: vi.fn(),
    triggerDrop: vi.fn(),
    getAnalyser: vi.fn(() => ({} as unknown as AnalyserNode)),
    isReady: () => true,
    // Impl-only methods that SettingsPanel calls — not on the AudioEngine
    // contract interface. Each is a vi.fn so the wiring tests can assert.
    applyVoiceShape: vi.fn(),
    setVoiceTimbre: vi.fn((voice: string, v: number) => {
      timbres[voice] = v;
    }),
    getVoiceTimbre: vi.fn((voice: string) => timbres[voice] ?? 0.5),
    getSmartVoicing: vi.fn(() => smartOn),
    setVoiceWaveform: vi.fn((voice: string, w: string) => {
      waveforms[voice] = w;
    }),
    getVoiceWaveform: vi.fn((voice: string) => waveforms[voice] ?? null),
  } as AudioEngine & {
    lastSet: Partial<AudioEngineParams>;
    applyVoiceShape: ReturnType<typeof vi.fn>;
    setVoiceTimbre: ReturnType<typeof vi.fn>;
    getVoiceTimbre: ReturnType<typeof vi.fn>;
    getSmartVoicing: ReturnType<typeof vi.fn>;
    setVoiceWaveform: ReturnType<typeof vi.fn>;
    getVoiceWaveform: ReturnType<typeof vi.fn>;
  };
}

interface MusicStub extends MusicBrain {
  setKey: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
  setScale: ReturnType<typeof vi.fn>;
  clearScaleOverride: ReturnType<typeof vi.fn>;
  getCurrentScale: ReturnType<typeof vi.fn>;
  /** Test helper: mutate what getCurrentScale returns next. */
  __scale: { tonic: string; mode: string } | null;
}

function stubMusic(initial: { tonic: string; mode: string } | null = { tonic: 'F#', mode: 'lydian' }): MusicStub {
  const stub = {
    start: vi.fn(),
    stop: vi.fn(),
    setInput: vi.fn(),
    advanceChord: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setKey: vi.fn(),
    setMode: vi.fn(),
    setScale: vi.fn(),
    clearScaleOverride: vi.fn(),
    getCurrentScale: vi.fn(),
    __scale: initial,
  } as unknown as MusicStub;
  stub.getCurrentScale.mockImplementation(() => stub.__scale);
  stub.clearScaleOverride.mockImplementation(() => {
    stub.__scale = { tonic: 'F#', mode: 'lydian' };
    return stub.__scale;
  });
  stub.setKey.mockImplementation((tonic: string) => {
    if (stub.__scale) stub.__scale = { ...stub.__scale, tonic };
  });
  stub.setMode.mockImplementation((mode: string) => {
    if (stub.__scale) stub.__scale = { ...stub.__scale, mode };
  });
  stub.setScale.mockImplementation((tonic: string, mode: string) => {
    stub.__scale = { tonic, mode };
  });
  return stub;
}

function makeDeps(): SettingsPanelDeps & {
  audio: ReturnType<typeof stubAudio>;
  music: MusicStub;
  setVibe: ReturnType<typeof vi.fn>;
  setManualIntensity: ReturnType<typeof vi.fn>;
} {
  const audio = stubAudio();
  return {
    audio,
    music: stubMusic(),
    setVibe: vi.fn(),
    setManualIntensity: vi.fn(),
    getCurrentVibeId: () => 'tycho' as VibeId,
    getCurrentParams: () => ({ bpm: 92 }),
  };
}

describe('Knob', () => {
  it('renders with label, value, and a11y attributes', () => {
    const onChange = vi.fn();
    const k = new Knob({
      label: 'Cutoff',
      min: 100,
      max: 1000,
      step: 1,
      value: 500,
      defaultValue: 500,
      onChange,
    });
    document.body.appendChild(k.el);
    const dial = k.el.querySelector('.hs-knob-dial') as HTMLElement;
    expect(dial.getAttribute('role')).toBe('slider');
    expect(dial.getAttribute('aria-valuemin')).toBe('100');
    expect(dial.getAttribute('aria-valuemax')).toBe('1000');
    expect(dial.getAttribute('aria-valuenow')).toBe('500');
    k.destroy();
  });

  it('arrow keys step the value and fire onChange', () => {
    const onChange = vi.fn();
    const k = new Knob({
      label: 'Q',
      min: 0,
      max: 10,
      step: 1,
      value: 5,
      defaultValue: 5,
      onChange,
    });
    document.body.appendChild(k.el);
    const dial = k.el.querySelector('.hs-knob-dial') as HTMLElement;
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(6);
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(5);
    k.destroy();
  });

  it('clamps to min / max and snaps to step', () => {
    const onChange = vi.fn();
    const k = new Knob({
      label: 'X',
      min: 0,
      max: 10,
      step: 1,
      value: 0,
      defaultValue: 0,
      onChange,
    });
    k.setValue(-5);
    const dial = k.el.querySelector('.hs-knob-dial') as HTMLElement;
    expect(dial.getAttribute('aria-valuenow')).toBe('0');
    k.setValue(99);
    expect(dial.getAttribute('aria-valuenow')).toBe('10');
    k.setValue(3.7);
    expect(dial.getAttribute('aria-valuenow')).toBe('4');
    k.destroy();
  });

  it('double-click resets to defaultValue', () => {
    const onChange = vi.fn();
    const k = new Knob({
      label: 'X',
      min: 0,
      max: 10,
      step: 1,
      value: 7,
      defaultValue: 3,
      onChange,
    });
    document.body.appendChild(k.el);
    const dial = k.el.querySelector('.hs-knob-dial') as HTMLElement;
    dial.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(3);
    k.destroy();
  });
});

describe('patches helper', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('round-trips save / load / delete', () => {
    expect(loadPatches()).toEqual([]);
    const id = makePatchId();
    savePatch({
      id,
      name: 'Test',
      vibe: 'tycho',
      params: { reverbWet: 0.7 },
      bpm: 100,
      createdAt: 1,
    });
    const after = loadPatches();
    expect(after.length).toBe(1);
    expect(after[0]?.name).toBe('Test');
    expect(after[0]?.params.reverbWet).toBe(0.7);
    deletePatch(id);
    expect(loadPatches()).toEqual([]);
  });

  it('drops payloads with mismatching schema versions', () => {
    localStorage.setItem(
      'handsynth.patches',
      JSON.stringify({ version: 9999, patches: [{ id: 'x', name: 'Old', vibe: 'tycho', params: {}, bpm: 90, createdAt: 0 }] }),
    );
    expect(loadPatches()).toEqual([]);
  });
});

describe('SettingsPanelImpl', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });
  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });

  it('mounts knobs, gear button, and patch list', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    expect(parent.querySelectorAll('.hs-knob').length).toBeGreaterThanOrEqual(8);
    expect(parent.querySelector('.hs-settings-toggle')).not.toBeNull();
    expect(parent.querySelector('.hs-patches-empty')).not.toBeNull();
    panel.unmount();
  });

  it('mount is idempotent', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    panel.mount(parent, makeDeps());
    expect(parent.querySelectorAll('.hs-settings-card').length).toBe(1);
    expect(parent.querySelectorAll('.hs-settings-toggle').length).toBe(1);
    panel.unmount();
  });

  it('unmount removes all DOM and listeners', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    panel.unmount();
    expect(parent.querySelector('.hs-settings-card')).toBeNull();
    expect(parent.querySelector('.hs-settings-toggle')).toBeNull();
    // Second unmount is a no-op.
    panel.unmount();
  });

  it('toggle button flips visibility', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    expect(panel.isVisible()).toBe(false);
    const btn = parent.querySelector('.hs-settings-toggle') as HTMLButtonElement;
    btn.click();
    expect(panel.isVisible()).toBe(true);
    btn.click();
    // It animates closed; isVisible returns false when collapsed class is set.
    expect(panel.isVisible()).toBe(false);
    panel.unmount();
  });

  it('changing the vibe dropdown calls deps.setVibe', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const sel = parent.querySelector(
      '#hs-settings-vibe-select',
    ) as HTMLSelectElement;
    expect(sel).not.toBeNull();
    sel.value = 'bonobo';
    sel.dispatchEvent(new Event('change'));
    expect(deps.setVibe).toHaveBeenCalledWith('bonobo');
    panel.unmount();
  });

  it('saving a patch persists to localStorage and shows a row', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const input = parent.querySelector('.hs-prompt input') as HTMLInputElement;
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    input.value = 'My patch';
    saveBtn.click();
    const stored = loadPatches();
    expect(stored.length).toBe(1);
    expect(stored[0]?.name).toBe('My patch');
    // Row appears.
    const rows = parent.querySelectorAll('.hs-patches-row');
    expect(rows.length).toBe(1);
    panel.unmount();
  });

  it('deleting a patch removes it from storage and the list', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const input = parent.querySelector('.hs-prompt input') as HTMLInputElement;
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    input.value = 'p1';
    saveBtn.click();
    const delBtn = parent.querySelector('.hs-patches-row .hs-btn-danger') as HTMLButtonElement;
    delBtn.click();
    expect(loadPatches()).toEqual([]);
    expect(parent.querySelector('.hs-patches-row')).toBeNull();
    panel.unmount();
  });

  it('renders one factory preset chip per FACTORY_PRESETS entry', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const chips = parent.querySelectorAll('.hs-preset-chip');
    expect(chips.length).toBe(FACTORY_PRESETS.length);
    const names = Array.from(chips).map((c) => (c.textContent ?? '').trim());
    expect(names).toEqual(FACTORY_PRESETS.map((p) => p.name));
    panel.unmount();
  });

  it('clicking a factory preset chip pushes its params via audio.setParams', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    // Pick a non-INIT preset with a strong identity (DUB) so we can assert on
    // identifying knob values.
    const dub = FACTORY_PRESETS.find((p) => p.id === 'dub')!;
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="dub"]`,
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();
    chip.click();
    expect(deps.audio.setParams).toHaveBeenCalled();
    // Last call should not contain bpm (filtered out before forwarding).
    const setParamsMock = vi.mocked(deps.audio.setParams);
    const lastCall = setParamsMock.mock.calls.at(-1)?.[0] as
      | (Partial<AudioEngineParams> & { bpm?: unknown })
      | undefined;
    expect(lastCall).toBeDefined();
    expect((lastCall as { bpm?: unknown }).bpm).toBeUndefined();
    expect(lastCall?.delayFeedback).toBe(dub.params.delayFeedback);
    expect(lastCall?.reverbWet).toBe(dub.params.reverbWet);
    panel.unmount();
  });

  it('clicking a factory preset chip updates each knob to the preset value', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const acid = FACTORY_PRESETS.find((p) => p.id === 'acid')!;
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="acid"]`,
    ) as HTMLButtonElement;
    chip.click();
    // Map knob aria labels back to ids via the KNOB_DEFS labels we know about.
    const dials = parent.querySelectorAll('.hs-knob-dial');
    const byLabel = new Map<string, Element>();
    for (const d of Array.from(dials)) {
      byLabel.set(d.getAttribute('aria-label') ?? '', d);
    }
    // Cutoff is logarithmic + snapped to step 1 so it round-trips exactly.
    const cutoff = byLabel.get('Cutoff');
    expect(cutoff?.getAttribute('aria-valuenow')).toBe(String(acid.params.filterCutoff));
    const q = byLabel.get('Q');
    expect(q?.getAttribute('aria-valuenow')).toBe(String(acid.params.filterResonance));
    // Brightness uses step 0.01 — snap arithmetic produces float drift, so
    // assert numerically-close rather than string-equal.
    const bright = byLabel.get('Bright');
    expect(Number(bright?.getAttribute('aria-valuenow'))).toBeCloseTo(
      acid.params.brightness as number,
      6,
    );
    panel.unmount();
  });

  it('a factory preset without a bpm leaves bpm-knob untouched', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const bpmDial = Array.from(parent.querySelectorAll('.hs-knob-dial')).find(
      (d) => d.getAttribute('aria-label') === 'BPM',
    );
    const before = bpmDial?.getAttribute('aria-valuenow');
    // INIT is the only preset without a bpm field (it's the neutral
    // reset). All flavour presets ship their own tempo character as of
    // the differentiation pass.
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="init"]`,
    ) as HTMLButtonElement;
    chip.click();
    expect(bpmDial?.getAttribute('aria-valuenow')).toBe(before);
    panel.unmount();
  });

  it('clicking a preset with a voice-shape calls audio.applyVoiceShape with it', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const lush = FACTORY_PRESETS.find((p) => p.id === 'lush')!;
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="lush"]`,
    ) as HTMLButtonElement;
    chip.click();
    expect(deps.audio.applyVoiceShape).toHaveBeenCalledWith(lush.voice);
    panel.unmount();
  });

  it('clicking the INIT preset (no voice) does NOT call applyVoiceShape', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="init"]`,
    ) as HTMLButtonElement;
    chip.click();
    expect(deps.audio.applyVoiceShape).not.toHaveBeenCalled();
    panel.unmount();
  });

  it('renders three voice morph knobs (Pad Morph / Lead Morph / Bass Morph)', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const dials = parent.querySelectorAll('.hs-knob-dial');
    const labels = Array.from(dials).map((d) => d.getAttribute('aria-label'));
    expect(labels).toContain('Pad Morph');
    expect(labels).toContain('Lead Morph');
    expect(labels).toContain('Bass Morph');
    panel.unmount();
  });

  it('changing a voice-morph knob calls audio.setVoiceTimbre', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const padDial = Array.from(parent.querySelectorAll('.hs-knob-dial')).find(
      (d) => d.getAttribute('aria-label') === 'Pad Morph',
    ) as HTMLElement;
    expect(padDial).toBeDefined();
    padDial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(deps.audio.setVoiceTimbre).toHaveBeenCalledWith('pad', expect.any(Number));
    panel.unmount();
  });

  it('clicking a preset with voice.timbre updates each morph knob', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    // SPACE has heavy timbre toward B for pad/lead.
    const space = FACTORY_PRESETS.find((p) => p.id === 'space')!;
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="space"]`,
    ) as HTMLButtonElement;
    chip.click();
    const padDial = Array.from(parent.querySelectorAll('.hs-knob-dial')).find(
      (d) => d.getAttribute('aria-label') === 'Pad Morph',
    );
    const expected = space.voice?.pad?.timbre;
    expect(typeof expected).toBe('number');
    expect(Number(padDial?.getAttribute('aria-valuenow'))).toBeCloseTo(
      expected as number,
      6,
    );
    panel.unmount();
  });

  it('renders one waveform dropdown per voice with the curated option list', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const padSel = parent.querySelector('select[data-voice-wave="pad"]') as HTMLSelectElement;
    const leadSel = parent.querySelector('select[data-voice-wave="lead"]') as HTMLSelectElement;
    const bassSel = parent.querySelector('select[data-voice-wave="bass"]') as HTMLSelectElement;
    expect(padSel).not.toBeNull();
    expect(leadSel).not.toBeNull();
    expect(bassSel).not.toBeNull();
    // 13 curated waveform options (sine/triangle/sawtooth/square/pulse/
    // fatsine/fattriangle/fatsawtooth/fatsquare/fmsine/fmsawtooth/amsine/
    // amsawtooth) — the dropdown is scannable, not "every OmniOscillator
    // literal ever". See src/presets/waveform-options.ts.
    expect(padSel.options.length).toBe(13);
    expect(leadSel.options.length).toBe(13);
    expect(bassSel.options.length).toBe(13);
    panel.unmount();
  });

  it('changing a waveform dropdown calls audio.setVoiceWaveform with the picked id', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const padSel = parent.querySelector('select[data-voice-wave="pad"]') as HTMLSelectElement;
    padSel.value = 'fmsine';
    padSel.dispatchEvent(new Event('change'));
    expect(deps.audio.setVoiceWaveform).toHaveBeenCalledWith('pad', 'fmsine');
    panel.unmount();
  });

  it('clicking a factory preset with a waveform updates the dropdown value', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    // ACID's pad is fatsquare per factory-presets.ts.
    const acid = FACTORY_PRESETS.find((p) => p.id === 'acid')!;
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="acid"]`,
    ) as HTMLButtonElement;
    chip.click();
    const padSel = parent.querySelector('select[data-voice-wave="pad"]') as HTMLSelectElement;
    expect(padSel.value).toBe(acid.voice?.pad?.waveform);
    const bassSel = parent.querySelector('select[data-voice-wave="bass"]') as HTMLSelectElement;
    expect(bassSel.value).toBe(acid.voice?.bass?.waveform);
    panel.unmount();
  });

  it('saved patches round-trip per-voice waveform values', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const padSel = parent.querySelector('select[data-voice-wave="pad"]') as HTMLSelectElement;
    padSel.value = 'fattriangle';
    padSel.dispatchEvent(new Event('change'));
    const nameInput = parent.querySelector('.hs-prompt input') as HTMLInputElement;
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    nameInput.value = 'WithWaveform';
    saveBtn.click();
    const stored = loadPatches();
    expect(stored[0]?.waveform?.pad).toBe('fattriangle');
    panel.unmount();
  });

  it('loading a saved patch restores the waveform dropdown and calls setVoiceWaveform', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    savePatch({
      id: 'p_test',
      name: 'WithWave',
      vibe: 'tycho',
      params: {},
      waveform: { pad: 'amsine' },
      bpm: 92,
      createdAt: 0,
    });
    // Trigger refresh + load via the rendered Load button.
    panel.unmount();
    panel.mount(parent, deps);
    const loadBtn = parent.querySelector('.hs-patches-row .hs-btn') as HTMLButtonElement;
    loadBtn.click();
    const padSel = parent.querySelector('select[data-voice-wave="pad"]') as HTMLSelectElement;
    expect(padSel.value).toBe('amsine');
    expect(deps.audio.setVoiceWaveform).toHaveBeenCalledWith('pad', 'amsine');
    panel.unmount();
  });

  it('SMART pill is present, ON by default, and toggles via click', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const pill = parent.querySelector('[data-smart-pill]') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    pill.click();
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    // The toggle pushes smartVoicing into the engine.
    expect(deps.audio.setParams).toHaveBeenCalledWith(
      expect.objectContaining({ smartVoicing: false }),
    );
    pill.click();
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(deps.audio.setParams).toHaveBeenLastCalledWith(
      expect.objectContaining({ smartVoicing: true }),
    );
    panel.unmount();
  });

  it('saved patches round-trip per-voice morph values', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    // Bump the Pad Morph knob a few ticks from default.
    const padDial = Array.from(parent.querySelectorAll('.hs-knob-dial')).find(
      (d) => d.getAttribute('aria-label') === 'Pad Morph',
    ) as HTMLElement;
    padDial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const newVal = Number(padDial.getAttribute('aria-valuenow'));
    const nameInput = parent.querySelector('.hs-prompt input') as HTMLInputElement;
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    nameInput.value = 'WithTimbre';
    saveBtn.click();
    const stored = loadPatches();
    expect(stored[0]?.timbre?.pad).toBeCloseTo(newVal, 6);
    panel.unmount();
  });

  it('reset to vibe defaults pushes audio params', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    // Use the patches-section "Reset to vibe" button (text-content based) —
    // we deliberately avoid the small ↺ music-row reset button which is
    // tested separately below.
    const resetBtn = Array.from(parent.querySelectorAll('button')).find(
      (b) => /reset to vibe$/i.test((b.textContent ?? '').trim()),
    ) as HTMLButtonElement;
    expect(resetBtn).toBeDefined();
    resetBtn.click();
    expect(deps.audio.setParams).toHaveBeenCalled();
    panel.unmount();
  });
});

// ---------------------------------------------------------------------------
// Scale + Key dropdowns
// ---------------------------------------------------------------------------

describe('SettingsPanelImpl — scale / key controls', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });
  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });

  it('renders KEY and SCALE dropdowns plus a reset button', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const row = parent.querySelector('.hs-music-row');
    expect(row).not.toBeNull();
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    const scaleSel = parent.querySelector('select[data-music-scale]') as HTMLSelectElement;
    const resetBtn = parent.querySelector('.hs-music-reset') as HTMLButtonElement;
    expect(keySel).not.toBeNull();
    expect(scaleSel).not.toBeNull();
    expect(resetBtn).not.toBeNull();
    expect(keySel.options.length).toBe(12);
    expect(scaleSel.options.length).toBe(13);
    panel.unmount();
  });

  it('initial selection mirrors the brain\'s current scale (vibe default)', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    const scaleSel = parent.querySelector('select[data-music-scale]') as HTMLSelectElement;
    expect(keySel.value).toBe('F#');
    expect(scaleSel.value).toBe('lydian');
    panel.unmount();
  });

  it('changing the key dropdown calls music.setKey and persists', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    keySel.value = 'A';
    keySel.dispatchEvent(new Event('change'));
    expect(deps.music.setKey).toHaveBeenCalledWith('A');
    const stored = JSON.parse(localStorage.getItem('hs.musicSettings') ?? 'null');
    expect(stored).toEqual({ key: 'A', mode: 'lydian' });
    panel.unmount();
  });

  it('changing the scale dropdown calls music.setMode and persists', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const scaleSel = parent.querySelector('select[data-music-scale]') as HTMLSelectElement;
    scaleSel.value = 'minor';
    scaleSel.dispatchEvent(new Event('change'));
    expect(deps.music.setMode).toHaveBeenCalledWith('minor');
    const stored = JSON.parse(localStorage.getItem('hs.musicSettings') ?? 'null');
    expect(stored).toEqual({ key: 'F#', mode: 'minor' });
    panel.unmount();
  });

  it('rejects an invalid value silently (does not call setKey)', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    // Force an invalid option past the typical UI guard.
    keySel.value = 'C';
    deps.music.setKey.mockClear();
    // Manually invoke change with a bogus value by constructing a new option.
    const bogus = document.createElement('option');
    bogus.value = 'XYZ';
    bogus.textContent = 'XYZ';
    keySel.appendChild(bogus);
    keySel.value = 'XYZ';
    keySel.dispatchEvent(new Event('change'));
    expect(deps.music.setKey).not.toHaveBeenCalled();
    panel.unmount();
  });

  it('mounting reads localStorage and applies it via music.setScale', () => {
    localStorage.setItem('hs.musicSettings', JSON.stringify({ key: 'A', mode: 'phrygian' }));
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    expect(deps.music.setScale).toHaveBeenCalledWith('A', 'phrygian');
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    const scaleSel = parent.querySelector('select[data-music-scale]') as HTMLSelectElement;
    expect(keySel.value).toBe('A');
    expect(scaleSel.value).toBe('phrygian');
    panel.unmount();
  });

  it('reset button clears localStorage and calls clearScaleOverride', () => {
    localStorage.setItem('hs.musicSettings', JSON.stringify({ key: 'A', mode: 'phrygian' }));
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    const resetBtn = parent.querySelector('.hs-music-reset') as HTMLButtonElement;
    resetBtn.click();
    expect(deps.music.clearScaleOverride).toHaveBeenCalled();
    expect(localStorage.getItem('hs.musicSettings')).toBeNull();
    // Dropdowns reflect the vibe default (the stub returns F# lydian).
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    const scaleSel = parent.querySelector('select[data-music-scale]') as HTMLSelectElement;
    expect(keySel.value).toBe('F#');
    expect(scaleSel.value).toBe('lydian');
    panel.unmount();
  });

  it('ignores corrupted localStorage payloads', () => {
    localStorage.setItem('hs.musicSettings', '{"not":"valid"}');
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    expect(deps.music.setScale).not.toHaveBeenCalled();
    panel.unmount();
  });

  it('ignores localStorage entries with unknown ids', () => {
    localStorage.setItem(
      'hs.musicSettings',
      JSON.stringify({ key: 'XYZ', mode: 'galactic' }),
    );
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    expect(deps.music.setScale).not.toHaveBeenCalled();
    panel.unmount();
  });

  it('seeds dropdowns from a flat-tonic vibe via normalizeKeyId', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    // Override the stub: vibe-equivalent state with a flat tonic.
    deps.music.__scale = { tonic: 'Bb', mode: 'dorian' };
    panel.mount(parent, deps);
    const keySel = parent.querySelector('select[data-music-key]') as HTMLSelectElement;
    expect(keySel.value).toBe('A#'); // Bb canonicalized to A#
    panel.unmount();
  });
});

// ---------------------------------------------------------------------------
// i18n integration
// ---------------------------------------------------------------------------

describe('SettingsPanelImpl — i18n', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });
  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
    __resetForTests('en');
  });

  it('renders English header and labels by default', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const title = parent.querySelector('.hs-settings-title') as HTMLElement;
    expect(title.textContent).toBe('PATCH');
    const sub = parent.querySelector('.hs-settings-sub') as HTMLElement;
    expect(sub.textContent).toMatch(/MUTE/);
    panel.unmount();
  });

  it('renders Italian header and labels after setLang("it")', () => {
    setLang('it');
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const sub = parent.querySelector('.hs-settings-sub') as HTMLElement;
    expect(sub.textContent).toMatch(/MUTO/);
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    expect(saveBtn.textContent).toBe('Salva');
    const empty = parent.querySelector('.hs-patches-empty') as HTMLElement;
    expect(empty.textContent).toBe('Nessuna patch salvata.');
    panel.unmount();
  });

  it('flips header / save button / empty state when lang switches mid-life', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const saveBtn = parent.querySelector('.hs-prompt button') as HTMLButtonElement;
    expect(saveBtn.textContent).toBe('Save');
    setLang('it');
    expect(saveBtn.textContent).toBe('Salva');
    setLang('en');
    expect(saveBtn.textContent).toBe('Save');
    panel.unmount();
  });

  it('translates scale dropdown options', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const scaleSel = parent.querySelector(
      'select[data-music-scale]',
    ) as HTMLSelectElement;
    const major = Array.from(scaleSel.options).find((o) => o.value === 'major');
    expect(major?.textContent).toBe('Major (Ionian)');
    setLang('it');
    expect(major?.textContent).toBe('Maggiore (Ionica)');
    panel.unmount();
  });

  it('translates vibe dropdown options', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const vibeSel = parent.querySelector(
      '#hs-settings-vibe-select',
    ) as HTMLSelectElement;
    const tycho = Array.from(vibeSel.options).find((o) => o.value === 'tycho');
    expect(tycho?.textContent).toMatch(/sunset drift/);
    setLang('it');
    expect(tycho?.textContent).toMatch(/deriva al tramonto/);
    panel.unmount();
  });

  it('translates the factory chip tooltip on lang switch', () => {
    const panel = new SettingsPanelImpl();
    panel.mount(parent, makeDeps());
    const dub = parent.querySelector(
      '.hs-preset-chip[data-preset-id="dub"]',
    ) as HTMLButtonElement;
    expect(dub.title).toContain('Echo chamber');
    setLang('it');
    expect(dub.title).toMatch(/Camera/);
    panel.unmount();
  });
});
