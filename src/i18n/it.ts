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
  'panel.patch.section.voice': 'Voce',
  'panel.patch.knob.cutoff': 'Cutoff',
  'panel.patch.knob.q': 'Q',
  'panel.patch.knob.bright': 'Lumin.',
  'panel.patch.knob.drive': 'Drive',
  'panel.patch.knob.verb': 'Riv.',
  'panel.patch.knob.delayfb': 'Delay FB',
  'panel.patch.knob.duck': 'Duck',
  'panel.patch.knob.intens': 'Intens.',
  'panel.patch.knob.bpm': 'BPM',
  'panel.patch.knob.padMorph': 'Pad Mix',
  'panel.patch.knob.leadMorph': 'Lead Mix',
  'panel.patch.knob.bassMorph': 'Bass Mix',
  'panel.patch.voice.padWaveLabel': 'PAD WAVE',
  'panel.patch.voice.leadWaveLabel': 'LEAD WAVE',
  'panel.patch.voice.bassWaveLabel': 'BASS WAVE',
  'panel.patch.voice.padWaveAria': 'Forma d\'onda del pad',
  'panel.patch.voice.leadWaveAria': 'Forma d\'onda del lead',
  'panel.patch.voice.bassWaveAria': 'Forma d\'onda del basso',
  'panel.patch.voice.morphAria': 'Crossfade tra forma d\'onda selezionata e destinazione di morph',
  'panel.patch.smartOn': 'SMART',
  'panel.patch.smartOff': 'SMART OFF',
  'panel.patch.smartAria': 'Attiva/disattiva voicing intelligente',
  'panel.patch.smartTooltip': 'Voicing intelligente — sposta il timbro di ogni voce verso una scelta musicalmente sensata in base allo stato degli FX',
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

  // Calibration + tutorial wizard ------------------------------------------
  'calib.counter.calibration': 'CALIBRAZIONE',
  'calib.counter.tutorial': 'TUTORIAL',
  'calib.quit': 'Esci dalla procedura',
  'calib.skip': 'Salta',
  'calib.getReady': 'Preparati · posiziona la mano nella zona evidenziata',
  'calib.collecting': 'Sto raccogliendo · {{s}}s',
  'calib.captured': 'Acquisito ✓',
  'calib.waitingGesture': 'In attesa del gesto…',
  'calib.holding': 'Tieni la posizione…',

  // Sample steps — descrizioni pensate per l\'uso "hands-free": il wizard
  // va avanti da solo, niente click richiesti.
  'calib.position.title': 'Trova la posizione',
  'calib.position.desc': 'Metti entrambe le mani dentro la zona illuminata. Rilassate — il wizard avanza da solo.',
  'calib.vertical.title': 'Estensione verticale',
  'calib.vertical.desc': 'Segui la zona che brilla: alza le mani quando si accende in alto, abbassale quando si accende in basso. Ripeti un paio di volte.',
  'calib.horizontal.title': 'Apertura delle mani',
  'calib.horizontal.desc': 'Apri le mani verso le zone laterali, poi riavvicinale al centro. Movimento fluido.',
  'calib.shape.title': 'Apri e chiudi',
  'calib.shape.desc': 'Apri bene le dita, poi stringile a pugno. Cicla qualche volta — entrambe le mani.',
  'calib.lateral.title': 'Lato a lato',
  'calib.lateral.desc': 'Porta la mano destra prima verso la zona sinistra, poi verso la zona destra. Come un pendolo.',

  // Tutorial steps
  'tut.pitchHigh.title': 'Solleva la mano in alto',
  'tut.pitchHigh.desc': 'Porta una delle due mani verso il bordo alto del riquadro. Ascolta — il suono si schiarisce salendo.',
  'tut.pitchHigh.hint': 'Prova a spostare la mano più vicina al bordo superiore dello schermo.',
  'tut.pitchLow.title': 'Abbassa la mano',
  'tut.pitchLow.desc': 'Riportala verso il basso. Senti come la texture si ammorbidisce.',
  'tut.fist.title': 'Stringi un pugno',
  'tut.fist.desc': 'Chiudi una mano a pugno. Il filtro si chiude — perfetto per i breakdown.',
  'tut.open.title': 'Apri la mano',
  'tut.open.desc': 'Spalanca le dita. Il suono si apre — la tua mano È il cutoff.',
  'tut.mute.title': 'Silenzia con due pugni',
  'tut.mute.desc': 'Chiudi entrambe le mani a pugno insieme. L\'audio viene tagliato.',
  'tut.mute.hint': 'Assicurati che entrambi i pugni siano visibili — riapri per togliere il muto.',
  'tut.mouth.title': 'Spalanca la bocca',
  'tut.mouth.desc': 'Aprila come per cantare "AAH". Scintille volano dalle labbra e parte un flourish armonico.',
  'tut.mouth.hint': 'La camera deve vedere il viso — gira la testa verso lo schermo.',

  // Recalibrate button (SettingsPanel)
  'panel.patch.recalibrateBtn': 'Ricalibra',
  'panel.patch.recalibrateAria': 'Ripeti calibrazione e tutorial',
  'panel.patch.section.calibration': 'Calibrazione',
};

export default dict;
