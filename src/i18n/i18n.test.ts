// Owner: ux-curator
//
// Tests for the i18n runtime. Cover:
//   * detection from localStorage / navigator.language
//   * setLang persistence + broadcast
//   * t() lookup, fallback, and {{template}} substitution
//   * parity meta-test: en + it dictionaries must share the same key set

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLang,
  setLang,
  subscribeLang,
  t,
  __resetForTests,
  type Lang,
} from './index';
import {
  detectLang,
  isItalianLocale,
  readPersistedLang,
  persistLang,
  LS_LANG_KEY,
} from './detect';
import enDict from './en';
import itDict from './it';

describe('isItalianLocale', () => {
  it('returns true for it, it-IT, it_CH', () => {
    expect(isItalianLocale('it')).toBe(true);
    expect(isItalianLocale('it-IT')).toBe(true);
    expect(isItalianLocale('it_CH')).toBe(true);
    expect(isItalianLocale('IT-IT')).toBe(true);
  });

  it('returns false for en, fr, de, undefined', () => {
    expect(isItalianLocale('en-US')).toBe(false);
    expect(isItalianLocale('fr-FR')).toBe(false);
    expect(isItalianLocale('de')).toBe(false);
    expect(isItalianLocale(undefined)).toBe(false);
  });
});

describe('detectLang', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to en when no localStorage and locale is not Italian', () => {
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('fr-FR')).toBe('en');
    expect(detectLang(null)).toBe('en');
  });

  it('returns it when navigator.language is Italian', () => {
    expect(detectLang('it-IT')).toBe('it');
    expect(detectLang('it')).toBe('it');
  });

  it('persisted localStorage wins over locale', () => {
    localStorage.setItem(LS_LANG_KEY, 'en');
    expect(detectLang('it-IT')).toBe('en');
    localStorage.setItem(LS_LANG_KEY, 'it');
    expect(detectLang('en-US')).toBe('it');
  });

  it('ignores garbage localStorage values', () => {
    localStorage.setItem(LS_LANG_KEY, 'klingon');
    expect(detectLang('en-US')).toBe('en');
  });
});

describe('readPersistedLang', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when nothing stored', () => {
    expect(readPersistedLang()).toBeNull();
  });

  it('returns it / en when stored', () => {
    localStorage.setItem(LS_LANG_KEY, 'it');
    expect(readPersistedLang()).toBe('it');
    localStorage.setItem(LS_LANG_KEY, 'en');
    expect(readPersistedLang()).toBe('en');
  });

  it('returns null for invalid values', () => {
    localStorage.setItem(LS_LANG_KEY, 'es');
    expect(readPersistedLang()).toBeNull();
  });
});

describe('persistLang', () => {
  beforeEach(() => localStorage.clear());

  it('writes the lang to localStorage', () => {
    persistLang('it');
    expect(localStorage.getItem(LS_LANG_KEY)).toBe('it');
    persistLang('en');
    expect(localStorage.getItem(LS_LANG_KEY)).toBe('en');
  });
});

describe('getLang / setLang', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests('en');
  });

  it('getLang returns the current language', () => {
    expect(getLang()).toBe('en');
  });

  it('setLang switches and persists', () => {
    setLang('it');
    expect(getLang()).toBe('it');
    expect(localStorage.getItem(LS_LANG_KEY)).toBe('it');
  });

  it('setLang fires subscribers exactly once per change', () => {
    let count = 0;
    let last: Lang | null = null;
    const unsub = subscribeLang((lang) => {
      count += 1;
      last = lang;
    });
    setLang('it');
    expect(count).toBe(1);
    expect(last).toBe('it');
    // Same lang again — no-op.
    setLang('it');
    expect(count).toBe(1);
    setLang('en');
    expect(count).toBe(2);
    expect(last).toBe('en');
    unsub();
    setLang('it');
    expect(count).toBe(2);
  });

  it('setLang updates <html lang> attribute', () => {
    setLang('it');
    expect(document.documentElement.lang).toBe('it');
    setLang('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('setLang ignores invalid values', () => {
    setLang('en');
    // @ts-expect-error: deliberately invalid
    setLang('klingon');
    expect(getLang()).toBe('en');
  });
});

describe('t()', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests('en');
  });

  it('returns the English string by default', () => {
    expect(t('onboarding.cta')).toBe('Allow webcam and begin');
    expect(t('panel.help.title')).toBe('MANUAL');
  });

  it('returns the Italian string after setLang("it")', () => {
    setLang('it');
    expect(t('onboarding.cta')).toBe('Permetti webcam e iniziare');
    expect(t('panel.help.title')).toBe('MANUALE');
  });

  it('substitutes {{name}} placeholders', () => {
    const out = t('factory.applyAria', { name: 'LUSH', tagline: 'Wide pad' });
    expect(out).toBe('Apply preset LUSH: Wide pad');
  });

  it('leaves unknown placeholders untouched', () => {
    const out = t('factory.applyAria', { name: 'LUSH' });
    expect(out).toContain('LUSH');
    expect(out).toContain('{{tagline}}');
  });

  it('falls back to English when key is missing in active lang', () => {
    // Inject a missing key into IT to simulate a half-translated dict.
    setLang('it');
    // Force a hole — typescript trusts us here, runtime guards via fallback.
    const itAny = itDict as unknown as Record<string, string>;
    const stash = itAny['onboarding.cta'] ?? '';
    delete itAny['onboarding.cta'];
    try {
      expect(t('onboarding.cta')).toBe(enDict['onboarding.cta']);
    } finally {
      itAny['onboarding.cta'] = stash;
    }
  });
});

describe('translation parity (meta-test)', () => {
  it('en and it dictionaries have exactly the same keys', () => {
    const enKeys = Object.keys(enDict).sort();
    const itKeys = Object.keys(itDict).sort();
    expect(itKeys).toEqual(enKeys);
  });

  it('every Italian translation is a non-empty string', () => {
    for (const [k, v] of Object.entries(itDict)) {
      expect(typeof v, `key ${k}`).toBe('string');
      expect((v as string).length, `key ${k}`).toBeGreaterThan(0);
    }
  });

  it('every English translation is a non-empty string', () => {
    for (const [k, v] of Object.entries(enDict)) {
      expect(typeof v, `key ${k}`).toBe('string');
      expect((v as string).length, `key ${k}`).toBeGreaterThan(0);
    }
  });
});
