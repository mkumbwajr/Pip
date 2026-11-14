'use strict';
// Draws Pip's icon (Pip's head: a rounded violet square with two eyes) with no dependencies:
//   node tools/make-icon.js   ->  assets/icon.png (256 px) and build/pip.ico (16 to 256 px, for the app and the installer)
// Every size is drawn on its own with smoothed edges, so the small ones in the taskbar stay crisp.
const zlib = require('node:zlib'), fs = require('node:fs'), path = require('node:path');

const inRound = (x, y, x0, y0, w, h, r) => { if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false; const cx = Math.max(x0 + r, Math.min(x0 + w - r, x)), cy = Math.max(y0 + r, Math.min(y0 + h - r, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
// Pip on a 256 grid: the head, then the eyes
function sample(x, y) {
  if (inRound(x, y, 82, 96, 30, 52, 15) || inRound(x, y, 144, 96, 30, 52, 15)) return [255, 255, 255, 255];
  if (inRound(x, y, 24, 36, 208, 190, 62)) return [124, 92, 255, 255];
  return [0, 0, 0, 0];
}
function draw(N) {
  const px = Buffer.alloc(N * N * 4), S = N <= 32 ? 6 : 4, k = 256 / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = sample((x + (sx + 0.5) / S) * k, (y + (sy + 0.5) / S) * k); r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    if (a) px.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / (S * S))], (y * N + x) * 4);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
function png(N) {
  const px = draw(N), head = Buffer.alloc(13); head.writeUInt32BE(N, 0); head.writeUInt32BE(N, 4); head.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(N * (N * 4 + 1)); for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// An .ico whose entries are PNG images (supported since Windows Vista)
function ico(sizes) {
  const images = sizes.map(png), dir = Buffer.alloc(6 + 16 * sizes.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((n, i) => { const e = 6 + 16 * i; dir[e] = n >= 256 ? 0 : n; dir[e + 1] = n >= 256 ? 0 : n; dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6); dir.writeUInt32LE(images[i].length, e + 8); dir.writeUInt32LE(offset, e + 12); offset += images[i].length; });
  return Buffer.concat([dir, ...images]);
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png(256));
const icoFile = ico([16, 20, 24, 32, 40, 48, 64, 128, 256]);
fs.writeFileSync(path.join(root, 'build', 'pip.ico'), icoFile);  // the exe and the installer
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), icoFile); // Pip's windows and tray, so they match the exe exactly
console.log('wrote assets/icon.png, assets/icon.ico and build/pip.ico');
