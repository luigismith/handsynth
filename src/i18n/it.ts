// Owner: ux-curator
//
// Italian dictionary. Mirror of `en.ts` keys; translations are idiomatic
// (NOT literal) and short enough to fit the existing UI metrics. The
// translation-parity meta-test (i18n.test.ts) compares Object.keys(en) and
// Object.keys(it) — adding a key here without adding it to en.ts (or vice
// versa) is a hard fail.

import type { EnDictKey } from './en';

// Typed as Record<EnDictKey, string> so each Italian translation is a free
// string (different literal from English) but the key set is locked to the
// English source-of-truth — adding/removing a key without doing the same
// in en.ts is a compile error.
const dict: Record<EnDictKey, string> = {
  // Onboarding -------------------------------------------------------------
  'onboarding.title': 'HANDSYNTH',
  'onboarding.subtitle': '> Alza le mani — webcam input pronto.',
  'onboarding.cta': 'Permetti webcam e iniziare',
  'onboarding.ctaAria': 'Iniziare HandSynth',
  'onboarding.retry': 'Riprova',
  'onboarding.cheats': '[ <-> ] FILTRO  [ ^ ] DENSITA  [ * ] STAB',

  // PATCH editor ------------------------------------------------------------
  'panel.patch.title': 'PATCH',
  'panel.patch.subtitle': 'P · ESC MUTO · H AIUTO',
  'panel.patch.toggleAria': 'Apri/chiudi editor patch',
  'panel.patch.dialogAria': 'Editor patch',
  'panel.patch.factoryAria': 'Preset di fabbrica',
  'panel.patch.scaleKeyAria': 'Tonalita e scala',
  'panel.patch.keyLabel': 'TON',
  'panel.patch.scaleLabel': 'SCALA',
  'panel.patch.keyAria': 'Tonalita',
  'panel.patch.scaleAria': 'Scala',
  'panel.patch.resetTooltip': 'Ripristina default vibe',
  'panel.patch.resetAria': 'Ripristina tonalita e scala al default del vibe',
  'panel.patch.section.filter': 'Filtro',
  'panel.patch.section.drive': 'Drive',
  'panel.patch.section.timefx': 'FX Tempo',
  'panel.patch.section.mix': 'Mix',
  'panel.patch.section.tempo': 'Tempo',
  'panel.patch.section.vibe': 'Vibe',
  'panel.patch.section.patches': 'Patch',
  'panel.patch.knob.cutoff': 'Cutoff',
  'panel.patch.knob.q': 'Q',
  'panel.patch.knob.bright': 'Lumin.',
  'panel.patch.knob.drive': 'Drive',
  'panel.patch.knob.verb': 'Riv.',
  'panel.patch.knob.delayfb': 'Delay FB',
  'panel.patch.knob.duck': 'Duck',
  'panel.patch.knob.intens': 'Intens.',
  'panel.patch.knob.bpm': 'BPM',
  'panel.patch.vibeLabel': 'Preset',
  'panel.patch.patchNamePlaceholder': 'Nome patch',
  'panel.patch.patchNameAria': 'Nome patch',
  'panel.patch.saveBtn': 'Salva',
  'panel.patch.loadBtn': 'Carica',
  'panel.patch.delBtn': 'Elim',
  'panel.patch.resetVibeBtn': 'Ripristina vibe',
  'panel.patch.patchesEmpty': 'Nessuna patch salvata.',
  'panel.patch.untitledPrefix': 'Patch',

  // HelpPanel ---------------------------------------------------------------
  'panel.help.title': 'MANUALE',
  'panel.help.closeHint': 'PREMI ESC O H PER CHIUDERE',
  'panel.help.closeAria': 'Chiudi manuale',
  'panel.help.dialogAria': 'Manuale HandSynth',

  // HudControls -------------------------------------------------------------
  'hud.toolbarAria': 'Controlli HUD',
  'hud.stop.tooltip': 'Silenzia audio (Esc)',
  'hud.terminal.tooltip': 'Apri/chiudi terminale (T)',
  'hud.help.tooltip': 'Aiuto / manuale (H o F1)',
  'hud.lang.tooltip': 'Cambia lingua (IT / EN)',

  // Terminal ----------------------------------------------------------------
  'terminal.ariaLabel': 'HUD terminale',
  'terminal.ready': 'handsynth terminale pronto · t apre · esc muto · h aiuto',

  // DebugPanel (legacy) -----------------------------------------------------
  'debug.toggle': 'CONTROLLI',
  'debug.toggleAria': 'Mostra pannello controlli',
  'debug.title': 'CONTROLLI',
  'debug.hint': '? per aprire · doppio click su uno slider per rilasciare il controllo',
  'debug.slider.cutoff': 'Filter cutoff (Hz)',
  'debug.slider.q': 'Risonanza filtro Q',
  'debug.slider.reverbWet': 'Riverbero wet',
  'debug.slider.delayFb': 'Feedback delay',
  'debug.slider.drive': 'Drive saturatore',
  'debug.slider.brightness': 'Luminosita',
  'debug.slider.duck': 'Master duck',
  'debug.slider.intensity': 'Intensita (override gesto)',
  'debug.slider.bpm': 'BPM',
  'debug.vibeLabel': 'Vibe',

  // Factory preset taglines (id-keyed) --------------------------------------
  'factory.init.tagline': 'Manopole neutre — reset pulito sopra il vibe corrente.',
  'factory.lush.tagline': 'Pad ampio — molto riverbero, alti morbidi, risonanza bassa.',
  'factory.acid.tagline': 'Squelch 303 — cutoff basso, risonanza urlante, drive medio.',
  'factory.dub.tagline': 'Camera d’eco — feedback delay enorme, filtro scuro, lento.',
  'factory.bright.tagline': 'Luci accese — filtro spalancato, alti aerei, drive basso.',
  'factory.dark.tagline': 'Soffocato — cutoff basso, drive caldo, riverbero scarno.',
  'factory.tape.tagline': 'Calore analogico — drive saturo, riverbero medio, scintilla nastro.',
  'factory.space.tagline': 'Deriva nel vuoto — riverbero al massimo, lento, coda risonante.',
  'factory.applyAria': 'Applica preset {{name}}: {{tagline}}',

  // Vibe display names + taglines ------------------------------------------
  'vibe.tycho.displayName': 'Tycho — deriva al tramonto',
  'vibe.bonobo.displayName': 'Bonobo — downtempo polveroso',
  'vibe.hopkins.displayName': 'Hopkins — distopia granulare',
  'vibe.floating-points.displayName': 'Floating Points — deep house luminosa',

  // Scale display names ----------------------------------------------------
  'scale.major.displayName': 'Maggiore (Ionica)',
  'scale.minor.displayName': 'Minore (Eolia)',
  'scale.harmonic minor.displayName': 'Minore Armonica',
  'scale.melodic minor.displayName': 'Minore Melodica',
  'scale.dorian.displayName': 'Dorica',
  'scale.phrygian.displayName': 'Frigia',
  'scale.lydian.displayName': 'Lidia',
  'scale.mixolydian.displayName': 'Misolidia',
  'scale.locrian.displayName': 'Locria',
  'scale.major pentatonic.displayName': 'Pentatonica Maggiore',
  'scale.minor pentatonic.displayName': 'Pentatonica Minore',
  'scale.blues.displayName': 'Blues',
  'scale.chromatic.displayName': 'Cromatica (nessuno snap)',

  // Errors / autopilot ------------------------------------------------------
  'error.startupFailed': 'Avvio non riuscito. Riprova.',
  'error.autopilot': 'Webcam non disponibile — modalita autopilot attiva.',
};

export default dict;
