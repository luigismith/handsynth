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

export function needsConversion(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return CONVERT_ONLY.includes(ext) || file.size > MAX_UPLOAD_BYTES;
}

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
  const bitrate = MP3_RATES.find((r) => r <= budgetKbps);
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
