// Owner: ux-curator
//
// English dictionary. Source-of-truth for the bilingual UI: keys here are the
// canonical surface, and `it.ts` mirrors the same set with idiomatic Italian.
// Adding a new key here without adding it to it.ts will fail the
// translation-parity meta-test in i18n.test.ts.
//
// Naming convention: `domain.subdomain.what` — flat keys give us
// `keyof Dict` autocomplete + compile-time typo detection. Domains in use:
//   onboarding.*   first-launch card
//   panel.patch.*  PATCH editor (SettingsPanel)
//   panel.help.*   in-app manual modal (HelpPanel)
//   hud.*          bottom-right control strip
//   terminal.*     translucent log HUD
//   debug.*        DebugPanel (legacy, still in tree)
//   factory.*      factory preset taglines
//   vibe.*         vibe display names + taglines
//   scale.*        scale dropdown labels
//   error.*        user-visible error strings raised from main.ts
//
// Why this typing dance: we need each value typed as plain `string` so that
// the IT translations (different literal values) type-check against the same
// shape, while still preserving the LITERAL KEY UNION so `keyof Dict` powers
// autocomplete + typo detection in callers. Using `as const` collapses both
// keys and values to literals; we use a const object with typed values to
// keep keys narrow but values wide.

const dict = {
  // Onboarding -------------------------------------------------------------
  'onboarding.title': 'HANDSYNTH',
  'onboarding.subtitle': '> Raise your hands — webcam input ready.',
  'onboarding.cta': 'Allow webcam and begin',
  'onboarding.ctaAria': 'Begin HandSynth',
  'onboarding.retry': 'Retry',
  'onboarding.cheats': '[ <-> ] FILTER  [ ^ ] DENSITY  [ * ] STAB',

  // PATCH editor ------------------------------------------------------------
  'panel.patch.title': 'PATCH',
  'panel.patch.subtitle': 'P · ESC MUTE · H HELP',
  'panel.patch.toggleAria': 'Toggle patch editor',
  'panel.patch.dialogAria': 'Patch editor',
  'panel.patch.factoryAria': 'Factory presets',
  'panel.patch.scaleKeyAria': 'Scale and key',
  'panel.patch.keyLabel': 'KEY',
  'panel.patch.scaleLabel': 'SCALE',
  'panel.patch.keyAria': 'Key',
  'panel.patch.scaleAria': 'Scale',
  'panel.patch.resetTooltip': 'Reset to vibe default',
  'panel.patch.resetAria': 'Reset key and scale to vibe default',
  'panel.patch.section.filter': 'Filter',
  'panel.patch.section.drive': 'Drive',
  'panel.patch.section.timefx': 'Time FX',
  'panel.patch.section.mix': 'Mix',
  'panel.patch.section.tempo': 'Tempo',
  'panel.patch.section.vibe': 'Vibe',
  'panel.patch.section.patches': 'Patches',
  'panel.patch.knob.cutoff': 'Cutoff',
  'panel.patch.knob.q': 'Q',
  'panel.patch.knob.bright': 'Bright',
  'panel.patch.knob.drive': 'Drive',
  'panel.patch.knob.verb': 'Verb',
  'panel.patch.knob.delayfb': 'Delay FB',
  'panel.patch.knob.duck': 'Duck',
  'panel.patch.knob.intens': 'Intens.',
  'panel.patch.knob.bpm': 'BPM',
  'panel.patch.vibeLabel': 'Preset',
  'panel.patch.patchNamePlaceholder': 'Patch name',
  'panel.patch.patchNameAria': 'Patch name',
  'panel.patch.saveBtn': 'Save',
  'panel.patch.loadBtn': 'Load',
  'panel.patch.delBtn': 'Del',
  'panel.patch.resetVibeBtn': 'Reset to vibe',
  'panel.patch.patchesEmpty': 'No saved patches.',
  'panel.patch.untitledPrefix': 'Patch',

  // HelpPanel ---------------------------------------------------------------
  'panel.help.title': 'MANUAL',
  'panel.help.closeHint': 'PRESS ESC OR H TO CLOSE',
  'panel.help.closeAria': 'Close manual',
  'panel.help.dialogAria': 'HandSynth manual',

  // HudControls -------------------------------------------------------------
  'hud.toolbarAria': 'HUD controls',
  'hud.stop.tooltip': 'Mute audio (Escape)',
  'hud.terminal.tooltip': 'Toggle terminal (T)',
  'hud.help.tooltip': 'Help / manual (H or F1)',
  'hud.lang.tooltip': 'Switch language (IT / EN)',

  // Terminal ----------------------------------------------------------------
  'terminal.ariaLabel': 'Terminal HUD',
  'terminal.ready': 'handsynth terminal ready · t toggle · esc mute · h help',

  // DebugPanel (legacy) -----------------------------------------------------
  'debug.toggle': 'CONTROLS',
  'debug.toggleAria': 'Show controls panel',
  'debug.title': 'CONTROLS',
  'debug.hint': '? to toggle · double-click a slider to release control',
  'debug.slider.cutoff': 'Filter cutoff (Hz)',
  'debug.slider.q': 'Filter resonance Q',
  'debug.slider.reverbWet': 'Reverb wet',
  'debug.slider.delayFb': 'Delay feedback',
  'debug.slider.drive': 'Saturator drive',
  'debug.slider.brightness': 'Brightness',
  'debug.slider.duck': 'Master duck',
  'debug.slider.intensity': 'Intensity (overrides gesture)',
  'debug.slider.bpm': 'BPM',
  'debug.vibeLabel': 'Vibe',

  // Factory preset taglines (id-keyed) --------------------------------------
  'factory.init.tagline': 'Neutral knobs — clean reset on top of the current vibe.',
  'factory.lush.tagline': 'Wide pad — high reverb, smooth top end, low resonance.',
  'factory.acid.tagline': '303 squelch — low cutoff, screaming resonance, mid drive.',
  'factory.dub.tagline': 'Echo chamber — huge delay feedback, dark filter, slow.',
  'factory.bright.tagline': 'Lights on — wide-open filter, airy top, low drive.',
  'factory.dark.tagline': 'Smothered — low cutoff, warm drive, sparse reverb.',
  'factory.tape.tagline': 'Analog warmth — saturated drive, mid verb, tape sparkle.',
  'factory.space.tagline': 'Vacuum drift — max reverb, slow tempo, ringing tail.',
  'factory.applyAria': 'Apply preset {{name}}: {{tagline}}',

  // Vibe display names + taglines ------------------------------------------
  'vibe.tycho.displayName': 'Tycho — sunset drift',
  'vibe.bonobo.displayName': 'Bonobo — dusty downtempo',
  'vibe.hopkins.displayName': 'Hopkins — granular dystopia',
  'vibe.floating-points.displayName': 'Floating Points — bright deep house',

  // Scale display names ----------------------------------------------------
  'scale.major.displayName': 'Major (Ionian)',
  'scale.minor.displayName': 'Minor (Aeolian)',
  'scale.harmonic minor.displayName': 'Harmonic Minor',
  'scale.melodic minor.displayName': 'Melodic Minor',
  'scale.dorian.displayName': 'Dorian',
  'scale.phrygian.displayName': 'Phrygian',
  'scale.lydian.displayName': 'Lydian',
  'scale.mixolydian.displayName': 'Mixolydian',
  'scale.locrian.displayName': 'Locrian',
  'scale.major pentatonic.displayName': 'Pentatonic Major',
  'scale.minor pentatonic.displayName': 'Pentatonic Minor',
  'scale.blues.displayName': 'Blues',
  'scale.chromatic.displayName': 'Chromatic (no snap)',

  // Errors / autopilot ------------------------------------------------------
  'error.startupFailed': 'Startup failed. Try again.',
  'error.autopilot': 'Webcam unavailable — autopilot mode active.',
} as const;

/** Literal-key union derived from the dictionary. */
export type EnDictKey = keyof typeof dict;

export default dict;
