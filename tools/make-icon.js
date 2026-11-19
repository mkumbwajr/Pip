'use strict';
// Draws Pip's icon from the 3D head art (src/renderer/mascot/default/yaw_0.svg, see CLAUDE.md rule 1):
//   electron tools/make-icon.js   ->  assets/icon.png (256 px), build/pip.ico (16 to 256 px, for the app and the
//                                      installer), assets/icon.ico (same sizes) and build/icon-mac.png (1024 px,
//                                      electron-builder makes the .icns from it)
// Pip's own menu-bar glyph (assets/trayTemplate(@2x).png, macOS only) is a plain black silhouette macOS tints
// itself - unrelated to the head's look, so this script leaves it alone.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src', 'renderer', 'mascot', 'default', 'yaw_0.svg');

app.whenReady().then(async () => {
  const CANVAS = 1024; // render big, then nativeImage.resize() down for every smaller size - crisp at every one
  const win = new BrowserWindow({ width: CANVAS, height: CANVAS, show: false, transparent: true, backgroundColor: '#00000000' });
  win.webContents.on('console-message', (_e, _l, msg) => console.error('page:', msg));
  const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
    img{display:block;width:100%;height:100%;object-fit:contain;padding:6%;box-sizing:border-box}</style>
    <img src="yaw_0.svg" onerror="console.error('image failed to load')">`;
  const tmpHtml = path.join(path.dirname(SRC), '.make-icon-preview.html');
  fs.writeFileSync(tmpHtml, html);
  await win.loadFile(tmpHtml);
  await new Promise(r => setTimeout(r, 500));
  fs.rmSync(tmpHtml, { force: true });
  const full = await win.webContents.capturePage(); // 1024x1024 RGBA, Pip's head centred and padded

  const png = size => full.resize({ width: size, height: size, quality: 'best' }).toPNG();

  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png(256));
  fs.writeFileSync(path.join(root, 'build', 'icon-mac.png'), png(1024));

  // An .ico whose entries are PNG images (supported since Windows Vista) - same container format the old
  // procedural generator wrote, just filled with real PNGs instead of hand-sampled ones.
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = sizes.map(png);
  const dir = Buffer.alloc(6 + 16 * sizes.length); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((n, i) => { const e = 6 + 16 * i; dir[e] = n >= 256 ? 0 : n; dir[e + 1] = n >= 256 ? 0 : n; dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6); dir.writeUInt32LE(images[i].length, e + 8); dir.writeUInt32LE(offset, e + 12); offset += images[i].length; });
  const ico = Buffer.concat([dir, ...images]);
  fs.writeFileSync(path.join(root, 'build', 'pip.ico'), ico);
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico);

  console.log('wrote assets/icon.png, assets/icon.ico, build/pip.ico and build/icon-mac.png from the 3D head');
  app.exit(0);
});
