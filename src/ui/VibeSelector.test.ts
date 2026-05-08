// Owner: ux-curator
//
// Smoke tests for VibeSelectorImpl: clicking a chip fires onChange, setActive
// updates aria-checked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VibeSelectorImpl } from './VibeSelector';
import { VIBES, DEFAULT_VIBE, VIBE_LIST } from '@presets/vibes';
import type { VibeId } from '@contracts/contracts';
import { setLang, __resetForTests } from '../i18n';

describe('VibeSelectorImpl', () => {
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

  it('renders one chip per vibe with the default checked', () => {
    const sel = new VibeSelectorImpl();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);

    const chips = parent.querySelectorAll<HTMLButtonElement>('.hs-vibe-chip');
    expect(chips.length).toBe(VIBE_LIST.length);

    const checked = parent.querySelector(
      '.hs-vibe-chip[aria-checked="true"]',
    ) as HTMLButtonElement;
    expect(checked.dataset.vibeId).toBe(DEFAULT_VIBE);
  });

  it('fires onChange with the right id when a chip is clicked', () => {
    const sel = new VibeSelectorImpl();
    const cb = vi.fn();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    sel.onChange(cb);

    // Click the first non-default chip.
    const target: VibeId = VIBE_LIST.find((v) => v.id !== DEFAULT_VIBE)!.id;
    const chip = parent.querySelector(
      `.hs-vibe-chip[data-vibe-id="${target}"]`,
    ) as HTMLButtonElement;
    chip.click();

    expect(cb).toHaveBeenCalledWith(target);

    // aria-checked migrated.
    const newChecked = parent.querySelector(
      '.hs-vibe-chip[aria-checked="true"]',
    ) as HTMLButtonElement;
    expect(newChecked.dataset.vibeId).toBe(target);
  });

  it('does not fire onChange when clicking the already-active chip', () => {
    const sel = new VibeSelectorImpl();
    const cb = vi.fn();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    sel.onChange(cb);

    const chip = parent.querySelector(
      `.hs-vibe-chip[data-vibe-id="${DEFAULT_VIBE}"]`,
    ) as HTMLButtonElement;
    chip.click();
    expect(cb).not.toHaveBeenCalled();
  });

  it('setActive updates aria-checked without firing onChange', () => {
    const sel = new VibeSelectorImpl();
    const cb = vi.fn();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    sel.onChange(cb);

    const target = VIBE_LIST.find((v) => v.id !== DEFAULT_VIBE)!.id;
    sel.setActive(target);
    expect(cb).not.toHaveBeenCalled();

    const checked = parent.querySelector(
      '.hs-vibe-chip[aria-checked="true"]',
    ) as HTMLButtonElement;
    expect(checked.dataset.vibeId).toBe(target);
  });

  it('unmount removes the strip', () => {
    const sel = new VibeSelectorImpl();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    sel.unmount();
    expect(parent.querySelector('.hs-vibes')).toBeNull();
  });

  it('uses VIBES[id] short names', () => {
    const sel = new VibeSelectorImpl();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    const tychoChip = parent.querySelector(
      `.hs-vibe-chip[data-vibe-id="${VIBES.tycho.id}"]`,
    ) as HTMLButtonElement;
    expect(tychoChip.textContent).toBe('Tycho');
  });

  it('keeps the same short name when lang flips (display name shape is the same in both langs)', () => {
    const sel = new VibeSelectorImpl();
    sel.mount(parent, VIBE_LIST.slice(), DEFAULT_VIBE);
    const tychoChip = parent.querySelector(
      `.hs-vibe-chip[data-vibe-id="tycho"]`,
    ) as HTMLButtonElement;
    expect(tychoChip.textContent).toBe('Tycho');
    setLang('it');
    // "Tycho — deriva al tramonto" — short name stays "Tycho".
    expect(tychoChip.textContent).toBe('Tycho');
  });
});
