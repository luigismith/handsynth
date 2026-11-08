// Web Worker: MP3 encoding with LAME off the main thread, so several tracks
// can be compressed in parallel without freezing the player.
// in:  { id, left: Int16Array, right?: Int16Array, sampleRate, kbps }
// out: { id, progress } … then { id, parts: Uint8Array[] } or { id, error }
/* global lamejs */
importScripts('../vendor/lame-1.2.1.min.js');

const BLOCK = 1152 * 20;

self.onmessage = (e) => {
  const { id, left, right, sampleRate, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(right ? 2 : 1, sampleRate, kbps);
    const parts = [];
    const total = left.length;
    let lastReport = 0;
    for (let i = 0; i < total; i += BLOCK) {
      const end = Math.min(total, i + BLOCK);
      const out = right ? enc.encodeBuffer(left.subarray(i, end), right.subarray(i, end)) : enc.encodeBuffer(left.subarray(i, end));
      if (out.length) parts.push(new Uint8Array(out));
      if (i - lastReport > total / 20) {
        lastReport = i;
        self.postMessage({ id, progress: i / total });
      }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    self.postMessage({ id, parts }, parts.map((p) => p.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
