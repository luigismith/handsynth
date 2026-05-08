// Owner: ux-curator
//
// Smoke tests for HudControlsImpl — focuses on the new i18n-aware behaviour:
// 4 buttons (STOP / TERMINAL / HELP / LANG), tooltips that flip on lang
// change, and the LANG button toggling getLang() through the i18n module.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HudControlsImpl } from './HudControls';
import { getLang, setLang, __resetForTests } from '../i18n';
import type { AudioEngine } from '@contracts/contracts';

function makeAudio(): AudioEngine {
  return {
    init: vi.fn(),
    loadVibe: vi.fn(),
    triggerLead: vi.fn(),
    triggerBass: vi.fn(),
    triggerChord: vi.fn(),
    triggerKick: vi.fn(),
    triggerHat: vi.fn(),
    triggerPerc: vi.fn(),
    triggerStab: vi.fn(),
    setParams: vi.fn(),
    setMute: vi.fn(),
    triggerDrop: vi.fn(),
    getAnalyser: vi.fn(() => ({}) as unknown as AnalyserNode),
    isReady: () => true,
  } as unknown as AudioEngine;
}

describe('HudControlsImpl', () => {
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

  it('mounts four buttons (STOP, TERMINAL, HELP, LANG)', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    const buttons = parent.querySelectorAll('.hs-hud-btn');
    expect(buttons.length).toBe(4);
    expect(parent.querySelector('.hs-hud-stop')).not.toBeNull();
    expect(parent.querySelector('.hs-hud-terminal')).not.toBeNull();
    expect(parent.querySelector('.hs-hud-help')).not.toBeNull();
    expect(parent.querySelector('.hs-hud-lang')).not.toBeNull();
    hud.unmount();
  });

  it('LANG button shows the OTHER language code as its label', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    const langBtn = parent.querySelector('.hs-hud-lang') as HTMLButtonElement;
    // We are in en — button reads "IT" (i.e. click to switch to IT).
    expect(langBtn.textContent).toBe('IT');
    setLang('it');
    expect(langBtn.textContent).toBe('EN');
    hud.unmount();
  });

  it('clicking the LANG button toggles getLang()', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    expect(getLang()).toBe('en');
    const langBtn = parent.querySelector('.hs-hud-lang') as HTMLButtonElement;
    langBtn.click();
    expect(getLang()).toBe('it');
    langBtn.click();
    expect(getLang()).toBe('en');
    hud.unmount();
  });

  it('button tooltips flip when the language changes', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    const stop = parent.querySelector('.hs-hud-stop') as HTMLButtonElement;
    const term = parent.querySelector('.hs-hud-terminal') as HTMLButtonElement;
    const help = parent.querySelector('.hs-hud-help') as HTMLButtonElement;
    expect(stop.title).toBe('Mute audio (Escape)');
    expect(term.title).toBe('Toggle terminal (T)');
    expect(help.title).toBe('Help / manual (H or F1)');
    setLang('it');
    expect(stop.title).toBe('Silenzia audio (Esc)');
    expect(term.title).toBe('Apri/chiudi terminale (T)');
    expect(help.title).toBe('Aiuto / manuale (H o F1)');
    hud.unmount();
  });

  it('STOP button toggles mute state via deps.audio.setMute', () => {
    const audio = makeAudio();
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio,
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    const stop = parent.querySelector('.hs-hud-stop') as HTMLButtonElement;
    stop.click();
    expect(audio.setMute).toHaveBeenLastCalledWith(true);
    stop.click();
    expect(audio.setMute).toHaveBeenLastCalledWith(false);
    hud.unmount();
  });

  it('mount is idempotent', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    expect(parent.querySelectorAll('.hs-hud').length).toBe(1);
    hud.unmount();
  });

  it('unmount removes the toolbar from the DOM', () => {
    const hud = new HudControlsImpl();
    hud.mount(parent, {
      audio: makeAudio(),
      toggleTerminal: vi.fn(),
      toggleHelp: vi.fn(),
    });
    expect(parent.querySelector('.hs-hud')).not.toBeNull();
    hud.unmount();
    expect(parent.querySelector('.hs-hud')).toBeNull();
  });
});
