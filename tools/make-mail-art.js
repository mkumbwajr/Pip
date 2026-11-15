'use strict';
// Pip blinking, as an animated GIF for emails (email apps do not run CSS animations):
//   node tools/make-mail-art.js   ->  site/img/pip-blink.gif (144 x 128, shown at 72 x 64)
// Drawn like tools/make-icon.js (Pip's head and eyes, smoothed edges) on the email card's white, with no dependencies:
// every pixel is a mix of white and Pip's violet, so one 64-step palette between the two keeps the edges smooth.
const fs = require('node:fs'), path = require('node:path');

const W = 144, H = 128, VIOLET = [124, 92, 255], WHITE = [255, 255, 255];
const inRound = (x, y, x0, y0, w, h, r) => { if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false; const cx = Math.max(x0 + r, Math.min(x0 + w - r, x)), cy = Math.max(y0 + r, Math.min(y0 + h - r, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
/** One frame; open: 1 = eyes open, 0 = closed (a thin line). Returns a palette index per pixel. */
function frame(open) {
  const eyeH = Math.max(5, 40 * open), eyeY = 44 + (40 - eyeH) / 2, out = new Uint8Array(W * H), S = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0; // how violet this pixel is, 0..1
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = x + (sx + .5) / S, py = y + (sy + .5) / S;
      const eye = inRound(px, py, 47, eyeY, 16, eyeH, 8) || inRound(px, py, 81, eyeY, 16, eyeH, 8);
      if (!eye && inRound(px, py, 8, 6, 128, 116, 38)) v++;
    }
    out[y * W + x] = Math.round(63 * v / (S * S));
  }
  return out;
}
const palette = Buffer.alloc(64 * 3);
for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) palette[i * 3 + c] = Math.round(WHITE[c] + (VIOLET[c] - WHITE[c]) * i / 63);

/** GIF's LZW for one frame of 6-bit indices, as data sub-blocks. */
function lzw(pixels, minSize = 6) {
  const clear = 1 << minSize, end = clear + 1, out = []; let size = minSize + 1, next = end + 1, dict = new Map(), bits = 0, acc = 0;
  const emit = code => { acc |= code << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  emit(clear); let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = prefix * 4096 + k;
    if (dict.has(key)) { prefix = dict.get(key); continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { emit(clear); dict = new Map(); size = minSize + 1; next = end + 1; }
    prefix = k;
  }
  emit(prefix); emit(end); if (bits) out.push(acc & 255);
  const blocks = []; for (let i = 0; i < out.length; i += 255) { const part = out.slice(i, i + 255); blocks.push(part.length, ...part); }
  return Buffer.from([minSize, ...blocks, 0]);
}

// eyes open a while, a blink, open, a quick double blink: [openness, hundredths of a second]
const SCRIPT = [[1, 260], [.45, 4], [0, 7], [.45, 4], [1, 180], [0, 6], [1, 9], [0, 6], [1, 200]];
const parts = [Buffer.from('GIF89a'), Buffer.from([W & 255, W >> 8, H & 255, H >> 8, 0xF5, 0, 0]), palette,
  Buffer.from([0x21, 0xFF, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0])]; // loop for ever
for (const [open, delay] of SCRIPT) {
  parts.push(Buffer.from([0x21, 0xF9, 4, 0x04, delay & 255, delay >> 8, 0, 0])); // keep the frame, no transparency
  parts.push(Buffer.from([0x2C, 0, 0, 0, 0, W & 255, W >> 8, H & 255, H >> 8, 0]), lzw(frame(open)));
}
parts.push(Buffer.from([0x3B]));
const file = path.join(__dirname, '..', 'site', 'img', 'pip-blink.gif');
fs.writeFileSync(file, Buffer.concat(parts));
console.log('wrote site/img/pip-blink.gif', fs.statSync(file).size, 'bytes');
