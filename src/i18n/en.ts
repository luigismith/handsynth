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
  'panel.patch.section.voice': 'Voice',
  'panel.patch.knob.cutoff': 'Cutoff',
  'panel.patch.knob.q': 'Q',
  'panel.patch.knob.bright': 'Bright',
  'panel.patch.knob.drive': 'Drive',
  'panel.patch.knob.verb': 'Verb',
  'panel.patch.knob.delayfb': 'Delay FB',
  'panel.patch.knob.duck': 'Duck',
  'panel.patch.knob.intens': 'Intens.',
  'panel.patch.knob.bpm': 'BPM',
  'panel.patch.knob.padMorph': 'Pad Morph',
  'panel.patch.knob.leadMorph': 'Lead Morph',
  'panel.patch.knob.bassMorph': 'Bass Morph',
  'panel.patch.voice.padWaveLabel': 'PAD WAVE',
  'panel.patch.voice.leadWaveLabel': 'LEAD WAVE',
  'panel.patch.voice.bassWaveLabel': 'BASS WAVE',
  'panel.patch.voice.padWaveAria': 'Pad waveform',
  'panel.patch.voice.leadWaveAria': 'Lead waveform',
  'panel.patch.voice.bassWaveAria': 'Bass waveform',
  'panel.patch.voice.morphAria': 'Crossfade between selected and morph waveform',
  'panel.patch.smartOn': 'SMART',
  'panel.patch.smartOff': 'SMART OFF',
  'panel.patch.smartAria': 'Toggle intelligent voicing',
  'panel.patch.smartTooltip': 'Smart voicing — nudges each voice toward a musically-sensible timbre based on FX state',
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

  // Calibration + tutorial wizard ------------------------------------------
  // Header / common
  'calib.counter.calibration': 'CALIBRATION',
  'calib.counter.tutorial': 'TUTORIAL',
  'calib.quit': 'Quit wizard',
  'calib.skip': 'Skip',
  'calib.next': 'Next',
  'calib.finish': 'Finish',
  'calib.collecting': 'Collecting · {{s}}s',
  'calib.collected': 'Captured — press Next when ready',
  'calib.waitingGesture': 'Waiting for gesture…',
  'calib.gestureOk': 'Got it — press Next when ready',

  // Sample steps
  'calib.position.title': 'Find your spot',
  'calib.position.desc': 'Sit at a comfortable distance from the camera. Keep both hands visible — they should fit inside the frame with a little space to spare.',
  'calib.vertical.title': 'Vertical range',
  'calib.vertical.desc': 'Slowly raise both hands as high as feels natural, then lower them as low as you can — repeat a couple of times.',
  'calib.horizontal.title': 'Hand spread',
  'calib.horizontal.desc': 'Bring both hands close together in front of you, then spread them out wide — repeat a couple of times.',
  'calib.shape.title': 'Open and close',
  'calib.shape.desc': 'Make tight fists, then splay your fingers wide open. Do it a few times with both hands.',
  'calib.lateral.title': 'Side to side',
  'calib.lateral.desc': 'Move your right hand from one side of the frame to the other — left to right and back.',

  // Tutorial steps
  'tut.pitchHigh.title': 'Raise your hand high',
  'tut.pitchHigh.desc': 'Lift either hand toward the top of the frame. Listen — the music brightens as you climb.',
  'tut.pitchHigh.hint': 'Try moving your hand closer to the top of the screen.',
  'tut.pitchLow.title': 'Drop your hand low',
  'tut.pitchLow.desc': 'Bring it back down toward the bottom. Notice how the texture softens.',
  'tut.fist.title': 'Make a fist',
  'tut.fist.desc': 'Close one hand into a fist. The filter clamps down — useful for breakdowns.',
  'tut.open.title': 'Open your hand',
  'tut.open.desc': 'Splay your fingers wide. The sound opens up — your hand IS the cutoff.',
  'tut.mute.title': 'Mute with two fists',
  'tut.mute.desc': 'Close both hands into fists at the same time. The audio cuts.',
  'tut.mute.hint': 'Make sure both fists are visible — open them back up to unmute.',
  'tut.mouth.title': 'Open your mouth wide',
  'tut.mouth.desc': 'Open it as if singing an "AH". Sparks fly from your lips and a harmonic flourish lands.',
  'tut.mouth.hint': 'Need the camera to see your face — turn your head toward the screen.',

  // Recalibrate button (SettingsPanel)
  'panel.patch.recalibrateBtn': 'Recalibrate',
  'panel.patch.recalibrateAria': 'Re-run calibration and tutorial',
  'panel.patch.section.calibration': 'Calibration',
} as const;

/** Literal-key union derived from the dictionary. */
export type EnDictKey = keyof typeof dict;

export default dict;
