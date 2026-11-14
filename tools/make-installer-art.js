'use strict';
// Draws the picture on the left of the installer's welcome and finish pages: the line "One island to Rule All
// Agents" over real screenshots of Pip (site/img), at twice NSIS's 164 x 314 so it stays sharp when Windows scales
// the installer up. Rendered by Electron, saved as a 24-bit BMP (the format NSIS needs):
//   npx electron tools/make-installer-art.js        ->  build/installer-side.bmp
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const W = 328, H = 628, root = path.join(__dirname, '..');
const img = name => 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'site', 'img', name)).toString('base64');

const page = `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; background: radial-gradient(90% 55% at 50% 100%, rgba(124, 92, 255, .55), transparent 70%), linear-gradient(180deg, #121019 0%, #0a0a0d 55%, #140f24 100%);
  font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif; color: #f5f5f7; -webkit-font-smoothing: antialiased; }
.pip { position: absolute; left: 28px; top: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; width: 40px; height: 36px; border-radius: 12px; background: #7c5cff; }
.pip i { width: 6px; height: 11px; border-radius: 3px; background: #fff; }
h1 { position: absolute; left: 26px; right: 22px; top: 92px; font-size: 38px; line-height: 1.04; font-weight: 700; letter-spacing: -.035em; }
h1 span { background: linear-gradient(90deg, #ffffff, #c9bfff 60%, #9b84ff); -webkit-background-clip: text; color: transparent; }
.shot { position: absolute; left: 50%; transform: translateX(-50%); border-radius: 14px; box-shadow: 0 18px 40px -12px rgba(0, 0, 0, .85), 0 0 0 1px rgba(255, 255, 255, .06); }
.pill { top: 290px; width: 300px; border-radius: 0; box-shadow: none; filter: drop-shadow(0 10px 22px rgba(0, 0, 0, .7)); }
.a { top: 346px; width: 296px; transform: translateX(-50%) rotate(-3deg); opacity: .96; }
.b { top: 462px; width: 300px; transform: translateX(-50%) rotate(2deg); }
</style>
<span class="pip"><i></i><i></i></span>
<h1>One island<br>to Rule<br><span>All Agents</span></h1>
<img class="shot pill" src="${img('pip-ruhusa.png')}">
<img class="shot a" src="${img('pip-ai.png')}">
<img class="shot b" src="${img('pip-lyrics.png')}">`;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;base64,' + Buffer.from(page).toString('base64'));
  await new Promise(r => setTimeout(r, 800));
  const shot = (await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })).resize({ width: W, height: H });
  const { width, height } = shot.getSize(), bgra = shot.toBitmap(); // top-down BGRA
  const row = Math.ceil(width * 3 / 4) * 4, data = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 4, d = (height - 1 - y) * row + x * 3; // BMP rows run bottom-up
    data[d] = bgra[s]; data[d + 1] = bgra[s + 1]; data[d + 2] = bgra[s + 2];
  }
  const head = Buffer.alloc(54);
  head.write('BM', 0); head.writeUInt32LE(54 + data.length, 2); head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14); head.writeInt32LE(width, 18); head.writeInt32LE(height, 22); head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28);
  head.writeUInt32LE(data.length, 34); head.writeInt32LE(2835, 38); head.writeInt32LE(2835, 42);
  fs.writeFileSync(path.join(root, 'build', 'installer-side.bmp'), Buffer.concat([head, data]));
  fs.writeFileSync(path.join(root, 'build', 'installer-side-preview.png'), shot.toPNG());
  console.log('wrote build/installer-side.bmp', width + 'x' + height);
  app.exit(0);
});
