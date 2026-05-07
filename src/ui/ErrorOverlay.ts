// Owner: ux-curator
//
// Centered error card (with retry CTA) for fatal failures, plus a small
// auto-fading toast for non-fatal warnings (e.g. "webcam non disponibile —
// modalità autopilot attiva").

import { injectStyles } from './styles';

export interface ErrorOverlayApi {
  mount(parent: HTMLElement): void;
  /** Persistent error card with a retry button. */
  showError(message: string, onRetry?: () => void): void;
  /** Brief toast — auto-fades after ~4s. */
  showWarning(message: string): void;
  hide(): void;
  unmount(): void;
}

const TOAST_LIFETIME_MS = 4000;
const TOAST_FADE_MS = 240;

export class ErrorOverlayImpl implements ErrorOverlayApi {
  private root: HTMLElement | null = null;
  private card: HTMLDivElement | null = null;
  private toast: HTMLDivElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  mount(parent: HTMLElement): void {
    injectStyles();
    this.root = parent;
  }

  showError(message: string, onRetry?: () => void): void {
    if (!this.root) return;
    this.hide();

    const card = document.createElement('div');
    card.className = 'hs-error-card';
    card.setAttribute('role', 'alertdialog');

    const msg = document.createElement('p');
    msg.className = 'hs-error-msg';
    msg.textContent = message;
    card.appendChild(msg);

    if (onRetry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hs-error-btn';
      btn.textContent = 'Riprova';
      btn.addEventListener('click', () => {
        this.hide();
        onRetry();
      });
      card.appendChild(btn);
    }

    this.root.appendChild(card);
    this.card = card;
  }

  showWarning(message: string): void {
    if (!this.root) return;
    if (this.toast) {
      this.clearToast();
    }
    const t = document.createElement('div');
    t.className = 'hs-toast';
    t.setAttribute('role', 'status');
    t.textContent = message;
    this.root.appendChild(t);
    this.toast = t;

    this.toastTimer = setTimeout(() => {
      if (!this.toast) return;
      this.toast.classList.add('hs-fade-out');
      setTimeout(() => this.clearToast(), TOAST_FADE_MS);
    }, TOAST_LIFETIME_MS);
  }

  hide(): void {
    if (this.card && this.card.parentElement) {
      this.card.parentElement.removeChild(this.card);
    }
    this.card = null;
  }

  unmount(): void {
    this.hide();
    this.clearToast();
    this.root = null;
  }

  private clearToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.toast && this.toast.parentElement) {
      this.toast.parentElement.removeChild(this.toast);
    }
    this.toast = null;
  }
}
