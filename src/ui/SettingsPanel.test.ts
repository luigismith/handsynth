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

function stubAudio(): AudioEngine & {
  lastSet: Partial<AudioEngineParams>;
  applyVoiceShape: ReturnType<typeof vi.fn>;
} {
  const lastSet: Partial<AudioEngineParams> = {};
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
    }),
    setMute: vi.fn(),
    triggerDrop: vi.fn(),
    getAnalyser: vi.fn(() => ({} as unknown as AnalyserNode)),
    isReady: () => true,
    // Not part of the contract interface (impl-only), but SettingsPanel
    // calls it post-setParams. We expose a vi.fn so the wiring test can
    // assert it was invoked with the preset's voice.
    applyVoiceShape: vi.fn(),
  } as AudioEngine & {
    lastSet: Partial<AudioEngineParams>;
    applyVoiceShape: ReturnType<typeof vi.fn>;
  };
}

function stubMusic(): MusicBrain {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    setInput: vi.fn(),
    advanceChord: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeDeps(): SettingsPanelDeps & {
  audio: ReturnType<typeof stubAudio>;
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
  });
  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
    localStorage.clear();
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
    const sel = parent.querySelector('select') as HTMLSelectElement;
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
    // ACID has no bpm field.
    const chip = parent.querySelector(
      `.hs-preset-chip[data-preset-id="acid"]`,
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

  it('reset to vibe defaults pushes audio params', () => {
    const panel = new SettingsPanelImpl();
    const deps = makeDeps();
    panel.mount(parent, deps);
    // Find the "Reset to vibe" button.
    const resetBtn = Array.from(parent.querySelectorAll('button')).find(
      (b) => /reset/i.test(b.textContent ?? ''),
    ) as HTMLButtonElement;
    resetBtn.click();
    expect(deps.audio.setParams).toHaveBeenCalled();
    panel.unmount();
  });
});
