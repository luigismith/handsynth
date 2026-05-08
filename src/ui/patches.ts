// Owner: ux-curator
//
// User-patch persistence for the SettingsPanel. Patches live in localStorage
// under a single key (`handsynth.patches`) as a versioned JSON envelope so
// future schema changes can migrate (or discard) safely instead of crashing.
//
// A patch captures: vibe choice, partial AudioEngineParams overrides, BPM,
// and a human-readable name. We deliberately do NOT persist hand state or
// transport position — patches are purely "what knobs are set to".

import type { AudioEngineParams, VibeId } from '@contracts/contracts';

/** Bumped when the on-disk shape changes. Older payloads are dropped. */
export const PATCH_SCHEMA_VERSION = 1;

const STORAGE_KEY = 'handsynth.patches';

export interface Patch {
  id: string;
  name: string;
  vibe: VibeId;
  params: Partial<AudioEngineParams>;
  bpm: number;
  createdAt: number;
}

interface Envelope {
  version: number;
  patches: Patch[];
}

function safeParse(raw: string | null): Envelope | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (
      obj &&
      typeof obj === 'object' &&
      'version' in obj &&
      'patches' in obj &&
      Array.isArray((obj as Envelope).patches)
    ) {
      const env = obj as Envelope;
      if (env.version !== PATCH_SCHEMA_VERSION) return null;
      return env;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadPatches(): Patch[] {
  const ls = getStorage();
  if (!ls) return [];
  const env = safeParse(ls.getItem(STORAGE_KEY));
  if (!env) return [];
  // Defensive copy — callers never share refs with storage.
  return env.patches.map((p) => ({ ...p, params: { ...p.params } }));
}

function persist(patches: Patch[]): void {
  const ls = getStorage();
  if (!ls) return;
  const env: Envelope = { version: PATCH_SCHEMA_VERSION, patches };
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(env));
  } catch {
    // QuotaExceeded or storage disabled — nothing we can do.
  }
}

export function savePatch(p: Patch): Patch[] {
  const list = loadPatches();
  // De-dup by id (overwrite).
  const filtered = list.filter((q) => q.id !== p.id);
  filtered.push({ ...p, params: { ...p.params } });
  persist(filtered);
  return filtered;
}

export function deletePatch(id: string): Patch[] {
  const list = loadPatches().filter((p) => p.id !== id);
  persist(list);
  return list;
}

export function makePatchId(): string {
  // Cheap, non-crypto. We don't need globally unique — just unique within
  // this user's localStorage.
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(36);
  return `p_${ts}_${rand}`;
}
