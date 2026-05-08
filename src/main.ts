// Owner: ux-curator
//
// Application entry point. Lifecycle (per ARCHITECTURE.md §3):
//
//   1. Page load: construct subsystems (cheap, no audio, no webcam).
//   2. Onboarding card asks for the single user-gesture click.
//   3. Inside that click handler:
//        - audio.init()       (Tone.start unlocks AudioContext)
//        - audio.loadVibe()   (apply default vibe presets)
//        - hands.init()       (getUserMedia + MediaPipe model fetch)
//          on success → mapper attaches & starts; music starts.
//          on failure → autopilot mode (synthetic gestures), warning toast.
//   4. Visualizer mounts last (audio analyser is now ready).
//   5. VibeSelector reveals; clicks call mapper.setVibe — the engines own
//      the crossfade.
//   6. Visibility / unload: resume context on focus; stop+unmount on unload.
//
// We deliberately avoid trying to crossfade or smooth in UI code: the
// AudioEngine ramps params, MusicBrain ramps BPM. We just call setVibe.

import * as Tone from 'tone';
import { AudioEngineImpl } from '@audio/AudioEngine';
import { HandTrackerImpl } from '@hands/HandTracker';
import { MusicBrainImpl } from '@music/MusicBrain';
import { InteractionMapperImpl } from '@interaction/InteractionMapper';
import { VisualizerImpl } from '@visual/Visualizer';
import { FaceTrackerImpl } from '@face/FaceTracker';
import { VIBES, DEFAULT_VIBE, VIBE_LIST } from '@presets/vibes';
import type { VibeId } from '@contracts/contracts';
import { OnboardingImpl } from '@ui/Onboarding';
import { VibeSelectorImpl } from '@ui/VibeSelector';
import { ErrorOverlayImpl } from '@ui/ErrorOverlay';
import { SettingsPanelImpl } from '@ui/SettingsPanel';
import { TerminalImpl } from '@ui/Terminal';
import { HelpPanelImpl } from '@ui/HelpPanel';
import { HudControlsImpl } from '@ui/HudControls';
import { injectStyles } from '@ui/styles';
import { getLang, t as tt } from './i18n';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[main] missing DOM node #${id}`);
  return el;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

