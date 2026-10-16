import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPatches, PATCH_SCHEMA_VERSION } from './patches';

const STORAGE_KEY = 'handsynth.patches';

describe('loadPatches', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('skips malformed entries instead of throwing', () => {
    const good = { name: 'MINE', params: { filterCutoff: 1200 }, bpm: 90, createdAt: 1 };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: PATCH_SCHEMA_VERSION,
        patches: [null, 42, { name: 'NO-PARAMS' }, good],
      }),
    );
    let list: ReturnType<typeof loadPatches> = [];
    expect(() => {
      list = loadPatches();
    }).not.toThrow();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('MINE');
  });
});
