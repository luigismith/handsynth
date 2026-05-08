// Owner: ux-curator
//
// Bottom-right HUD control strip. Three small icon buttons:
//   1. Power (STOP) — toggles audio mute via AudioEngine.setMute
//   2. Terminal — toggles the Terminal HUD (delegated callback)
//   3. Help     — toggles the HelpPanel (delegated callback)
//
// We don't subscribe to mute events from the AudioEngine (the contract
// doesn't expose any). Instead, mute state lives here: the parent owns the
// boolean, drives it via Escape too, and calls setMuted() to keep the icon
// visual in sync. The component fires deps.audio.setMute itself when the
// button is clicked.

import type { AudioEngine } from '@contracts/contracts';
import { injectStyles } from './styles';

export interface HudControlsDeps {
  audio: AudioEngine;
  toggleTerminal: () => void;
  toggleHelp: () => void;
}

export class HudControlsImpl {
  private mounted = false;
  private root: HTMLDivElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private termBtn: HTMLButtonElement | null = null;
  private helpBtn: HTMLButtonElement | null = null;
  private deps: HudControlsDeps | null = null;
  private muted = false;

  mount(parent: HTMLElement, deps: HudControlsDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;
    injectStyles();

    const root = document.createElement('div');
    root.className = 'hs-hud';
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'HUD controls');

    this.stopBtn = this.makeBtn(
      'hs-hud-stop',
      'Mute audio (Escape)',
      // Power glyph — keeps things readable in monospace.
      '⏻',
      () => {
        this.muted = !this.muted;
        this.deps?.audio.setMute(this.muted);
        this.applyMutedClass();
      },
    );

    this.termBtn = this.makeBtn(
      'hs-hud-terminal',
      'Toggle terminal (T)',
      // "Not" sign — reads as a corner of a console; cheap & monospace-safe.
      '⌐',
      () => deps.toggleTerminal(),
    );

    this.helpBtn = this.makeBtn(
      'hs-hud-help',
      'Help / manual (H or F1)',
      '?',
      () => deps.toggleHelp(),
    );

    root.append(this.stopBtn, this.termBtn, this.helpBtn);
    parent.appendChild(root);
    this.root = root;
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.root) this.root.remove();
    this.root = null;
    this.stopBtn = null;
    this.termBtn = null;
    this.helpBtn = null;
    this.deps = null;
  }

  /**
   * Reflect the current mute state on the STOP button. The component owns
   * its own mute toggle internally too; this is the path for external
   * triggers (e.g. the Escape global shortcut wired in main.ts).
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMutedClass();
  }

  private applyMutedClass(): void {
    if (!this.stopBtn) return;
    if (this.muted) {
      this.stopBtn.classList.add('hs-hud-active');
      this.stopBtn.setAttribute('aria-pressed', 'true');
    } else {
      this.stopBtn.classList.remove('hs-hud-active');
      this.stopBtn.setAttribute('aria-pressed', 'false');
    }
  }

  private makeBtn(
    cls: string,
    label: string,
    glyph: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hs-hud-btn ' + cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }
}
