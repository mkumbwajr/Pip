'use strict';
// Draws Peep's icon (Pip's face) into assets/icon.png with no dependencies: node tools/make-icon.js
const zlib = require('node:zlib'), fs = require('node:fs'), path = require('node:path');
const N = 256, px = Buffer.alloc(N * N * 4);
const inRound = (x, y, x0, y0, w, h, r) => { if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false; const cx = Math.max(x0 + r, Math.min(x0 + w - r, x)), cy = Math.max(y0 + r, Math.min(y0 + h - r, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let c = null;
  if (inRound(x, y, 24, 36, 208, 190, 62)) c = [124, 92, 255];
  if (inRound(x, y, 82, 96, 30, 52, 15) || inRound(x, y, 144, 96, 30, 52, 15)) c = [255, 255, 255];
  if (c) px.set([...c, 255], (y * N + x) * 4);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
const head = Buffer.alloc(13); head.writeUInt32BE(N, 0); head.writeUInt32BE(N, 4); head.set([8, 6, 0, 0, 0], 8);
const raw = Buffer.alloc(N * (N * 4 + 1)); for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote', out);
