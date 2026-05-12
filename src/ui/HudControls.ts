// Owner: ux-curator
//
// Bottom-right HUD control strip. Four small icon buttons:
//   1. Power (STOP) — toggles audio mute via AudioEngine.setMute
//   2. Terminal — toggles the Terminal HUD (delegated callback)
//   3. Help     — toggles the HelpPanel (delegated callback)
//   4. Lang     — toggles between IT and EN; broadcasts via setLang
//
// We don't subscribe to mute events from the AudioEngine (the contract
// doesn't expose any). Instead, mute state lives here: the parent owns the
// boolean, drives it via Escape too, and calls setMuted() to keep the icon
// visual in sync. The component fires deps.audio.setMute itself when the
// button is clicked.
//
// The lang button is the user-facing entrypoint to the i18n switcher. It
// flips current → other and the broadcast (subscribeLang in i18n) re-applies
// every panel's strings without a remount.

import type { AudioEngine } from '@contracts/contracts';
import { injectStyles } from './styles';
import { getLang, setLang, subscribeLang, t } from '../i18n';

export interface HudControlsDeps {
  audio: AudioEngine;
  toggleTerminal: () => void;
  toggleHelp: () => void;
  /**
   * Optional central mute toggle. When provided, the STOP button routes
   * through this callback instead of calling `audio.setMute` directly —
   * lets main.ts own the single mute boolean and keep all paths
   * (HUD click, Escape key, bothFists gesture) in sync. If absent
   * (e.g. unit-test stubs), falls back to the old self-toggle.
   */
  toggleMute?: () => void;
}

export class HudControlsImpl {
  private mounted = false;
  private root: HTMLDivElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private termBtn: HTMLButtonElement | null = null;
  private helpBtn: HTMLButtonElement | null = null;
  private langBtn: HTMLButtonElement | null = null;
  private deps: HudControlsDeps | null = null;
  private muted = false;
  private unsubLang: (() => void) | null = null;

  mount(parent: HTMLElement, deps: HudControlsDeps): void {
    if (this.mounted) return;
    this.mounted = true;
    this.deps = deps;
    injectStyles();

    const root = document.createElement('div');
    root.className = 'hs-hud';
    root.setAttribute('role', 'toolbar');

    this.stopBtn = this.makeBtn(
      'hs-hud-stop',
      // Power glyph — keeps things readable in monospace.
      '⏻',
      () => {
        // MUTE FIX: prefer the central toggle if provided so we stay in
        // sync with the Escape key + bothFists gesture paths. Fall back
        // to the legacy self-toggle when no callback is wired (tests).
        if (this.deps?.toggleMute) {
          this.deps.toggleMute();
        } else {
          this.muted = !this.muted;
          this.deps?.audio.setMute(this.muted);
          this.applyMutedClass();
        }
      },
    );

    this.termBtn = this.makeBtn(
      'hs-hud-terminal',
      // "Not" sign — reads as a corner of a console; cheap & monospace-safe.
      '⌐',
      () => deps.toggleTerminal(),
    );

    this.helpBtn = this.makeBtn(
      'hs-hud-help',
      '?',
      () => deps.toggleHelp(),
    );

    this.langBtn = this.makeBtn(
      'hs-hud-lang',
      // Glyph is replaced with the current lang code by applyLang().
      'EN',
      () => {
        // Toggle between the two supported langs. Broadcast happens via
        // setLang → subscribers re-apply their strings.
        const next = getLang() === 'it' ? 'en' : 'it';
        setLang(next);
      },
    );
    this.langBtn.dataset.hsLang = '';

    root.append(this.stopBtn, this.termBtn, this.helpBtn, this.langBtn);
    parent.appendChild(root);
    this.root = root;

    this.applyLang();
    this.unsubLang = subscribeLang(() => this.applyLang());
  }

  unmount(): void {
    if (!this.mounted) return;
    this.mounted = false;
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
    if (this.root) this.root.remove();
    this.root = null;
    this.stopBtn = null;
    this.termBtn = null;
    this.helpBtn = null;
    this.langBtn = null;
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

  /**
   * Re-apply localized labels + tooltips. Called on mount and whenever the
   * lang flips. The lang button's glyph is the OTHER language code (so
   * "click here to switch to EN" while on IT, etc.).
   */
  applyLang(): void {
    if (this.root) {
      this.root.setAttribute('aria-label', t('hud.toolbarAria'));
    }
    if (this.stopBtn) {
      const tip = t('hud.stop.tooltip');
      this.stopBtn.title = tip;
      this.stopBtn.setAttribute('aria-label', tip);
    }
    if (this.termBtn) {
      const tip = t('hud.terminal.tooltip');
      this.termBtn.title = tip;
      this.termBtn.setAttribute('aria-label', tip);
    }
    if (this.helpBtn) {
      const tip = t('hud.help.tooltip');
      this.helpBtn.title = tip;
      this.helpBtn.setAttribute('aria-label', tip);
    }
    if (this.langBtn) {
      const lang = getLang();
      // Show the OTHER language code as the button label so the user reads
      // "click to switch to ___". Both codes are 2 chars so the button stays
      // visually balanced with the icon glyph siblings.
      const label = lang === 'it' ? 'EN' : 'IT';
      this.langBtn.textContent = label;
      const tip = t('hud.lang.tooltip');
      this.langBtn.title = tip;
      this.langBtn.setAttribute('aria-label', tip);
    }
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
    glyph: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hs-hud-btn ' + cls;
    b.textContent = glyph;
    b.addEventListener('click', onClick);
    return b;
  }
}
