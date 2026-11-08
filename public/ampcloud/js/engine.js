// Audio engine: <audio> element → preamp → 10-band EQ → analyser → volume →
// balance → speakers. The Web Audio graph is built lazily on the first user
// gesture (browsers require it). If the stream host refuses CORS, we fall back
// to a plain <audio> element: sound keeps working, EQ and visualizer don't.

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];

// iPhone/iPad: audio routed through Web Audio is muted by the silent switch and
// stops when the screen locks, so there we play the plain element (no EQ).
export const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Engine extends EventTarget {
  constructor({ useGraph = !IS_IOS } = {}) {
    super();
    this.ctx = null;
    this.graphOk = useGraph;
    this.volume = 0.8;
    this.balance = 0;
    this.eq = { on: false, preamp: 0, bands: EQ_BANDS.map(() => 0) };
    this.main = this._makeAudio(useGraph);
    this.plain = useGraph ? null : this.main;
    this.audio = this.main;
    this.freq = new Uint8Array(512);
    this.wave = new Uint8Array(1024);
  }

  _makeAudio(cors) {
    const a = new Audio();
    a.preload = 'auto';
    if (cors) a.crossOrigin = 'anonymous';
    // only the active element talks to the UI
    for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'waiting', 'playing', 'durationchange'])
      a.addEventListener(ev, () => a === this.audio && this.dispatchEvent(new Event(ev)));
    a.addEventListener('error', () => a === this.audio && this._onError(a));
    a.addEventListener('loadedmetadata', () => {
      if (a === this.plain && this._probingPlain) {
        // plain element works where the CORS one failed: the host lacks CORS
        this._probingPlain = false;
        this.graphOk = false;
        console.warn('[engine] streaming senza CORS: EQ e visualizzatore disattivati');
        this.dispatchEvent(new Event('nograph'));
      }
    });
    return a;
  }

  _onError(a) {
    const src = a.getAttribute('src');
    if (!src) return;
    if (a === this.main && this.graphOk && a.readyState === 0 && !this._retried) {
      // Could be a CORS refusal: try once with an element outside the graph.
      this._retried = true;
      this._probingPlain = true;
      this.plain = this.plain || this._makeAudio(false);
      this.plain.volume = this.volume * this.volume;
      this.audio = this.plain;
      this.plain.src = src;
      if (this._wantPlay) this.plain.play().catch(() => {});
      return;
    }
    if (a === this.plain && this._probingPlain) {
      // failed both ways: a real error, keep using the graph element
      this._probingPlain = false;
      this.audio = this.main;
    }
    this.dispatchEvent(new CustomEvent('error', { detail: a.error }));
  }

  _ensureGraph() {
    if (this.ctx || !this.graphOk) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return (this.graphOk = false);
    const ctx = (this.ctx = new AC());
    this.source = ctx.createMediaElementSource(this.main);
    this.main.volume = 1;
    this.preamp = ctx.createGain();
    this.filters = EQ_BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.gain = ctx.createGain();
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    // stereo taps for the analyzer window (oscilloscope, VU meter)
    this.splitter = ctx.createChannelSplitter(2);
    this.anL = ctx.createAnalyser();
    this.anR = ctx.createAnalyser();
    for (const a of [this.anL, this.anR]) {
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0;
    }
    this.scopeL = new Float32Array(2048);
    this.scopeR = new Float32Array(2048);
    let node = this.source.connect(this.preamp);
    for (const f of this.filters) node = node.connect(f);
    node.connect(this.analyser);
    node.connect(this.splitter);
    this.splitter.connect(this.anL, 0);
    this.splitter.connect(this.anR, 1);
    node = node.connect(this.gain);
    if (this.panner) node = node.connect(this.panner);
    node.connect(ctx.destination);
    this._applyAll();
  }

  _applyAll() {
    this.setVolume(this.volume);
    this.setBalance(this.balance);
    this.setEq(this.eq);
  }

  get hasGraph() {
    return Boolean(this.ctx) && this.graphOk && this.audio === this.main;
  }

  load(url) {
    this._retried = false;
    this._probingPlain = false;
    const next = this.graphOk ? this.main : (this.plain = this.plain || this._makeAudio(false));
    if (next !== this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.audio = next;
    this.audio.volume = next === this.main && this.ctx ? 1 : this.volume * this.volume;
    this.audio.src = url;
    this.audio.load();
  }

  /** Call straight from a tap/click handler: mobile browsers only allow
   *  playback started synchronously inside the user gesture. */
  async play() {
    this._wantPlay = true;
    this._ensureGraph();
    if (this.audio === this.main && this.ctx) this.audio.volume = 1;
    const started = this.audio.play();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    try {
      await started;
    } catch (err) {
      if (err?.name !== 'AbortError') throw err;
    }
  }

  pause() {
    this._wantPlay = false;
    this.audio.pause();
  }

  stop() {
    this._wantPlay = false;
    this.audio.pause();
    if (this.audio.src) this.audio.currentTime = 0;
    this.dispatchEvent(new Event('stop'));
  }

  seek(t) {
    if (!this.audio.src || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(t, this.audio.duration - 0.05));
  }

  get time() {
    return this.audio.currentTime || 0;
  }
  get duration() {
    const d = this.audio.duration;
    return Number.isFinite(d) ? d : 0;
  }
  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }
  get loaded() {
    return Boolean(this.audio.getAttribute('src'));
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    const g = this.volume * this.volume; // perceptual curve
    if (this.gain) this.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    if (this.audio !== this.main || !this.ctx) this.audio.volume = g;
  }

  setBalance(b) {
    this.balance = Math.max(-1, Math.min(1, b));
    if (this.panner) this.panner.pan.setTargetAtTime(this.balance, this.ctx.currentTime, 0.01);
  }

  setEq(eq) {
    this.eq = { on: eq.on, preamp: eq.preamp, bands: [...eq.bands] };
    if (!this.filters) return;
    const t = this.ctx.currentTime;
    const db2gain = (db) => Math.pow(10, db / 20);
    this.preamp.gain.setTargetAtTime(eq.on ? db2gain(eq.preamp) : 1, t, 0.02);
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(eq.on ? eq.bands[i] : 0, t, 0.02));
  }

  /** Fill `out` (length n) with 0..1 band levels, log-spaced. Returns false without data. */
  spectrum(out) {
    if (!this.hasGraph || !this.playing) return false;
    this.analyser.getByteFrequencyData(this.freq);
    const n = out.length;
    const bins = this.freq.length;
    const sr = this.ctx.sampleRate;
    const fMin = 40;
    const fMax = Math.min(16000, sr / 2);
    for (let i = 0; i < n; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / n);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / n);
      const b0 = Math.max(0, Math.floor((f0 / (sr / 2)) * bins));
      const b1 = Math.max(b0 + 1, Math.ceil((f1 / (sr / 2)) * bins));
      let m = 0;
      for (let b = b0; b < b1 && b < bins; b++) m = Math.max(m, this.freq[b]);
      out[i] = m / 255;
    }
    return true;
  }

  /** Last ~46 ms of left/right samples (post-EQ), or null without the graph. */
  scope() {
    if (!this.hasGraph || !this.anL) return null;
    this.anL.getFloatTimeDomainData(this.scopeL);
    this.anR.getFloatTimeDomainData(this.scopeR);
    return { l: this.scopeL, r: this.scopeR, sampleRate: this.ctx.sampleRate };
  }

  waveform() {
    if (!this.hasGraph || !this.playing) return null;
    this.analyser.getByteTimeDomainData(this.wave);
    return this.wave;
  }
}