async function bootstrap(): Promise<void> {
  injectStyles();

  // i18n: detection happens automatically when the i18n module loads (it
  // pre-computes a starting Lang from localStorage / navigator.language at
  // import time). Sync the <html lang> attribute so screen readers and the
  // browser's reading-mode pick the right language hint right away.
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = getLang();
  }

  // Reduced-motion hint for the visualizer (it's free to read this attr later).
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) document.body.dataset.reducedMotion = 'true';

  // DOM hosts.
  const canvas = $('visualizer') as HTMLCanvasElement;
  const video = $('webcam') as HTMLVideoElement;
  const onboardingHost = $('onboarding');
  const vibeHost = $('vibe-selector');
  const errorHost = $('error-overlay');

  // UI modules.
  const onboarding = new OnboardingImpl();
  const vibeSelector = new VibeSelectorImpl();
  const errorOverlay = new ErrorOverlayImpl();
  errorOverlay.mount(errorHost);

  // Subsystem modules.
  const audio = new AudioEngineImpl();
  const music = new MusicBrainImpl();
  const hands = new HandTrackerImpl();
  const face = new FaceTrackerImpl();
  const mapper = new InteractionMapperImpl();
  const visual = new VisualizerImpl();

  // Phase 1: onboarding waits for the click.
  onboarding.mount(onboardingHost);

  // Phase 2: try to start the full stack. If anything user-recoverable
  // fails we re-prompt (showError + awaitStart returns a fresh promise).
  let started = false;
  while (!started) {
    await onboarding.awaitStart();
    try {
      await startSession({
        audio,
        music,
        hands,
        face,
        mapper,
        visual,
        videoEl: video,
        canvasEl: canvas,
        onAutopilotEngaged: (msg) => errorOverlay.showWarning(msg),
      });
      started = true;
    } catch (err) {
      console.error('[main] startup failed', err);
      const msg =
        err instanceof Error ? err.message : tt('error.startupFailed');
      onboarding.showError(`${msg}`);
      // Loop continues; awaitStart() will resolve again on next click.
    }
  }

  onboarding.unmount();

  // Track current vibe for the settings panel readback.
  let currentVibeId: VibeId = DEFAULT_VIBE;

  // Phase 3: reveal the vibe selector.
  vibeSelector.mount(vibeHost, VIBE_LIST.slice() as Array<typeof VIBE_LIST[number]>, DEFAULT_VIBE);
  vibeSelector.onChange((id: VibeId) => {
    currentVibeId = id;
    mapper.setVibe(VIBES[id]);
  });
  vibeHost.removeAttribute('hidden');

  // Phase 3.5: SettingsPanel is the single control surface. The previous
  // DebugPanel ('controls' pill) was a duplicate of the same parameters
  // and confused users — removed. SettingsPanel ("PATCH", gear icon)
  // exposes everything it had plus the patch save/load system.
  const uiLayer = $('ui-layer');
  void uiLayer;

  // Phase 3.6: analog-synth-style Settings (patches) panel + Terminal HUD.
  const settingsHost = $('settings-host');
  const terminalHost = $('terminal-host');

  const settings = new SettingsPanelImpl();
  settings.mount(settingsHost, {
    audio,
    music,
    setVibe: (id: VibeId) => {
      currentVibeId = id;
      mapper.setVibe(VIBES[id]);
      vibeSelector.setActive(id);
    },
    setManualIntensity: (v: number | null) => mapper.setManualIntensity(v),
    getCurrentVibeId: () => currentVibeId,
    getCurrentParams: () => ({ bpm: Tone.getTransport().bpm.value }),
  });

  const terminal = new TerminalImpl();
  terminal.mount(terminalHost, {
    music,
    audio,
    hands,
    getMapperState: () => ({
      intensity: mapper.getCurrentIntensity(),
      mood: mapper.getCurrentMood(),
      bpm: Tone.getTransport().bpm.value,
    }),
  });

  // Phase 3.7: in-app manual + bottom-right HUD controls. Help panel renders
  // USER_MANUAL.md (imported via Vite ?raw); the HUD strip surfaces three
  // tiny icons for STOP / TERMINAL / HELP that mirror the keyboard
  // shortcuts (Esc / t / h | F1). All shortcut keys are letters or
  // function/control keys so they remain reachable on every international
  // keyboard layout (no symbol keys whose position varies per layout).
  const helpHost = $('help-host');
  const hudHost = $('hud-controls-host');

  const help = new HelpPanelImpl();
  help.mount(helpHost);

  // Track terminal visibility locally so the HUD's terminal button can flip
  // it. The Terminal owns the actual visibility state — we just remember
  // what we last asked for so the icon's click toggles correctly even when
  // the user used the 't' key in between.
  let terminalVisible = false;

  // Track mute state locally (AudioEngine doesn't emit mute events). HUD
  // owns its own copy too — we keep them in sync via setMuted().
  let isMuted = false;

  const hud = new HudControlsImpl();
  hud.mount(hudHost, {
    audio,
    toggleTerminal: () => {
      terminalVisible = !terminalVisible;
      terminal.setVisible(terminalVisible);
    },
    toggleHelp: () => help.setVisible(!help.isVisible()),
  });

  // Global key bindings for the new icons. The HelpPanel handles F1 / h /
  // Esc-while-open itself; we only intercept Escape-as-mute (when help is
  // closed) here.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape' && !help.isVisible()) {
      isMuted = !isMuted;
      audio.setMute(isMuted);
      hud.setMuted(isMuted);
      e.preventDefault();
    }
  });

  // Sync HUD's terminal-visibility tracking with the user's 't' key
  // toggles by listening on the same key. We only flip our cached boolean;
  // the Terminal already toggled itself in response to the same event.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (isTypingTarget(e.target)) return;
    if (e.key.toLowerCase() === 't') {
      terminalVisible = !terminalVisible;
    }
  });

  // Mirror toggle: 'm' key flips the selfie mirror on the <video> + the
  // HandTracker data flip + the FaceTracker mirror. Use this if the visible
  // webcam image and the skeleton/face overlay show on opposite sides
  // (typical when the user's webcam is already native-mirrored at the OS or
  // virtual-cam level).
  let mirrorOn = true;
  const applyMirror = (on: boolean): void => {
    mirrorOn = on;
    video.style.transform = on ? 'scaleX(-1)' : 'none';
    // HandTracker exposes setMirror; FaceTracker may too (if not, no-op).
    interface MirrorAware { setMirror?: (on: boolean) => void }
    (hands as unknown as MirrorAware).setMirror?.(on);
    (face as unknown as MirrorAware).setMirror?.(on);
    console.info('[mirror] selfie mirror =', on);
  };
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm' && !isTypingTarget(e.target)) {
      applyMirror(!mirrorOn);
      e.preventDefault();
    }
  });

  // Periodic context-resume tick. Some browsers (especially Safari) silently
  // suspend the AudioContext after a few seconds of low activity. The
  // visibilitychange listener catches the obvious case; this catches the
  // subtler ones. Cheap (no-op when context is already running).
  const resumeTimer = window.setInterval(() => {
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') {
      void ctx.resume().then(() => {
        console.info('[heartbeat] context resumed (was', ctx.state, ')');
      });
    }
  }, 1500);

  // Phase 4: visibility + cleanup.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void Tone.getContext().resume();
    }
  });
  window.addEventListener('beforeunload', () => {
    try {
      mapper.stop();
    } catch {
      /* noop */
    }
    try {
      music.stop();
    } catch {
      /* noop */
    }
    try {
      face.stop();
    } catch {
      /* noop */
    }
    try {
      hands.stop();
    } catch {
      /* noop */
    }
    try {
      visual.unmount();
    } catch {
      /* noop */
    }
    try {
      settings.unmount();
    } catch {
      /* noop */
    }
    try {
      terminal.unmount();
    } catch {
      /* noop */
    }
    try {
      help.unmount();
    } catch {
      /* noop */
    }
    try {
      hud.unmount();
    } catch {
      /* noop */
    }
    clearInterval(resumeTimer);
  });
}

