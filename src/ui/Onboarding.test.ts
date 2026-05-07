// Owner: ux-curator
//
// Smoke tests for OnboardingImpl. happy-dom is enough — we only assert DOM
// wiring and the awaitStart() promise resolution.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OnboardingImpl } from './Onboarding';

describe('OnboardingImpl', () => {
  let parent: HTMLDivElement;

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    if (parent.parentElement) parent.parentElement.removeChild(parent);
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

    // After showError the button text is "Riprova" and a fresh awaitStart()
    // resolves only after another click.
    const button = parent.querySelector('button')!;
    expect(button.textContent).toMatch(/riprova/i);

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
});
