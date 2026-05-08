// Owner: ux-curator
//
// Detect a starting language from (a) localStorage if the user has explicitly
// chosen one before, (b) navigator.language if Italian, (c) English fallback.
//
// Kept as its own module so the test suite can stub navigator + localStorage
// in isolation, and so `index.ts` doesn't grow conditional access to globals.

export type Lang = 'it' | 'en';

export const LS_LANG_KEY = 'hs.lang';

/** True if the browser locale string indicates Italian. */
export function isItalianLocale(locale: string | undefined): boolean {
  if (!locale) return false;
  const lower = locale.toLowerCase();
  return lower === 'it' || lower.startsWith('it-') || lower.startsWith('it_');
}

/**
 * Read the persisted lang choice from localStorage. Returns null if missing,
 * malformed, or storage is denied (private mode).
 */
export function readPersistedLang(): Lang | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_LANG_KEY);
    if (raw === 'it' || raw === 'en') return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * Boot-time detection: persisted choice wins; otherwise sniff the browser
 * locale; otherwise English.
 *
 * Pure-function flavour for testability — pass an explicit `locale` to
 * sidestep the global navigator. The default uses `navigator.language` if
 * available.
 */
export function detectLang(locale?: string | null): Lang {
  const persisted = readPersistedLang();
  if (persisted) return persisted;
  const browserLocale =
    locale !== undefined
      ? locale ?? undefined
      : typeof navigator !== 'undefined'
        ? navigator.language
        : undefined;
  return isItalianLocale(browserLocale) ? 'it' : 'en';
}

/** Persist the chosen lang. Silently no-ops if storage is denied. */
export function persistLang(lang: Lang): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_LANG_KEY, lang);
  } catch {
    /* noop — storage may be denied */
  }
}