interface StartSessionDeps {
  audio: AudioEngineImpl;
  music: MusicBrainImpl;
  hands: HandTrackerImpl;
  face: FaceTrackerImpl;
  mapper: InteractionMapperImpl;
  visual: VisualizerImpl;
  videoEl: HTMLVideoElement;
  canvasEl: HTMLCanvasElement;
  onAutopilotEngaged: (message: string) => void;
}

/**
 * Runs inside the onboarding-button gesture context.
 *
 * Order matters:
 *  1. audio.init() first — Tone.start() needs the user gesture window
 *     and the visualizer wants the analyser ready before it mounts.
 *  2. audio.loadVibe() seeds the FX chain so the first triggered chord
 *     hits a tuned voice.
 *  3. mapper.attach(...) before mapper.start(): the InteractionMapper
 *     hard-fails if start() is called before deps are wired.
 *  4. Hand init may throw (permission denied / model fetch failed). On
 *     throw we still produce music via mapper.startAutopilot().
 */
async function startSession(deps: StartSessionDeps): Promise<void> {
  const { audio, music, hands, face, mapper, visual, videoEl, canvasEl } = deps;
  const initialVibe = VIBES[DEFAULT_VIBE];

  // 1. Audio (must run inside user-gesture stack)
  console.info('[boot] starting audio…');
  await audio.init();
  // Belt-and-suspenders: explicit resume() in case the context started
  // suspended despite the user-gesture context (some Safari builds).
  try {
    await Tone.getContext().resume();
  } catch (e) {
    console.warn('[boot] context.resume() failed', e);
  }
  audio.loadVibe(initialVibe);
  console.info(
    '[boot] audio ready · context state:',
    Tone.getContext().state,
    '· isReady:',
    audio.isReady(),
  );

  // 2. Hand tracking — best-effort. Failure → autopilot.
  let handsLive = false;
  try {
    await hands.init(videoEl);
    hands.start();
    handsLive = true;
    console.info('[boot] hand tracking live');
  } catch (err) {
    console.warn(
      '[boot] hand tracking unavailable, falling back to autopilot:',
      err,
    );
  }

  // 2b. Face tracking — second modality, shares the same <video>. Best-effort.
  //     Only attempted if hands succeeded (we know the webcam stream is good).
  let faceLive = false;
  if (handsLive) {
    try {
      await face.init(videoEl);
      face.start();
      faceLive = true;
      console.info('[boot] face tracking live');
    } catch (err) {
      console.warn('[boot] face tracking unavailable:', err);
    }
  }

  // 3. Mapper attach — face is optional; mapper tolerates absence.
  //    The InteractionMapper internally constructs a GestureInterpreter
  //    on start() and feeds it the per-frame Hand snapshots; discrete
  //    gestures (point / peace / rock_on / ok / finger_gun / thumbs_up /
  //    thumbs_down / three / four / call_me / snap / swipe / fist_pump /
  //    wave) are routed to musical actions inside the mapper. No extra
  //    wiring is needed at this layer — see InteractionMapper.ts for the
  //    full mapping table.
  mapper.attach({ audio, music, hands, face: faceLive ? face : undefined });
  mapper.setVibe(initialVibe);

  // 4. Wire mapper → music BEFORE music starts emitting events. This
  //    ensures the very first scheduled chord (fired inside music.start())
  //    reaches AudioEngine via the InteractionMapper subscription instead
  //    of being lost to the console-log fallback.
  mapper.start();
  music.start();

  // Apply any persisted user override of key + scale BEFORE the first chord
  // re-schedules. The SettingsPanel mounts later (Phase 3.6) and would
  // re-apply the same value via setScale; doing it here too means the user
  // never hears a single bar in the wrong key when they reload the page.
  try {
    const raw = localStorage.getItem('hs.musicSettings');
    if (raw) {
      const parsed = JSON.parse(raw) as { key?: unknown; mode?: unknown };
      if (
        typeof parsed.key === 'string' &&
        typeof parsed.mode === 'string'
      ) {
        music.setScale(parsed.key, parsed.mode);
      }
    }
  } catch {
    /* localStorage may be denied / corrupted — silently ignore */
  }

  console.info(
    '[boot] music + mapper running · transport bpm:',
    Tone.getTransport().bpm.value,
    '· transport state:',
    Tone.getTransport().state,
  );

  if (!handsLive) {
    mapper.startAutopilot();
    deps.onAutopilotEngaged(tt('error.autopilot'));
  }

  // 5. Visualizer mounts last so analyser tap is hot. Face is optional —
  // visualizer tolerates absence (falls back to hands-only rendering).
  visual.mount(canvasEl, { audio, hands, music, face: faceLive ? face : undefined });

  // DEV-ONLY: expose subsystems on window so DevTools / Claude Preview can
  // probe live state. HMR safety: if we already subscribed in a previous
  // module load, OFF the old subscription before adding a new one — without
  // this, every HMR reload of main.ts piles another counter subscriber on
  // MusicBrain's Set, and after a few minutes the per-event fanout starts
  // burning real CPU. The dev exposure stays idempotent.
  if (import.meta.env?.DEV) {
    interface DebugWindow {
      __hs?: Record<string, unknown> & { _counterSubscription?: object };
    }
    const w = window as unknown as DebugWindow;
    if (w.__hs?._counterSubscription) {
      try { music.off(w.__hs._counterSubscription as never); } catch { /* noop */ }
    }
    const counters = { lead: 0, bass: 0, chord: 0, kick: 0, hat: 0, perc: 0, beat: 0 };
    const counterSub = {
      onLead: () => { counters.lead += 1; },
      onBass: () => { counters.bass += 1; },
      onChord: () => { counters.chord += 1; },
      onKick: () => { counters.kick += 1; },
      onHat: () => { counters.hat += 1; },
      onPerc: () => { counters.perc += 1; },
      onBeat: () => { counters.beat += 1; },
    };
    music.on(counterSub);
    w.__hs = { audio, music, hands, mapper, visual, face, Tone, counters, _counterSubscription: counterSub };
  }

  // 6. Smoke test — schedule a quiet pad chord 200ms in so the user gets
  //    immediate audible feedback even before MusicBrain's first beat.
  setTimeout(() => {
    try {
      audio.triggerChord({
        notes: ['C4', 'E4', 'G4'],
        duration: '2n',
        time: '+0.05',
      });
      console.info('[boot] test chord fired');
    } catch (e) {
      console.warn('[boot] test chord failed', e);
    }
  }, 200);
}

void bootstrap();
