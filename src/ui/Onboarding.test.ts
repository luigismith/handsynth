// Owner: ux-curator
//
// Smoke tests for OnboardingImpl. happy-dom is enough — we only assert DOM
// wiring and the awaitStart() promise resolution.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OnboardingImpl } from './Onboarding';
import { setLang, __resetForTests } from '../i18n';

describe('OnboardingImpl', () => {
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

  it('mounts a CTA and resolves awaitStart() on click', async () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);

    const button = parent.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toMatch(/webcam/i);

    const startPromise = ob.awaitStart();
    button!.click();
    await expect(startPromise).resolves.toBeUndefined();
  });

  it('is idempotent on mount', () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);
    ob.mount(parent);
    expect(parent.querySelectorAll('.hs-onboard-card').length).toBe(1);
  });

  it('unmount removes the card', () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);
    ob.unmount();
    expect(parent.querySelector('.hs-onboard-card')).toBeNull();
  });

  it('showError displays the error and re-arms awaitStart for retry', async () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);

    // First click — initial start.
    const first = ob.awaitStart();
    parent.querySelector('button')!.click();
    await first;

    ob.showError('Webcam negata.');
    const errEl = parent.querySelector('.hs-onboard-error') as HTMLElement;
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).toBe('Webcam negata.');

    // After showError the button text is the localized retry label
    // ("Retry" in en, "Riprova" in it). We boot in en here.
    const button = parent.querySelector('button')!;
    expect(button.textContent).toMatch(/retry/i);

    const second = ob.awaitStart();
    let done = false;
    void second.then(() => {
      done = true;
    });
    // Microtask flush — should still be unresolved.
    await Promise.resolve();
    expect(done).toBe(false);

    button.click();
    await second;
  });

  it('renders English strings by default', () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);
    const sub = parent.querySelector('.hs-onboard-sub') as HTMLElement;
    const button = parent.querySelector('button') as HTMLButtonElement;
    expect(sub.textContent).toContain('Raise your hands');
    expect(button.textContent).toBe('Allow webcam and begin');
  });

  it('renders Italian strings when active language is it', () => {
    setLang('it');
    const ob = new OnboardingImpl();
    ob.mount(parent);
    const sub = parent.querySelector('.hs-onboard-sub') as HTMLElement;
    const button = parent.querySelector('button') as HTMLButtonElement;
    expect(sub.textContent).toContain('Alza le mani');
    expect(button.textContent).toBe('Permetti webcam e iniziare');
  });

  it('reflows on lang switch without remount', () => {
    const ob = new OnboardingImpl();
    ob.mount(parent);
    const sub = parent.querySelector('.hs-onboard-sub') as HTMLElement;
    const button = parent.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Allow webcam and begin');
    setLang('it');
    expect(button.textContent).toBe('Permetti webcam e iniziare');
    expect(sub.textContent).toContain('Alza le mani');
    setLang('en');
    expect(button.textContent).toBe('Allow webcam and begin');
  });
});
