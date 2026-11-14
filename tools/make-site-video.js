'use strict';
// Records Pip's island going from idle to open on Home and back, over a desktop wallpaper, for the website:
//   npx electron tools/make-site-video.js     ->  site/img/pip-open.webm (looping video) and site/img/pip-open.png (still)
// Frames come straight from the island window (with transparency) while it animates; a hidden page lays each one
// over the wallpaper and records them with Chromium's own encoder, so nothing extra is installed.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-video-'));
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home'); fs.mkdirSync(process.env.HOME, { recursive: true });
app.setPath('userData', path.join(tmp, 'profile')); fs.mkdirSync(path.join(tmp, 'profile'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile', 'settings.json'), JSON.stringify({ firstRunDone: true, lang: 'sw', island: { brightness: 0.22 } }));
process.env.PIP_HUB_PORT = process.env.PIP_HUB_PORT || '48698';
app.commandLine.appendSwitch('force-device-scale-factor', '2');
require(path.join(root, 'src', 'main', 'main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(3000);
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('island.html'));
  const js = c => win.webContents.executeJavaScript(c);
  // the same sample content as the website's screenshots: an agent at work, a song, the weather
  await js(`(() => { const now = Date.now(); S.hubError = ''; S.agents = { claude: true };
    S.ai = { top: 'working', usage: { fiveHour: { pct: 34, resetsAt: now + 2.4 * 3600e3 } }, history: [], sessions: [{ id: 's1', agent: 'claude', state: 'working', project: 'duka', startedAt: now - 95000, updatedAt: now, activity: { verb: 'Editing', detail: 'mpesa.js' }, feed: [] }] };
    const w = { ...S.win, at: now, media: { title: 'Jua Kali', artist: 'Bendi ya Mtaa', playing: true, positionMs: 74000, durationMs: 214000, app: 'Spotify.exe' } };
    Object.defineProperty(S, 'win', { configurable: true, get: () => w, set: () => {} });
    const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 200, 200);
    gr.addColorStop(0, '#ff8a3d'); gr.addColorStop(1, '#7c2d12'); g.fillStyle = gr; g.fillRect(0, 0, 200, 200); g.fillStyle = '#fff'; g.beginPath(); g.arc(100, 100, 46, 0, 7); g.fill(); g.fillStyle = '#7c2d12'; g.beginPath(); g.arc(100, 100, 12, 0, 7); g.fill();
    S.art = { key: 'Jua Kali|Bendi ya Mtaa', data: c.toDataURL('image/jpeg').split(',')[1] };
    S.weather = { temp: 29, unit: '°C', code: 1, place: 'Dar es Salaam' }; S.tab = 'home'; drawPill(); })()`);
  await wait(600);

  // collect frames while the island idles, opens, holds, and folds back
  const frames = [], t0 = Date.now(); let recording = true;
  win.webContents.beginFrameSubscription(false, image => { if (recording) frames.push({ t: Date.now() - t0, png: image.toPNG() }); });
  const tick = setInterval(() => win.webContents.invalidate(), 1000 / 30); // keep frames coming while nothing moves
  await wait(1400);                                          // idle: Pip's eyes in the notch
  await js(`(() => { setOpen(true); setTimeout(() => { S.weather = { temp: 29, unit: '°C', code: 1, place: 'Dar es Salaam' }; draw(true); }, 120); })()`);
  await wait(4200);                                          // the spring open and a good look at Home
  await js(`setOpen(false)`);
  await wait(1300);                                          // folds back to idle
  recording = false; clearInterval(tick); win.webContents.endFrameSubscription();
  console.log('frames', frames.length);

  // lay the frames over a wallpaper and record them at their real timing
  const size = frames[0] ? require('electron').nativeImage.createFromBuffer(frames[0].png).getSize() : { width: 1400, height: 624 };
  const W = size.width, H = Math.round(size.height * 1.25);
  const rec = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { offscreen: false, backgroundThrottling: false } });
  await rec.loadURL('data:text/html,<canvas id=c></canvas>');
  const b64 = frames.map(f => ({ t: f.t, d: 'data:image/png;base64,' + f.png.toString('base64') }));
  const webm = await rec.webContents.executeJavaScript(`(async () => {
    const frames = ${JSON.stringify(b64)}, W = ${W}, H = ${H}, c = document.getElementById('c'); c.width = W; c.height = H; const g = c.getContext('2d');
    const wall = () => { const a = g.createLinearGradient(0, 0, 0, H); a.addColorStop(0, '#120d24'); a.addColorStop(.6, '#241a3d'); a.addColorStop(1, '#3a1f3a'); g.fillStyle = a; g.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[.18, .95, .75, '255,122,61'], [.85, .9, .7, '106,77,255'], [.55, 1.25, .8, '255,61,119']]) { const rg = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W); rg.addColorStop(0, 'rgba(' + col + ',.85)'); rg.addColorStop(1, 'rgba(' + col + ',0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); } };
    const imgs = await Promise.all(frames.map(f => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = f.d; })));
    const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6e6 }), chunks = [];
    mr.ondataavailable = e => chunks.push(e.data); const done = new Promise(r => mr.onstop = r);
    mr.start();
    for (let i = 0; i < imgs.length; i++) {
      wall(); g.drawImage(imgs[i], 0, 0); track.requestFrame();
      await new Promise(r => setTimeout(r, Math.max(16, (frames[i + 1]?.t ?? frames[i].t + 33) - frames[i].t)));
    }
    mr.stop(); await done;
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s);
  })()`);
  fs.writeFileSync(path.join(root, 'site', 'img', 'pip-open.webm'), Buffer.from(webm, 'base64'));
  // a still of the open island over the same wallpaper, shown where the video cannot play
  const still = await rec.webContents.executeJavaScript(`document.getElementById('c').toDataURL('image/png')`);
  const mid = b64[Math.floor(b64.length * 0.62)];
  const poster = await rec.webContents.executeJavaScript(`(async () => { const c = document.getElementById('c'), g = c.getContext('2d'); const i = new Image(); await new Promise(r => { i.onload = r; i.src = ${JSON.stringify(mid.d)}; });
    g.clearRect(0, 0, c.width, c.height); return null; })()`);
  void still; void poster;
  console.log('wrote site/img/pip-open.webm', (Buffer.from(webm, 'base64').length / 1024).toFixed(0) + ' KB');
  app.exit(0);
});
