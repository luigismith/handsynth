// Owner: visualizer
//
// p5.js (instance mode) FFT-driven visualization. Reads the AudioEngine's
// master analyser, optionally syncs to MusicBrain `onBeat`, and draws hand
// silhouettes + face skeleton + elastic beat-pulsing strings using the
// HandTracker's gesture state and the (optional) FaceTracker's face state.
//
// MOUNT STRATEGY (option "a" from the brief)
// ------------------------------------------
// The Visualizer interface receives an `<canvas>` element. p5 instance mode
// works most reliably when given a parent DOM element and allowed to manage
// its own internal canvas. Rather than fight p5, we:
//   1. Read `canvas.parentElement` (the existing canvas-host container in
//      `index.html`).
//   2. Hide the placeholder `<canvas>` (display:none) so p5's fresh canvas
//      becomes visible. We never remove it — that's ux-curator's DOM and
//      `unmount()` should be reversible.
//   3. Let p5 append its own canvas to the parent.
//
// FACE PARAMETER (extension to the contract)
// ------------------------------------------
// `mount()` accepts an optional `face` dependency. The orchestrator should
// pass the FaceTracker if face tracking initialised successfully. When
// present, the Visualizer subscribes to `face:update` and forwards the
// state into the sketch, which renders a face skeleton + fake-arm
// connectors. When absent, the visualizer behaves identically to the
// hands-only legacy. The contract `Visualizer.mount` declares only
// `{ audio, hands, music }` — passing `face` is a runtime extension that
// older callers can safely ignore.

import p5 from 'p5';
import type {
  AudioEngine,
  FaceState,
  FaceTracker,
  FaceTrackerEvents,
  GestureState,
  HandTracker,
  HandTrackerEvents,
  MusicBrain,
  MusicBrainEvents,
  Visualizer,
} from '@contracts/contracts';
import { createSketch, type SketchHandle, type SketchState } from './sketch';

const FFT_SIZE = 1024;

// HMR / dev-only zombie marker. If a previous instance mounted on `window`
// without unmounting (e.g. Vite HMR replaced the module mid-frame), we log
// a warning so devs notice rAF zombies before the FPS hint dies.
const HMR_MARKER = '__hsVisualMounted';
interface HMRWindow {
  [HMR_MARKER]?: number;
}

export class VisualizerImpl implements Visualizer {
  private mounted = false;
  private sketch: SketchHandle | null = null;

  // Dependencies, kept so unmount can detach.
  private audio: AudioEngine | null = null;
  private hands: HandTracker | null = null;
  private music: MusicBrain | null = null;
  private face: FaceTracker | null = null;

