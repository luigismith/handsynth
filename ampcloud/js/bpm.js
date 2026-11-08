// Offline tempo detection: decode the track at 22 kHz, build an onset
// envelope (low-band + full-band energy flux), autocorrelate it over
// 60–200 BPM with a mild prior around 115 BPM against octave errors, refine
// the peak, then find the beat phase with a comb over the envelope.

const SR = 22050;
const HOP = 256; // envelope rate ≈ 86 Hz
const MAX_SECONDS = 90;

function mono(audio, from, to) {
  const n = to - from;
  const out = new Float32Array(n);
  const chans = audio.numberOfChannels;
  for (let c = 0; c < chans; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[from + i] / chans;
  }
  return out;
}

function onsetEnvelope(x) {
  const frames = Math.floor(x.length / HOP);
  const low = new Float32Array(frames);
  const full = new Float32Array(frames);
  const a = Math.exp((-2 * Math.PI * 180) / SR);
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let el = 0;
    let ef = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) {
      const s = x[i];
      lp = (1 - a) * s + a * lp;
      el += lp * lp;
      ef += s * s;
    }
    low[f] = Math.log1p((1000 * el) / HOP);
    full[f] = Math.log1p((1000 * ef) / HOP);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, low[f] - low[f - 1]) + 0.5 * Math.max(0, full[f] - full[f - 1]);
  }
  // subtract a moving average (≈1 s) so steady loudness doesn't count
  const W = 43;
  const out = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += onset[f];
    if (f >= W) sum -= onset[f - W];
    out[f] = Math.max(0, onset[f] - sum / Math.min(f + 1, W));
  }
  return out;
}

/** Returns {bpm, offset (s, first beat), confidence 0..1} or null. */
export function tempoFromAudio(audio) {
  const rate = SR / HOP;
  const total = audio.length;
  const secs = total / audio.sampleRate;
  if (secs < 6) return null;
  // analyse the middle of the track, where the groove usually is
  const len = Math.min(total, Math.round(MAX_SECONDS * audio.sampleRate));
  const from = Math.max(0, Math.round((total - len) / 2));
  const env = onsetEnvelope(mono(audio, from, from + len));
  const N = env.length;
  const minLag = Math.floor((rate * 60) / 200);
  const maxLag = Math.ceil((rate * 60) / 60);
  const acf = new Float32Array(maxLag * 2 + 2);
  for (let L = 1; L < acf.length && L < N; L++) {
    let s = 0;
    for (let i = 0; i + L < N; i++) s += env[i] * env[i + L];
    acf[L] = s / (N - L);
  }
  let best = -1;
  let bestScore = -Infinity;
  let mean = 0;
  for (let L = minLag; L <= maxLag; L++) {
    const bpm = (60 * rate) / L;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
    const score = (acf[L] + 0.5 * (acf[2 * L] || 0) + 0.25 * (acf[Math.round(L / 2)] || 0)) * prior;
    mean += acf[L];
    if (score > bestScore) (bestScore = score), (best = L);
  }
  mean /= maxLag - minLag + 1;
  if (best < 0 || !(acf[best] > 0)) return null;
  // parabolic refinement of the peak
  const y0 = acf[best - 1] || 0;
  const y1 = acf[best];
  const y2 = acf[best + 1] || 0;
  const denom = y0 - 2 * y1 + y2;
  const coarse = best + (denom ? (0.5 * (y0 - y2)) / denom : 0);
  // joint fine search of period (±2 %) and phase with a comb over the
  // envelope: a tiny tempo error would otherwise drift the beat LED
  const at = (t) => {
    const i = Math.floor(t);
    const f = t - i;
    return (env[i] || 0) * (1 - f) + (env[i + 1] || 0) * f;
  };
  let period = coarse;
  let phase = 0;
  let bestSum = -1;
  for (let k = -100; k <= 100; k++) {
    const p = coarse * (1 + k * 0.0002);
    for (let o = 0; o < p; o += 0.5) {
      let s = 0;
      for (let t = o; t < N - 1; t += p) s += at(t);
      if (s > bestSum) (bestSum = s), (period = p), (phase = o);
    }
  }
  const bpm = Math.round(((60 * rate) / period) * 10) / 10;
  // envelope frame f covers samples [f*HOP, (f+1)*HOP): its onset sits ~half a hop earlier
  const first = from / audio.sampleRate + (phase - 0.5) / rate;
  const beat = period / rate;
  const offset = ((first % beat) + beat) % beat;
  const confidence = Math.max(0, Math.min(1, (acf[best] / (mean || 1) - 1) / 8));
  return { bpm, offset, confidence };
}

/** Download + decode + detect. `arrayBuffer` is the encoded file. */
export async function detectBpm(arrayBuffer) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Offline(1, 1, SR);
  const audio = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p?.then) p.then(resolve, reject);
  });
  return tempoFromAudio(audio);
}
