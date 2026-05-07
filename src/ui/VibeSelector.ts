// Owner: ux-curator
//
// Vibe-selector chip strip. 4 pill-shaped chips at top-center, low default
// opacity, full opacity on hover/focus. Click → fires onChange(id) → main.ts
// invokes mapper.setVibe(VIBES[id]). The interaction-mapper owns the actual
// crossfade; this UI is purely a switch.

import type { VibeId, VibePreset } from '@contracts/contracts';
import { injectStyles } from './styles';

export interface VibeSelectorApi {
  mount(parent: HTMLElement, vibes: VibePreset[], current: VibeId): void;
  setActive(vibe: VibeId): void;
  onChange(cb: (vibe: VibeId) => void): void;
  unmount(): void;
}

/** Strip the vibe's mood tagline ("Tycho — sunset drift" → "Tycho"). */
function shortName(displayName: string): string {
  const dashIdx = displayName.indexOf('—');
  if (dashIdx > 0) return displayName.slice(0, dashIdx).trim();
  return displayName;
}

export class VibeSelectorImpl implements VibeSelectorApi {
  private root: HTMLElement | null = null;
  private container: HTMLDivElement | null = null;
  private chips = new Map<VibeId, HTMLButtonElement>();
  private listeners: Array<(vibe: VibeId) => void> = [];
  private active: VibeId | null = null;

  mount(parent: HTMLElement, vibes: VibePreset[], current: VibeId): void {
    if (this.container) return; // idempotent
    injectStyles();

    const wrap = document.createElement('div');
    wrap.className = 'hs-vibes';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'Vibe');

    for (const v of vibes) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hs-vibe-chip';
      chip.textContent = shortName(v.displayName);
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(v.id === current));
      chip.dataset.vibeId = v.id;
      chip.addEventListener('click', () => this.handleClick(v.id));
      this.chips.set(v.id, chip);
      wrap.appendChild(chip);
    }

    parent.appendChild(wrap);
    this.root = parent;
    this.container = wrap;
    this.active = current;
  }

  setActive(vibe: VibeId): void {
    this.active = vibe;
    for (const [id, el] of this.chips) {
      el.setAttribute('aria-checked', String(id === vibe));
    }
  }

  onChange(cb: (vibe: VibeId) => void): void {
    this.listeners.push(cb);
  }

  unmount(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.root = null;
    this.chips.clear();
    this.listeners = [];
    this.active = null;
  }

  private handleClick(id: VibeId): void {
    if (id === this.active) return;
    this.setActive(id);
    for (const l of this.listeners) {
      try {
        l(id);
      } catch (err) {
        console.warn('[VibeSelector] listener threw:', err);
      }
    }
  }
}
