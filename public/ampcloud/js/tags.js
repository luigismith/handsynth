// Read basic metadata from an audio File in the browser before uploading:
// title/artist/album (ID3v2, FLAC Vorbis comments), sample rate, channels,
// duration, average bitrate. Everything is best-effort with filename fallback.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function decodeText(bytes) {
  if (!bytes.length) return '';
  const enc = bytes[0];
  const body = bytes.subarray(1);
  let s;
  if (enc === 0) s = latin1.decode(body);
  else if (enc === 3) s = utf8.decode(body);
  else {
    // UTF-16 with BOM (1) or big-endian (2)
    let le = enc === 1;
    let start = 0;
    if (body[0] === 0xff && body[1] === 0xfe) (le = true), (start = 2);
    else if (body[0] === 0xfe && body[1] === 0xff) (le = false), (start = 2);
    s = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body.subarray(start));
  }
  return s.replace(/\u0000.*$/s, '').trim();
}

const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

function parseId3(b) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return { tagEnd: 0 };
  const ver = b[3];
  const tagEnd = 10 + syncsafe(b, 6);
  const out = { tagEnd };
  const ids =
    ver === 2
      ? { TT2: 'title', TP1: 'artist', TAL: 'album' }
      : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
  let o = 10;
  if (ver >= 3 && b[5] & 0x40) o += ver === 4 ? syncsafe(b, 10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4;
  const limit = Math.min(tagEnd, b.length);
  while (o + (ver === 2 ? 6 : 10) <= limit) {
    let id, size, header;
    if (ver === 2) {
      id = String.fromCharCode(b[o], b[o + 1], b[o + 2]);
      size = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
      header = 6;
    } else {
      id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      size = ver === 4 ? syncsafe(b, o + 4) : ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
      header = 10;
    }
    if (!/^[A-Z0-9]+$/.test(id) || size <= 0) break;
    if (ids[id] && o + header + size <= b.length) out[ids[id]] = decodeText(b.subarray(o + header, o + header + size));
    o += header + size;
  }
  return out;
}

const MP3_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  null,
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];

// Layer III bitrates (kbps) by index, MPEG-1 and MPEG-2/2.5
const MP3_L3_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_L3_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function parseMp3Frame(b, from) {
  for (let i = from; i < Math.min(b.length - 4, from + 64 * 1024); i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3;
    const layer = (b[i + 1] >> 1) & 3;
    const rateIdx = (b[i + 2] >> 2) & 3;
    const brIdx = b[i + 2] >> 4;
    if (ver === 1 || layer === 0 || rateIdx === 3 || brIdx === 0 || brIdx === 15) continue;
    const mode = b[i + 3] >> 6;
    const kbps = layer === 1 ? (ver === 3 ? MP3_L3_V1 : MP3_L3_V2)[brIdx] : 0;
    return { sampleRate: MP3_RATES[ver][rateIdx], channels: mode === 3 ? 1 : 2, frameKbps: kbps };
  }
  return {};
}

function parseFlac(b) {
  if (latin1.decode(b.subarray(0, 4)) !== 'fLaC') return null;
  const out = {};
  let o = 4;
  while (o + 4 <= b.length) {
    const last = b[o] & 0x80;
    const type = b[o] & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    const d = b.subarray(o + 4, o + 4 + len);
    if (type === 0 && d.length >= 18) {
      out.sampleRate = (d[10] << 12) | (d[11] << 4) | (d[12] >> 4);
      out.channels = ((d[12] >> 1) & 7) + 1;
    } else if (type === 4) {
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      let p = 4 + dv.getUint32(0, true);
      const n = dv.getUint32(p, true);
      p += 4;
      for (let k = 0; k < n && p + 4 <= d.length; k++) {
        const l = dv.getUint32(p, true);
        const kv = utf8.decode(d.subarray(p + 4, p + 4 + l));
        p += 4 + l;
        const eq = kv.indexOf('=');
        const key = kv.slice(0, eq).toUpperCase();
        if (key === 'TITLE') out.title = kv.slice(eq + 1);
        if (key === 'ARTIST') out.artist = kv.slice(eq + 1);
        if (key === 'ALBUM') out.album = kv.slice(eq + 1);
      }
    }
    if (last) break;
    o += 4 + len;
  }
  return out;
}

function parseWav(b) {
  if (latin1.decode(b.subarray(0, 4)) !== 'RIFF' || latin1.decode(b.subarray(8, 12)) !== 'WAVE') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { channels: dv.getUint16(22, true), sampleRate: dv.getUint32(24, true) };
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (d) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      a.removeAttribute('src');
      resolve(Number.isFinite(d) ? d : 0);
    };
    // iPhone may ignore preload and never load metadata: don't wait forever
    const timer = setTimeout(() => done(0), 6000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
    a.load();
  });
}

export function splitFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = /^(?:\d{1,3}[\s.-]+)?(.+?)\s+-\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

export async function readTags(file) {
  const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let meta = {};
  if (ext === 'flac') meta = parseFlac(head) || {};
  else if (ext === 'wav') meta = parseWav(head) || {};
  else {
    const id3 = parseId3(head);
    meta = { ...id3 };
    if (ext === 'mp3') Object.assign(meta, parseMp3Frame(head, id3.tagEnd || 0));
  }
  delete meta.tagEnd;
  const fromName = splitFilename(file.name);
  let duration = await probeDuration(file);
  if (!duration && meta.frameKbps) duration = (file.size * 8) / (meta.frameKbps * 1000); // CBR estimate
  return {
    title: meta.title || fromName.title || file.name,
    artist: meta.artist || fromName.artist || '',
    album: meta.album || '',
    sampleRate: meta.sampleRate || 0,
    channels: meta.channels || 2,
    duration,
    bitrate: duration > 0 ? Math.round((file.size * 8) / duration / 1000) : 0,
    format: ext,
  };
}
