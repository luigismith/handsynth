// Owner: ux-curator
//
// First-launch flow. Renders a single dark-glass card with a CTA button. The
// click on that button is the user-gesture trigger required for both
// `AudioContext.resume()` (Tone.start) and `getUserMedia` to succeed in
// modern browsers — main.ts awaits awaitStart() and proceeds inside the same
// gesture.
//
// All user-visible strings come from the i18n layer. `applyLang()` re-reads
// the active dictionary into the existing DOM nodes (no remount) so the
// language switcher in HudControls can flip the card while it's still on
// screen during the retry loop.

import { injectStyles } from './styles';
import { t, subscribeLang } from '../i18n';

export interface OnboardingApi {
  /** Mount the card into the given parent element. Idempotent. */
  mount(parent: HTMLElement): void;
  /** Resolves when the user clicks the primary CTA. */
  awaitStart(): Promise<void>;
  /** Display an error message under the CTA (e.g. retry path). */
  showError(message: string): void;
  /** Tear down the DOM. Idempotent. */
  unmount(): void;
}

export class OnboardingImpl implements OnboardingApi {
  private root: HTMLElement | null = null;
  private card: HTMLDivElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private subEl: HTMLParagraphElement | null = null;
  private cheatsEl: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private errorEl: HTMLDivElement | null = null;
  private hasErrorShown = false;
  private unsubLang: (() => void) | null = null;

  private startResolvers: Array<() => void> = [];
  private startedPromise: Promise<void> | null = null;
  private resolved = false;

  mount(parent: HTMLElement): void {
    if (this.card) return; // idempotent
    injectStyles();

    const card = document.createElement('div');
    card.className = 'hs-onboard-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'hs-onboard-title');

    const title = document.createElement('h1');
    title.id = 'hs-onboard-title';
    title.className = 'hs-onboard-title';

    const sub = document.createElement('p');
    sub.className = 'hs-onboard-sub';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hs-onboard-btn';
    button.addEventListener('click', () => this.handleStart());

    const cheats = document.createElement('div');
    cheats.className = 'hs-onboard-cheats';

    const errorEl = document.createElement('div');
    errorEl.className = 'hs-onboard-error';
    errorEl.hidden = true;
    errorEl.setAttribute('role', 'alert');

    card.append(title, sub, button, cheats, errorEl);
    parent.appendChild(card);

    this.root = parent;
    this.card = card;
    this.titleEl = title;
    this.subEl = sub;
    this.cheatsEl = cheats;
    this.button = button;
    this.errorEl = errorEl;

    this.applyLang();
    this.unsubLang = subscribeLang(() => this.applyLang());

    // Auto-focus the CTA so keyboard users can press Enter immediately.
    queueMicrotask(() => button.focus());
  }

  /**
   * Re-apply localized strings onto the existing DOM. Called on mount and
   * whenever the language changes. We deliberately keep the button text
   * stable across lang changes when the user has hit Retry — we still want
   * to read "Retry" / "Riprova" in the new language.
   */
  applyLang(): void {
    if (!this.card) return;
    if (this.titleEl) this.titleEl.textContent = t('onboarding.title');
    if (this.subEl) this.subEl.textContent = t('onboarding.subtitle');
    if (this.cheatsEl) this.cheatsEl.textContent = t('onboarding.cheats');
    if (this.button) {
      this.button.textContent = this.hasErrorShown
        ? t('onboarding.retry')
        : t('onboarding.cta');
      this.button.setAttribute('aria-label', t('onboarding.ctaAria'));
    }
  }

  awaitStart(): Promise<void> {
    if (!this.startedPromise) {
      this.startedPromise = new Promise<void>((resolve) => {
        if (this.resolved) {
          resolve();
        } else {
          this.startResolvers.push(resolve);
        }
      });
    }
    return this.startedPromise;
  }

  showError(message: string): void {
    if (!this.errorEl) return;
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
    this.hasErrorShown = true;
    if (this.button) {
      this.button.textContent = t('onboarding.retry');
      this.button.focus();
    }
    // Re-arm: future awaitStart() calls should wait for the next click.
    this.resolved = false;
    this.startedPromise = null;
  }

  unmount(): void {
    if (this.unsubLang) {
      this.unsubLang();
      this.unsubLang = null;
    }
    if (this.card && this.card.parentElement) {
      this.card.parentElement.removeChild(this.card);
    }
    this.card = null;
    this.titleEl = null;
    this.subEl = null;
    this.cheatsEl = null;
    this.button = null;
    this.errorEl = null;
    this.root = null;
    this.hasErrorShown = false;
    // Resolve any leftover awaiters so callers don't hang.
    for (const r of this.startResolvers) r();
    this.startResolvers = [];
  }

  private handleStart(): void {
    this.resolved = true;
    const resolvers = this.startResolvers.splice(0);
    for (const r of resolvers) r();

    // Visual fade — DOM is removed by unmount() called by main.ts after
    // resolve. We still kick a fade class so the user sees the transition.
    if (this.card) this.card.classList.add('hs-fade-out');
  }
}