  private analyser: AnalyserNode | null = null;
  // Explicit ArrayBuffer-backed Uint8Array — newer DOM lib types require this
  // exact variant for AnalyserNode.getByteFrequencyData (which rejects
  // SharedArrayBuffer-backed views).
  private fftBins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(FFT_SIZE));

  // Mounted state shared with the sketch (mutable reference).
  private state: SketchState = {
    hands: [],
    face: null,
    videoCover: null,
    pulse: 0,
    fftBins: this.fftBins,
    hasAnalyser: false,
    reducedMotion: false,
  };

  /**
   * Compute the video-to-canvas cover transform from the <video>'s intrinsic
   * dimensions (videoWidth, videoHeight) and the current canvas size. The
   * <video> uses CSS `object-fit: cover` which scales the video to fill the
   * canvas without distortion, cropping whichever dimension is over-scaled.
   * To make the face skeleton land on the visible face we need to undo
   * that cover crop when mapping landmark y (and x) to canvas-normalized
   * coords.
   */
  private updateVideoCover(): void {
    const v = document.getElementById('webcam') as HTMLVideoElement | null;
    if (!v || !v.videoWidth || !v.videoHeight) {
      this.state.videoCover = null;
      return;
    }
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    if (cw <= 0 || ch <= 0) {
      this.state.videoCover = null;
      return;
    }
    const videoAspect = v.videoWidth / v.videoHeight;
    const canvasAspect = cw / ch;
    let dispW: number;
    let dispH: number;
    if (videoAspect > canvasAspect) {
      // Video is wider than canvas → height fills, width overflows.
      dispH = ch;
      dispW = ch * videoAspect;
    } else {
      // Video is taller than canvas → width fills, height overflows.
      dispW = cw;
      dispH = cw / videoAspect;
    }
    const offsetX = (cw - dispW) / 2 / cw;
    const offsetY = (ch - dispH) / 2 / ch;
    const scaleX = dispW / cw;
    const scaleY = dispH / ch;
    this.state.videoCover = { scaleX, scaleY, offsetX, offsetY };
  }

  // OS-level reduced-motion preference query and listener (kept so we can
  // remove the listener on unmount).
  private reducedMotionMql: MediaQueryList | null = null;
  private reducedMotionListener: ((e: MediaQueryListEvent) => void) | null = null;

  // Listener references — needed for off().
  private gestureUpdateHandler: HandTrackerEvents['gesture:update'] | null = null;
  private faceUpdateHandler: FaceTrackerEvents['face:update'] | null = null;
  private musicEvents: MusicBrainEvents | null = null;
  private resizeHandler: (() => void) | null = null;

  // Hidden placeholder canvas, restored on unmount.
  private hiddenPlaceholder: HTMLCanvasElement | null = null;
  private placeholderPrevDisplay: string | null = null;

  // Wraps the FFT pull so we can substitute it during tests.
  private rafHandle: number | null = null;

  /**
   * Mount the sketch with its dependencies.
   *
   * Concrete signature widens the {@link Visualizer.mount} contract with an
   * optional `face` dependency — see the file header. The orchestrator
   * (main.ts) is expected to pass `{ audio, hands, music, face }` when face
   * tracking is live.
   */
  mount(
    canvas: HTMLCanvasElement,
    deps: { audio: AudioEngine; hands: HandTracker; music: MusicBrain; face?: FaceTracker },
  ): void {
    if (this.mounted) {
      // Idempotent — already mounted.
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) {
      throw new Error(
        '[Visualizer] mount(): provided canvas has no parentElement; ' +
          'wrap the canvas in a container element (see index.html).',
      );
    }

    // HMR safety: warn if a prior mount didn't tear down. Vite's HMR
    // replaces the module but cannot cancel rAF callbacks bound by the
    // previous instance — those zombies keep running and pile up FFT pulls
    // every frame.
    try {
      if (typeof window !== 'undefined') {
        const w = window as unknown as HMRWindow;
        const prev = w[HMR_MARKER] ?? 0;
        if (prev > 0) {
          console.warn(
            '[Visualizer] HMR zombie detected — ' +
              `${prev} prior instance(s) on window. Reload the page if FPS drops.`,
          );
        }
        w[HMR_MARKER] = prev + 1;
      }
    } catch {
      // Window may be locked-down (e.g. cross-origin iframe); ignore.
    }

    this.mounted = true;
    this.audio = deps.audio;
    this.hands = deps.hands;
    this.music = deps.music;
    this.face = deps.face ?? null;

    // Hide the placeholder so p5's fresh canvas is what the user sees.
    this.hiddenPlaceholder = canvas;
    this.placeholderPrevDisplay = canvas.style.display;
    canvas.style.display = 'none';

    // Detect prefers-reduced-motion at startup and listen for changes.
    // Wrapped in try/catch because matchMedia isn't available in all test
    // environments (e.g. node), and we want the visualizer to still mount.
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        this.reducedMotionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.state.reducedMotion = this.reducedMotionMql.matches;
        this.reducedMotionListener = (e: MediaQueryListEvent): void => {
          this.state.reducedMotion = e.matches;
        };
        // Use addEventListener (preferred over deprecated addListener).
        this.reducedMotionMql.addEventListener('change', this.reducedMotionListener);
      }
    } catch (err) {
      console.warn('[Visualizer] reduced-motion detection skipped:', err);
    }

    // Tap the master analyser. Defensive: AudioEngine may not be initialized
    // yet; we still want the visual layer to look alive without audio. In
    // that case fftBins stays at zeros and the particle field uses its
    // ambient seed only.
    try {
      if (deps.audio.isReady && deps.audio.isReady()) {
        this.analyser = deps.audio.getAnalyser();
        this.analyser.fftSize = FFT_SIZE * 2; // bin count = fftSize/2
        const binCount = this.analyser.frequencyBinCount;
        if (binCount !== this.fftBins.length) {
          this.fftBins = new Uint8Array(new ArrayBuffer(binCount));
          this.state.fftBins = this.fftBins;
        }
        this.state.hasAnalyser = true;
      }
    } catch (err) {
      // Audio not ready — that's fine, we degrade gracefully.
      console.warn('[Visualizer] analyser tap skipped:', err);
    }

    // Subscribe to gesture updates.
    this.gestureUpdateHandler = (gestureState: GestureState): void => {
      this.state.hands = gestureState.hands;
    };
    deps.hands.on('gesture:update', this.gestureUpdateHandler);

    // Subscribe to face updates if a tracker was provided.
    if (this.face) {
      this.faceUpdateHandler = (faceState: FaceState): void => {
        this.state.face = faceState;
      };
      this.face.on('face:update', this.faceUpdateHandler);
    }

    // Subscribe to musical beats. MusicBrain.on takes the full events
    // object — we provide an object with only `onBeat` filled in (the
    // others are required by the type, but stubs are harmless because
    // MusicBrain will overwrite earlier subscribers if it's a single-slot
    // emitter… actually `on()` accumulates per the MusicBrain doc, but to
    // be safe we provide stubs).
    this.musicEvents = {
      onLead: (): void => undefined,
      onBass: (): void => undefined,
      onChord: (): void => undefined,
      onKick: (): void => undefined,
      onHat: (): void => undefined,
      onPerc: (): void => undefined,
      onBeat: (_beat: number): void => {
        this.state.pulse = 1.0;
      },
    };
    deps.music.on(this.musicEvents);

    // Resize handler.
    this.resizeHandler = (): void => {
      if (!this.sketch) return;
      const w = parent.clientWidth || window.innerWidth;
      const h = parent.clientHeight || window.innerHeight;
      this.sketch.resize(w, h);
      this.updateVideoCover();
    };
    window.addEventListener('resize', this.resizeHandler);

    // Initial cover compute (videoWidth may be 0 until loadedmetadata fires).
    this.updateVideoCover();
    const v = document.getElementById('webcam') as HTMLVideoElement | null;
    if (v) {
      v.addEventListener('loadedmetadata', () => this.updateVideoCover(), { once: true });
      v.addEventListener('resize', () => this.updateVideoCover());
    }

    // Pull FFT data each animation frame. We use rAF here (not p5's draw
    // hook) so the pull is decoupled from the render loop — if the canvas
    // is hidden (tab in background), browsers throttle rAF anyway.
    //
    // PERF: we check `this.mounted` BEFORE scheduling the next frame so a
    // late-arriving callback after unmount() doesn't queue a new rAF.
    // Without this guard HMR cycles can leave dangling rAF chains.
    const pullFFT = (): void => {
      if (!this.mounted) return;
      this.rafHandle = requestAnimationFrame(pullFFT);
      if (this.analyser) {
        try {
          this.analyser.getByteFrequencyData(this.fftBins);
        } catch {
          // Analyser may have been disconnected; ignore.
        }
      } else if (this.audio && this.audio.isReady && this.audio.isReady()) {
        // Audio became ready after mount. Tap now.
        try {
          this.analyser = this.audio.getAnalyser();
          this.analyser.fftSize = FFT_SIZE * 2;
          const binCount = this.analyser.frequencyBinCount;
          if (binCount !== this.fftBins.length) {
            this.fftBins = new Uint8Array(new ArrayBuffer(binCount));
            this.state.fftBins = this.fftBins;
          }
          this.state.hasAnalyser = true;
        } catch {
          // Still not ready — try again next frame.
        }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      this.rafHandle = requestAnimationFrame(pullFFT);
    }

    // Boot the sketch. If p5 fails to instantiate (e.g. under happy-dom in
    // tests, or a hostile environment), swallow the error here — listeners
    // and resize handler are already wired, and unmount() will clean them up.
    try {
      this.sketch = createSketch(p5, parent, this.state);
      // No CSS mirror on the canvas: HandTracker x-mirrors landmarks on
      // output, so the skeleton coordinates already live in the same
      // selfie-mirrored frame as the (CSS-flipped) <video>. Drawing them on
      // an un-flipped canvas keeps the overlay aligned. FaceTracker uses
      // the same convention.
    } catch (err) {
      console.warn('[Visualizer] p5 sketch failed to boot:', err);
      this.sketch = null;
    }
  }

  unmount(): void {
    if (!this.mounted) {
      // Idempotent — already unmounted (or never mounted).
      return;
    }
    this.mounted = false;

    // Tear down sketch (may be null if mount partially failed).
    if (this.sketch) {
      try {
        this.sketch.instance.remove();
      } catch (err) {
        console.warn('[Visualizer] sketch.remove() threw:', err);
      }
      this.sketch = null;
    }

    // Detach event listeners.
    if (this.hands && this.gestureUpdateHandler) {
      this.hands.off('gesture:update', this.gestureUpdateHandler);
    }
    this.gestureUpdateHandler = null;

    if (this.face && this.faceUpdateHandler) {
      this.face.off('face:update', this.faceUpdateHandler);
    }
    this.faceUpdateHandler = null;

    if (this.music && this.musicEvents) {
      this.music.off(this.musicEvents);
    }
    this.musicEvents = null;

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Detach reduced-motion listener.
    if (this.reducedMotionMql && this.reducedMotionListener) {
      try {
        this.reducedMotionMql.removeEventListener('change', this.reducedMotionListener);
      } catch {
        // Older Safari may not support removeEventListener on MQLs; ignore.
      }
    }
    this.reducedMotionMql = null;
    this.reducedMotionListener = null;

    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = null;

    // Restore the placeholder canvas (don't leak DOM state).
    if (this.hiddenPlaceholder) {
      this.hiddenPlaceholder.style.display = this.placeholderPrevDisplay ?? '';
      this.hiddenPlaceholder = null;
      this.placeholderPrevDisplay = null;
    }

    this.analyser = null;
    this.audio = null;
    this.hands = null;
    this.music = null;
    this.face = null;

    // Reset shared state so a future mount starts clean.
    this.state.hands = [];
    this.state.face = null;
    this.state.pulse = 0;
    this.state.hasAnalyser = false;
    this.state.reducedMotion = false;
    // Keep the same Uint8Array reference, just zero it.
    this.fftBins.fill(0);

    // Decrement the HMR marker so re-mount in the same window doesn't
    // perpetually warn.
    try {
      if (typeof window !== 'undefined') {
        const w = window as unknown as HMRWindow;
        const prev = w[HMR_MARKER] ?? 0;
        w[HMR_MARKER] = Math.max(0, prev - 1);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Manual override for the reduced-motion accessibility mode. Concrete
   * extension to the {@link Visualizer} interface — UX-curator may call
   * this from a settings toggle. Calling this does NOT detach the
   * `prefers-reduced-motion` media query listener; it just overrides the
   * current value. The next OS-level change will overwrite it again.
   */
  setReducedMotion(reduced: boolean): void {
    this.state.reducedMotion = reduced;
  }
}
