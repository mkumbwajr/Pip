'use strict';
// Pictures of Pip for the website, all from the real island with sample content:
//   npx electron tools/make-site-video.js
//   -> site/img/pip-<tab>.png   stills of the open island (2x), one per tab shown on the site
//   -> site/img/pip-open.webm   the island opening from idle, a tour of the tabs, and folding back (looping video)
//   -> site/img/pip-tour.json   when each tab starts in the video, for the labels under it
// Frames come straight from the island window (with transparency) while it animates; a hidden page lays each one
// over a wallpaper, a little smaller than full width, and records them with Chromium's own encoder: nothing to install.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..'), img = path.join(root, 'site', 'img');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-video-'));
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home'); fs.mkdirSync(process.env.HOME, { recursive: true });
app.setPath('userData', path.join(tmp, 'profile')); fs.mkdirSync(path.join(tmp, 'profile'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'profile', 'settings.json'), JSON.stringify({ firstRunDone: true, lang: 'sw', island: { brightness: 0.22 },
  note: ['Duka la Mama Neema', '[x] Weka M-Pesa kwenye checkout', '[ ] Discount code', '[ ] Tuma invoice kwa email'].join('\n') }));
process.env.PIP_HUB_PORT = process.env.PIP_HUB_PORT || '48698';
app.commandLine.appendSwitch('force-device-scale-factor', '2');
require(path.join(root, 'src', 'main', 'main.js'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// the tour: [tab, label on the site, seconds on screen]
const TOUR = [['home', 'Mwanzo', 2.6], ['ai', 'Ma-agent', 2.2], ['pip', 'Pip', 2.4], ['music', 'Lyrics', 2.6], ['focus', 'Focus', 1.8], ['modes', 'Modes', 1.8], ['calendar', 'Kalenda', 1.8], ['note', 'Noti', 1.8], ['mail', 'Barua', 1.6]];

app.whenReady().then(async () => {
  await wait(3000);
  const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('island.html'));
  const js = c => win.webContents.executeJavaScript(c);
  // sample content: an agent at work, a song with lyrics, the weather, today's calendar, mail, a short chat
  await js(`(() => { const now = Date.now(); S.hubError = ''; S.agents = { claude: true };
    S.ai = { top: 'working', usage: { fiveHour: { pct: 34, resetsAt: now + 2.4 * 3600e3 } },
      history: [{ state: 'done', prompt: 'Rekebisha bei kwenye cart', agent: 'claude', project: 'duka', tookMs: 184000, edits: ['cart.js'], at: now - 40 * 60e3 },
                { state: 'done', prompt: 'Andika tests za M-Pesa', agent: 'codex', project: 'duka', tookMs: 302000, edits: ['mpesa.test.js'], at: now - 2.2 * 3600e3 }],
      sessions: [{ id: 's1', agent: 'claude', state: 'working', project: 'duka', prompt: 'Ongeza M-Pesa kwenye checkout', startedAt: now - 95000, updatedAt: now, activity: { verb: 'Editing', detail: 'mpesa.js' },
        feed: [{ verb: 'Reading', detail: 'checkout.js' }, { verb: 'Searching', detail: 'payment' }, { verb: 'Editing', detail: 'mpesa.js' }] }] };
    const w = { ...S.win, at: now, media: { title: 'Jua Kali', artist: 'Bendi ya Mtaa', album: 'Mtaa Wetu', playing: true, positionMs: 21500, durationMs: 214000, app: 'Spotify.exe', canSeek: true } };
    Object.defineProperty(S, 'win', { configurable: true, get: () => w, set: () => {} });
    const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 200, 200);
    gr.addColorStop(0, '#ff8a3d'); gr.addColorStop(1, '#7c2d12'); g.fillStyle = gr; g.fillRect(0, 0, 200, 200); g.fillStyle = '#fff'; g.beginPath(); g.arc(100, 100, 46, 0, 7); g.fill(); g.fillStyle = '#7c2d12'; g.beginPath(); g.arc(100, 100, 12, 0, 7); g.fill();
    S.art = { key: 'Jua Kali|Bendi ya Mtaa', data: c.toDataURL('image/jpeg').split(',')[1] }; applyArtColor();
    S.lyrics = ['Asubuhi na mapema', 'Jua linawaka kali', 'Tunaenda kazini', 'Mikono yetu ni nguvu', 'Jua kali, jua kali', 'Hatulali njaa', 'Tunajenga taifa', 'Kwa jasho na damu', 'Jioni tunarudi', 'Tunacheka pamoja']
      .map((text, i) => ({ t: i * 4500, text })); S.lyricsFor = 'Jua Kali|Bendi ya Mtaa'; S.settings.lyrics = true; refreshLyrics = async () => {};
    S.weather = { temp: 29, unit: '°C', code: 1, place: 'Dar es Salaam' };
    const d = new Date(); d.setHours(14, 0, 0, 0); const e = { title: 'Kikao na timu ya duka', start: d.getTime(), end: d.getTime() + 3600e3 };
    S.event = e; S.google = true; S.cal = { view: 'day', events: [e, { title: 'Chai', start: d.getTime() - 4 * 3600e3, end: d.getTime() - 3.5 * 3600e3 }], error: '' };
    S.mail = { count: 7, error: '', at: now }; refreshHome = async () => draw(); refreshCalendar = async () => draw(); refreshMail = async () => draw();
    S.chat.log = [{ role: 'me', text: 'Hii error inamaanisha nini? ENOENT: config.json' }, { role: 'pip', text: 'Faili **config.json** halipo kwenye folder hiyo. Hakikisha path ni sahihi, au tengeneza faili hilo.' }];
    S.tab = 'home'; drawPill(); })()`);
  await wait(800);

  // 1. stills: the panel of the open island (640 x 288 at 2x), one per tab
  await js(`setOpen(true)`); await wait(900);
  const crop = async name => { await wait(700); const shot = await win.webContents.capturePage({ x: 30, y: 0, width: 640, height: 288 }); fs.writeFileSync(path.join(img, `pip-${name}.png`), shot.toPNG()); };
  for (const [tab, name] of [['home', 'home'], ['ai', 'ai'], ['pip', 'pip'], ['music', 'lyrics'], ['focus', 'focus'], ['modes', 'modes'], ['calendar', 'calendar'], ['mail', 'mail']]) { await js(`go('${tab}')`); await crop(name); }
  await js(`go('home'); setOpen(false)`); await wait(1500);

  // 2. the video: idle, open, the tour, fold
  const frames = [], t0 = Date.now(); let recording = true;
  win.webContents.beginFrameSubscription(false, image => { if (recording) frames.push({ t: Date.now() - t0, png: image.toPNG() }); });
  const tick = setInterval(() => win.webContents.invalidate(), 1000 / 30); // keep frames coming while nothing moves
  const marks = [];
  await wait(1300);                                                   // idle: Pip's eyes in the notch
  await js(`setOpen(true)`);
  for (const [tab, label, sec] of TOUR) { if (tab !== 'home') await js(`go('${tab}')`); marks.push({ tab, label, t: (Date.now() - t0) / 1000 }); await wait(sec * 1000); }
  await js(`go('home')`); await wait(1000);
  await js(`setOpen(false)`); await wait(1400);                       // folds back to idle
  recording = false; clearInterval(tick); win.webContents.endFrameSubscription();
  console.log('frames', frames.length);

  // lay the frames over a wallpaper (the island at 76% of the width, so it reads as a notch on a screen) and record them
  const size = nativeImage.createFromBuffer(frames[0].png).getSize(), W = 1400, H = 660, k = 0.76;
  const rec = new BrowserWindow({ width: 400, height: 300, show: false, webPreferences: { backgroundThrottling: false } });
  await rec.loadURL('data:text/html,<canvas id=c></canvas>');
  await rec.webContents.executeJavaScript(`(() => {
    const W = ${W}, H = ${H}, k = ${k}, fw = ${size.width}, fh = ${size.height}, c = document.getElementById('c'); c.width = W; c.height = H; const g = c.getContext('2d');
    const wall = () => { const a = g.createLinearGradient(0, 0, 0, H); a.addColorStop(0, '#120d24'); a.addColorStop(.6, '#241a3d'); a.addColorStop(1, '#3a1f3a'); g.fillStyle = a; g.fillRect(0, 0, W, H);
      for (const [x, y, r, col] of [[.18, .95, .75, '255,122,61'], [.85, .9, .7, '106,77,255'], [.55, 1.25, .8, '255,61,119']]) { const rg = g.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * W); rg.addColorStop(0, 'rgba(' + col + ',.85)'); rg.addColorStop(1, 'rgba(' + col + ',0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); } };
    const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 3.2e6 }), chunks = [];
    mr.ondataavailable = e => chunks.push(e.data); window.done = new Promise(r => mr.onstop = r); window.chunks = chunks; window.mr = mr; mr.start();
    // one frame at a time, so no huge list is ever held in the page
    window.add = (src, ms) => new Promise(r => { const i = new Image(); i.onload = () => { wall(); g.drawImage(i, (W - fw * k) / 2, 0, fw * k, fh * k); track.requestFrame(); setTimeout(r, ms); }; i.src = src; });
    window.finish = async () => { mr.stop(); await window.done; const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
      let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); };
  })()`);
  for (let i = 0; i < frames.length; i++) {
    const ms = Math.max(16, (frames[i + 1]?.t ?? frames[i].t + 33) - frames[i].t);
    await rec.webContents.executeJavaScript(`add(${JSON.stringify('data:image/png;base64,' + frames[i].png.toString('base64'))}, ${ms})`);
    if (i === Math.floor(frames.length * 0.16)) fs.writeFileSync(path.join(img, 'pip-open.jpg'), Buffer.from((await rec.webContents.executeJavaScript(`document.getElementById('c').toDataURL('image/jpeg', .86)`)).split(',')[1], 'base64')); // the poster: Home, open
  }
  const webm = Buffer.from(await rec.webContents.executeJavaScript('finish()'), 'base64');
  fs.writeFileSync(path.join(img, 'pip-open.webm'), webm);
  fs.writeFileSync(path.join(img, 'pip-tour.json'), JSON.stringify(marks.map(m => ({ ...m, t: Math.round(m.t * 10) / 10 }))) + '\n');
  console.log('wrote site/img/pip-open.webm', (webm.length / 1024).toFixed(0) + ' KB', 'tour', JSON.stringify(marks.map(m => m.tab + '@' + m.t.toFixed(1))));
  app.exit(0);
});
