// In-browser conversion to MP3 for files Supabase's free plan won't take
// (over 50 MB, typically WAV masters) and for AIFF, which most browsers can't
// play back. Decodes with Web Audio, encodes with LAME (lamejs, LGPL, loaded
// on demand from vendor/).

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const CONVERT_ONLY = ['aif', 'aiff'];
const MP3_RATES = [320, 256, 224, 192, 160, 128, 112, 96, 80, 64];
const SAMPLE_RATE = 44100;

let lameLoading = null;
function loadLame() {
  if (window.lamejs?.Mp3Encoder) return Promise.resolve();
  lameLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/lame-1.2.1.min.js';
    s.onload = () => (window.lamejs?.Mp3Encoder ? resolve() : reject(new Error('Encoder MP3 non disponibile')));
    s.onerror = () => {
      lameLoading = null;
      reject(new Error('Impossibile scaricare l’encoder MP3'));
    };
    document.head.append(s);
  });
  return lameLoading;
}

/** Target for every upload: small files that still sound good. */
export const TARGET_KBPS = 64;
/** MP3s at or below this bitrate are uploaded as they are (no re-encode). */
const KEEP_MP3_UP_TO = 80;

/** Compress unless the file is already a light MP3. `meta.bitrate` is the
 *  average kbps measured from size and duration. */
export function needsConversion(file, meta = {}) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (CONVERT_ONLY.includes(ext) || file.size > MAX_UPLOAD_BYTES) return true;
  if (ext !== 'mp3') return true;
  return !(meta.bitrate > 0 && meta.bitrate <= KEEP_MP3_UP_TO);
}

/** Can the original go up unchanged if the browser can't decode it? */
export const canUploadAsIs = (file) =>
  !CONVERT_ONLY.includes((file.name.split('.').pop() || '').toLowerCase()) && file.size <= MAX_UPLOAD_BYTES;

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/**
 * Convert an audio File to MP3. Picks the highest standard bitrate that keeps
 * the result under the upload limit. Returns {file, duration, bitrate,
 * sampleRate, channels}.
 */
export async function toMp3(file, onProgress = () => {}) {
  await loadLame();
  onProgress(0, 'decode');
  const data = await file.arrayBuffer();
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(2, 1, SAMPLE_RATE);
  let audio;
  try {
    audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p?.then) p.then(resolve, reject);
    });
  } catch {
    throw new Error('Questo browser non riesce a leggere il file: esportalo in WAV o MP3 (o prova con Safari)');
  }
  const channels = Math.min(2, audio.numberOfChannels);
  const duration = audio.duration;
  // highest bitrate that fits, with 3% margin for headers / padding
  const budgetKbps = ((MAX_UPLOAD_BYTES * 0.97 * 8) / duration / 1000) | 0;
  // mono needs about two thirds of the stereo bitrate for the same quality
  const want = channels === 1 ? 48 : TARGET_KBPS;
  const bitrate = MP3_RATES.find((r) => r <= Math.min(want, budgetKbps));
  if (!bitrate) throw new Error('Brano troppo lungo per stare in 50 MB anche come MP3');

  const enc = new window.lamejs.Mp3Encoder(channels, SAMPLE_RATE, bitrate);
  const left = audio.getChannelData(0);
  const right = channels > 1 ? audio.getChannelData(1) : null;
  const total = left.length;
  const BLOCK = 1152 * 20;
  const l16 = new Int16Array(BLOCK);
  const r16 = new Int16Array(BLOCK);
  const parts = [];
  const to16 = (src, dst, from, n) => {
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, src[from + i]));
      dst[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  };
  let lastYield = performance.now();
  for (let i = 0; i < total; i += BLOCK) {
    const n = Math.min(BLOCK, total - i);
    to16(left, l16, i, n);
    if (right) to16(right, r16, i, n);
    const out = right
      ? enc.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n))
      : enc.encodeBuffer(l16.subarray(0, n));
    if (out.length) parts.push(new Uint8Array(out));
    if (performance.now() - lastYield > 50) {
      onProgress(i / total, 'encode');
      await yieldToUi();
      lastYield = performance.now();
    }
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress(1, 'encode');
  const name = file.name.replace(/\.[^.]+$/, '') + '.mp3';
  const mp3 = new File(parts, name, { type: 'audio/mpeg' });
  if (mp3.size > MAX_UPLOAD_BYTES) throw new Error('Anche convertito in MP3 supera i 50 MB');
  return { file: mp3, duration, bitrate, sampleRate: SAMPLE_RATE, channels };
}

// ---------------------------------------------------------------------------
// Library compression (admin tool): decode on the main thread, encode in a
// pool of Web Workers so several tracks are processed at once.
// ---------------------------------------------------------------------------

/** Decode any browser-supported audio to 44.1 kHz PCM (AudioBuffer). */
export async function decodeAudio(arrayBuffer) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(2, 1, SAMPLE_RATE);
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p?.then) p.then(resolve, reject);
  });
}

const toInt16 = (f32) => {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = f32[i] < -1 ? -1 : f32[i] > 1 ? 1 : f32[i];
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

export class EncoderPool {
  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.waiting = [];
    this.jobs = new Map();
    this.nextId = 1;
  }

  _spawn() {
    const w = new Worker(new URL('./encoder-worker.js?v=1.5.0', import.meta.url));
    w.onmessage = (e) => {
      const job = this.jobs.get(e.data.id);
      if (!job) return;
      if (e.data.progress !== undefined) return job.onProgress(e.data.progress);
      this.jobs.delete(e.data.id);
      this._release(w);
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.parts);
    };
    w.onerror = (e) => {
      for (const [id, job] of this.jobs) if (job.worker === w) (this.jobs.delete(id), job.reject(new Error(e.message || 'Errore encoder')));
    };
    this.workers.push(w);
    return w;
  }

  _acquire() {
    if (this.idle.length) return Promise.resolve(this.idle.pop());
    if (this.workers.length < this.size) return Promise.resolve(this._spawn());
    return new Promise((r) => this.waiting.push(r));
  }

  _release(w) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  /**
   * MP3-encode an AudioBuffer. The PCM is converted to 16 bit and handed to a
   * worker (transferred, not copied). Resolves with {blob, kbps, channels}.
   */
  async encode(audio, kbpsStereo, kbpsMono, onProgress = () => {}) {
    const channels = Math.min(2, audio.numberOfChannels);
    const left = toInt16(audio.getChannelData(0));
    const right = channels > 1 ? toInt16(audio.getChannelData(1)) : null;
    const kbps = channels > 1 ? kbpsStereo : kbpsMono;
    const w = await this._acquire();
    const id = this.nextId++;
    const parts = await new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, onProgress, worker: w });
      const transfer = right ? [left.buffer, right.buffer] : [left.buffer];
      w.postMessage({ id, left, right, sampleRate: SAMPLE_RATE, kbps }, transfer);
    });
    return { blob: new Blob(parts, { type: 'audio/mpeg' }), kbps, channels };
  }

  close() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
  }
}

export { KEEP_MP3_UP_TO };
