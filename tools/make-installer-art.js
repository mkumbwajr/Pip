'use strict';
// Draws the picture on the left of the installer's welcome and finish pages (Pip in a soft glow on Peep's dark
// background) into build/installer-side.bmp, with no dependencies: node tools/make-installer-art.js
// Drawn at twice NSIS's 164 x 314 so it stays sharp when Windows scales the installer up.
const fs = require('node:fs'), path = require('node:path');
const W = 328, H = 628, SS = 3; // SS x SS samples per pixel smooth the edges
const PIP = [124, 92, 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const inRound = (x, y, x0, y0, w, h, r) => { if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false; const cx = Math.max(x0 + r, Math.min(x0 + w - r, x)), cy = Math.max(y0 + r, Math.min(y0 + h - r, y)); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };

const FACE = { w: 172, h: 156, r: 52 }; FACE.x = (W - FACE.w) / 2; FACE.y = 236;
const EYE = { w: 26, h: 46, r: 13, gap: 30, y: FACE.y + 52 };
function sample(x, y) {
  // background: deep violet at the top fading to Peep's near-black, with a glow of Pip's colour behind the face
  let c = mix([30, 20, 62], [8, 8, 11], Math.min(1, y / (H * 0.85)));
  const d = Math.hypot(x - W / 2, (y - (FACE.y + FACE.h / 2)) * 0.9);
  c = mix(c, PIP, 0.55 * Math.exp(-((d / 150) ** 2)));
  // a faint reflection of the face on the floor
  if (inRound(x, 2 * (FACE.y + FACE.h + 26) - y, FACE.x, FACE.y, FACE.w, FACE.h, FACE.r)) c = mix(c, PIP, 0.12 * Math.max(0, 1 - (y - FACE.y - FACE.h - 26) / 90));
  if (inRound(x, y, FACE.x, FACE.y, FACE.w, FACE.h, FACE.r)) {
    c = mix(PIP, [160, 135, 255], Math.max(0, 1 - (y - FACE.y) / FACE.h) * 0.35); // a little lighter at the top
    const l = W / 2 - EYE.gap / 2 - EYE.w, r = W / 2 + EYE.gap / 2;
    if (inRound(x, y, l, EYE.y, EYE.w, EYE.h, EYE.r) || inRound(x, y, r, EYE.y, EYE.w, EYE.h, EYE.r)) c = [255, 255, 255];
  }
  return c;
}

// 24-bit bottom-up BMP, rows padded to 4 bytes
const row = Math.ceil(W * 3 / 4) * 4, data = Buffer.alloc(row * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let acc = [0, 0, 0];
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS); acc = acc.map((v, i) => v + s[i]); }
  const [r, g, b] = acc.map(v => Math.round(v / (SS * SS))), o = (H - 1 - y) * row + x * 3;
  data[o] = b; data[o + 1] = g; data[o + 2] = r;
}
const head = Buffer.alloc(54);
head.write('BM', 0); head.writeUInt32LE(54 + data.length, 2); head.writeUInt32LE(54, 10);
head.writeUInt32LE(40, 14); head.writeInt32LE(W, 18); head.writeInt32LE(H, 22); head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28);
head.writeUInt32LE(data.length, 34); head.writeInt32LE(2835, 38); head.writeInt32LE(2835, 42);
const out = path.join(__dirname, '..', 'build', 'installer-side.bmp');
fs.writeFileSync(out, Buffer.concat([head, data]));
console.log('wrote', out);
