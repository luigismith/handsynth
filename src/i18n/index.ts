// Owner: ux-curator
//
// Tiny i18n runtime — no third-party deps. Holds the active language as a
// module-singleton, exposes `t()` for lookups, `setLang()` to switch, and
// `subscribeLang()` so panels re-apply their strings without remount.
//
// Architecture choice (vs. a library): bundle size matters here (the whole
// app is < 200kB gzipped today) and the surface we actually need is tiny —
// flat-key dictionaries + `{{name}}` template substitution. Adding i18next
// would dwarf every other dependency in the UI layer.

import enDict, { type EnDictKey } from './en';
import itDict from './it';
import { detectLang, persistLang, type Lang } from './detect';

export type { Lang } from './detect';
/**
 * The dictionary type: every key from `en.ts` mapped to a string. Defined
 * this way so the IT dictionary can use different literal values without
 * tripping the type-checker, while we keep autocomplete on the key set.
 */
export type DictKey = EnDictKey;
export type Dict = Record<DictKey, string>;

const DICTS: Record<Lang, Dict> = {
  en: enDict,
  it: itDict,
};

let current: Lang = detectLang();
const subscribers = new Set<(lang: Lang) => void>();

/** Get the active language. */
export function getLang(): Lang {
  return current;
}

/**
 * Switch the active language and notify every subscriber. Persists to
 * localStorage so the choice sticks across sessions. Calling with the
 * already-current lang is a no-op (no broadcast).
 */
export function setLang(lang: Lang): void {
  if (lang !== 'it' && lang !== 'en') return;
  if (lang === current) return;
  current = lang;
  persistLang(lang);
  // Update <html lang> when present so screen readers + browser-native
  // language hints stay in sync. Guarded for non-browser test harnesses.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lang;
  }
  for (const cb of subscribers) {
    try {
      cb(lang);
    } catch (err) {
      console.warn('[i18n] subscriber threw:', err);
    }
  }
}

/**
 * Subscribe to lang changes. Returns an unsubscribe handle. Panels call this
 * from `mount()` and call the handle from `unmount()` to avoid leaks.
 */
export function subscribeLang(cb: (lang: Lang) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * DIAG INSTRUMENTATION: number of currently-registered lang subscribers.
 *
 * Exported as a function (not the Set itself) so callers can't mutate the
 * registry from outside. The Terminal HUD reads this every 5s and prints
 * it on the DIAG row — a monotonic climb signals a panel mounting without
 * unmounting (HMR cycles or a future bug). Steady-state: one subscriber per
 * mounted panel that re-localises (today: HudControls + Onboarding +
 * SettingsPanel + Terminal + HelpPanel + VibeSelector ≈ 6).
 */
export function getLangSubscriberCount(): number {
  return subscribers.size;
}

/**
 * Look up a key in the active dictionary. Falls back to English when the
 * key is missing in the current dict (defence against an out-of-band IT
 * dict), and finally to the key itself when even English is missing
 * (which the parity meta-test prevents at CI time, but we still degrade
 * gracefully).
 *
 * Template substitution: `{{name}}` placeholders are replaced from `params`.
 * Unknown placeholders are left as-is so accidental typos surface visibly
 * rather than silently dropping content.
 */
export function t(
  key: DictKey,
  params?: Record<string, string | number>,
): string {
  const dict = DICTS[current];
  const fallback = DICTS.en;
  const raw = (dict[key] as string | undefined) ?? (fallback[key] as string | undefined) ?? key;
  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_full, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return `{{${name}}}`;
    return String(v);
  });
}

/**
 * Test-only reset. Allows tests to wipe subscribers and force a fresh lang
 * without touching localStorage. Production code does not call this.
 */
export function __resetForTests(lang: Lang = 'en'): void {
  current = lang;
  subscribers.clear();
}
