// One-shot generator for a placeholder 512x512 PNG icon.
//
// Used because we don't want to commit a binary the project doesn't yet have a
// proper source for, and because adding `sharp` just for this would be silly.
// Run with: `node electron/icons/generate-placeholder.cjs`
//
// Produces electron/icons/icon.png — orange "H" on a charcoal background.
// The H is drawn as three filled rectangles (two verticals + one crossbar).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 512;
// Colors (RGBA bytes)
const BG = [0x0a, 0x0a, 0x0c, 0xff]; // charcoal
const FG = [0xff, 0x6a, 0x1f, 0xff]; // cyberpunk orange

// Glyph geometry (in pixels, relative to a 512x512 canvas).
const PAD = 96;
const STROKE = 64;
const LEFT_X = PAD;
const RIGHT_X = SIZE - PAD - STROKE;
const TOP_Y = PAD;
const BOTTOM_Y = SIZE - PAD;
const CROSS_Y = (SIZE - STROKE) / 2;

function pixelInH(x, y) {
  // Left vertical stroke
  if (x >= LEFT_X && x < LEFT_X + STROKE && y >= TOP_Y && y < BOTTOM_Y) return true;
  // Right vertical stroke
  if (x >= RIGHT_X && x < RIGHT_X + STROKE && y >= TOP_Y && y < BOTTOM_Y) return true;
  // Crossbar
  if (x >= LEFT_X && x < RIGHT_X + STROKE && y >= CROSS_Y && y < CROSS_Y + STROKE) return true;
  return false;
}

function buildRaster() {
  // Each row prefixed with filter byte 0x00 (None). RGBA = 4 bytes/pixel.
  const rowLen = 1 + SIZE * 4;
  const buf = Buffer.alloc(rowLen * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * rowLen;
    buf[rowStart] = 0; // filter: None
    for (let x = 0; x < SIZE; x++) {
      const px = rowStart + 1 + x * 4;
      const c = pixelInH(x, y) ? FG : BG;
      buf[px] = c[0];
      buf[px + 1] = c[1];
      buf[px + 2] = c[2];
      buf[px + 3] = c[3];
    }
  }
  return buf;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      t[n] = v >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const raster = buildRaster();
  const idat = zlib.deflateSync(raster, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, buildPng());
console.log('Wrote', out, '(' + fs.statSync(out).size + ' bytes)');
