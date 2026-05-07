// Owner: ux-curator
//
// Vibe-selector chip strip. Bound to VIBES from @presets/vibes. Emits a
// `change` callback that the host wires to `interaction.setVibe(...)`.

import type { VibeId, VibePreset } from '@contracts/contracts';

const NOT_IMPL = 'NOT_IMPLEMENTED — owned by ux-curator';

export interface VibeSelectorOptions {
  initial: VibeId;
  onChange: (vibe: VibePreset) => void;
}

export class VibeSelector {
  mount(_root: HTMLElement, _opts: VibeSelectorOptions): void {
    throw new Error(NOT_IMPL);
  }
  unmount(): void {
    throw new Error(NOT_IMPL);
  }
}
