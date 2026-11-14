'use strict';
// Peep: main process. Owns the island window, the tray icon, the hook hub and every bridge to the system.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, Notification, clipboard, shell, screen, nativeImage, desktopCapturer, safeStorage, net } = require('electron');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.js');
const { Hub } = require('./hooks-hub.js');
const hooks = require('./hook-install.js');
const { WinHelper } = require('./win-helper.js');
const { Share } = require('./share.js');
const { nextEvent } = require('./ics.js');
const { fetchLyrics } = require('./lyrics.js');
const { fetchSongInfo } = require('./songinfo.js');
const buddy = require('./buddy.js');
const { Spotify } = require('./spotify.js');
const { makeT } = require('../shared/i18n.js');

// Peep.exe --remove-hooks: take Peep's entries out of the agents' config files and leave. The uninstaller runs this.
if (process.argv.includes('--remove-hooks')) { try { hooks.uninstallClaude(); } catch {} try { hooks.uninstallCodex(); } catch {} app.exit(0); return; }
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.setAppUserModelId('dev.peep.app');

const data = (...p) => path.join(app.getPath('userData'), ...p);
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const ISLAND = { width: 700, height: 312 }; // room for the open panel (640 x 288), its shoulders and its shadow

let store, hub, island = null, settingsWin = null, guardWin = null, tray = null, share = null, spotify = null, quitting = false;
let strings = {}, t = makeT(strings);

// ---------- language ----------
const LOCALES = path.join(__dirname, '..', 'locales');
const LANG_NAMES = { en: 'English', sw: 'Kiswahili' };
const languages = () => [{ code: 'en', name: 'English' }, ...fs.readdirSync(LOCALES).filter(f => /^[a-z]{2}\.json$/.test(f)).map(f => ({ code: f.slice(0, 2), name: LANG_NAMES[f.slice(0, 2)] || f.slice(0, 2) }))];
function loadLanguage() {
  const code = store.get('lang'); strings = {};
  if (code !== 'en') { try { strings = JSON.parse(fs.readFileSync(path.join(LOCALES, code + '.json'), 'utf8')); } catch {} }
  t = makeT(strings);
}
// What the agents are told at the start of each session, so they answer the way the island speaks.
const AGENT_LANGUAGE = {
  sw: 'Language: always write your replies to the user in Swahili as it is spoken in Tanzania. Use everyday, conversational Swahili, mixed naturally with the English tech words Tanzanian developers actually use (Swanglish), for example "file", "code", "bug", "ku-run", "ku-edit", "ku-install". Do not use formal textbook Swahili and do not use Kenyan usage or Sheng. Keep code, commands, file names, error messages and identifiers exactly as they are; only your own explanations are in Swahili.'
};
const agentContext = () => (store.get('agentLanguage') ? AGENT_LANGUAGE[store.get('lang')] || '' : '');

// ---------- helper scripts for Claude Code (they need Node.js on the PC) ----------
let nodeOk = null;
function hasNode() { if (nodeOk === null) { try { nodeOk = spawnSync('node', ['-v'], { shell: process.platform === 'win32', windowsHide: true, timeout: 5000 }).status === 0; } catch { nodeOk = false; } } return nodeOk; }
const hookScript = name => path.join(__dirname, '..', 'hooks', name).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const claudeScripts = () => (hasNode() ? { reply: hookScript(hooks.REPLY_SCRIPT), status: hookScript(hooks.STATUS_SCRIPT) } : {});
const helper = new WinHelper();

function token() {
  const file = data('hook-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{48}$/.test(t)) return t; } catch {}
  const t = randomBytes(24).toString('hex'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, t); return t;
}
const send = (channel, payload) => { if (island && !island.isDestroyed()) island.webContents.send(channel, payload); };
// Chromium's own network stack: it follows the Windows proxy and certificate settings, which Node's fetch does not
const webFetch = (url, options) => net.fetch(url, options);

// ---------- the island window ----------
function displayFor() { const all = screen.getAllDisplays(); return all[store.get('island.display')] || screen.getPrimaryDisplay(); }
function placeIsland() {
  if (!island) return;
  const { x, y, width } = displayFor().bounds; // the very top of the screen: "attach" sits flush against it
  island.setBounds({ x: Math.round(x + (width - ISLAND.width) / 2), y, width: ISLAND.width, height: ISLAND.height });
}
function createIsland() {
  island = new BrowserWindow({
    ...ISLAND, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  island.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through until the pointer is over the island itself
  island.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  island.webContents.on('will-navigate', e => e.preventDefault());
  island.loadFile(path.join(RENDERER, 'island.html'));
  island.once('ready-to-show', () => { placeIsland(); island.showInactive(); });
  island.on('close', e => { if (!quitting) e.preventDefault(); });
}

// ---------- the settings window ----------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 1000, height: 700, minWidth: 760, minHeight: 520, title: t('Peep settings'), backgroundColor: '#0c0c10', autoHideMenuBar: true, icon: ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  settingsWin.setMenu(null);
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}
const changed = () => send('app:changed');

// ---------- tray ----------
function buildTray() {
  let image = nativeImage.createFromPath(ICON); if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image); tray.setToolTip('Peep');
  const menu = () => Menu.buildFromTemplate([
    { label: t('Open island'), click: () => send('island:toggle', true) },
    { label: t('Settings'), click: openSettings },
    { type: 'separator' },
    { label: t('Start with Windows'), type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: t('Quit Peep'), click: () => { quitting = true; app.quit(); } }
  ]);
  tray.on('click', () => send('island:toggle', true));
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
  tray.setContextMenu(menu()); tray.refresh = () => tray.setContextMenu(menu());
}
function bindShortcut() {
  globalShortcut.unregisterAll();
  try { globalShortcut.register(store.get('shortcut'), () => send('island:toggle')); } catch {}
}

// ---------- agents ----------
function agentState() { return { claude: hooks.claudeInstalled(), codex: hooks.codexInstalled() }; }
function connect(agent, on) {
  try {
    if (agent === 'claude') on ? hooks.installClaude({ token: token(), scripts: claudeScripts() }) : hooks.uninstallClaude();
    else if (agent === 'codex') on ? hooks.installCodex({ token: token() }) : hooks.uninstallCodex();
    else return { ok: false, error: '?' };
    store.set({ agents: { [agent]: Boolean(on) } });
    return { ok: true, agents: agentState() };
  } catch (e) { return { ok: false, error: String(e.message || e), agents: agentState() }; }
}

// ---------- extras: tray files, clipboard, weather, calendar, system ----------
const trayFile = () => data('tray.json');
let trayFiles = []; const clips = []; let lastClip = '';
const liveTray = () => trayFiles.filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
const trayView = () => liveTray().map(f => ({ path: f, name: path.basename(f), size: fs.statSync(f).size }));
function saveTray() { try { fs.writeFileSync(trayFile(), JSON.stringify(trayFiles)); } catch {} send('tray:changed', trayView()); }
function addToTray(paths) { for (const p of paths) { const f = path.resolve(String(p)); if (!trayFiles.includes(f)) trayFiles.unshift(f); } trayFiles = liveTray().slice(0, 30); saveTray(); }
function watchClipboard() {
  setInterval(async () => {
    let text = ''; try { text = await clipboard.readText(); } catch {} // a string, or a promise in newer Electron
    if (typeof text !== 'string' || !text || text === lastClip || text.length > 20000) return;
    lastClip = text; const i = clips.findIndex(c => c.text === text); if (i >= 0) clips.splice(i, 1);
    clips.unshift({ text, at: Date.now() }); clips.length = Math.min(clips.length, 10); // memory only: never written to disk
    send('clips:changed', clips);
  }, 1500);
}
const getJson = async url => { const r = await webFetch(url, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
let weatherCache = { at: 0, value: null };
async function weather() {
  const w = store.get('weather'); if (!w.place) return null;
  if (Date.now() - weatherCache.at < 20 * 60e3 && weatherCache.value?.place === w.place) return weatherCache.value;
  let { lat, lon } = w, name = w.place;
  if (lat == null || lon == null) {
    const g = await getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(w.place));
    const hit = g.results?.[0]; if (!hit) return null;
    lat = hit.latitude; lon = hit.longitude; store.set({ weather: { lat, lon } });
  }
  const f = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`);
  weatherCache = { at: Date.now(), value: { place: name, temp: Math.round(f.current.temperature_2m), unit: f.current_units?.temperature_2m || '°C', code: f.current.weather_code } };
  return weatherCache.value;
}
let calendarCache = { at: 0, url: '', text: '' };
async function calendar() {
  const url = store.get('calendarUrl'); if (!/^https:\/\//.test(url)) return null;
  if (calendarCache.url !== url || Date.now() - calendarCache.at > 10 * 60e3) {
    const r = await webFetch(url.replace(/^webcal:/, 'https:'), { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    calendarCache = { at: Date.now(), url, text: await r.text() };
  }
  const e = nextEvent(calendarCache.text); return e ? { title: e.title, start: e.start.getTime(), allDay: e.allDay } : null;
}
let cpuPrev = null;
function stats() {
  const now = os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  const cpu = cpuPrev && now.total > cpuPrev.total ? Math.round(100 * (1 - (now.idle - cpuPrev.idle) / (now.total - cpuPrev.total))) : 0;
  cpuPrev = now;
  return { cpu, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())) };
}

// ---------- focus guard: a pause before a distracting window ----------
const snoozed = new Map(); let guarding = null;
function checkGuard(front) {
  const g = store.get('guard'); if (!g.on || !front || guarding || guardWin) return;
  const hay = (front.title + ' ' + front.proc).toLowerCase();
  const hit = g.sites.map(s => String(s).toLowerCase().trim()).filter(Boolean).find(s => hay.includes(s)); if (!hit) return;
  if ((snoozed.get(hit) || 0) > Date.now()) return;
  guarding = { hit, hwnd: front.hwnd };
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  guardWin = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  guardWin.setAlwaysOnTop(true, 'screen-saver');
  guardWin.loadFile(path.join(RENDERER, 'guard.html'), { query: { what: hit } });
  guardWin.on('closed', () => { guardWin = null; guarding = null; });
}

// ---------- IPC: only Peep's own pages may call these ----------
const ours = e => String(e.senderFrame?.url || '').startsWith(pathToFileURL(RENDERER).href);
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (ours(e) ? fn(...args) : null));

function wireIpc() {
  handle('app:init', () => ({ version: app.getVersion(), platform: process.platform, settings: store.all(), ai: hub.snapshot(), agents: agentState(), win: helper.state,
    art: helper.art, tray: trayView(), clips, displays: screen.getAllDisplays().length, autostart: app.getLoginItemSettings().openAtLogin,
    strings, languages: languages(), node: hasNode(), spotify: spotify.connected }));
  handle('app:strings', () => strings);
  handle('settings:set', patch => {
    if (!patch || typeof patch !== 'object') return store.all();
    const before = store.all(), after = store.set(patch);
    if (before.shortcut !== after.shortcut) bindShortcut();
    if (before.island.display !== after.island.display) placeIsland();
    if (before.weather.place !== after.weather.place) { store.set({ weather: { lat: null, lon: null } }); weatherCache.at = 0; }
    if (before.lang !== after.lang) { loadLanguage(); tray?.refresh(); }
    hub.context = agentContext(); changed();
    return store.all();
  });
  handle('settings:open', () => openSettings());
  handle('autostart:set', on => { app.setLoginItemSettings({ openAtLogin: Boolean(on) }); return app.getLoginItemSettings().openAtLogin; });
  handle('agents:connect', (agent, on) => { const r = connect(String(agent), Boolean(on)); changed(); return r; });
  handle('ai:decide', (id, behavior) => hub.decide(String(id), String(behavior)));
  handle('ai:reply', (id, text) => hub.reply(String(id), String(text || '')));
  handle('radio:set', (kind, on) => ['WiFi', 'Bluetooth'].includes(kind) && helper.send({ cmd: 'radio', kind, on: Boolean(on) }));
  handle('spotify:login', async () => { try { await spotify.login(store.get('spotifyClientId')); changed(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('spotify:logout', () => { spotify.logout(); changed(); return { ok: true }; });
  handle('spotify:devices', async () => { try { return { ok: true, devices: await spotify.devices() }; } catch (e) { return { ok: false, error: String(e.message || e), connected: spotify.connected }; } });
  handle('spotify:transfer', async id => { try { await spotify.transfer(id); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('buddy:windows', async () => {
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 240, height: 150 } });
    return list.filter(s => s.name && s.name !== 'Peep' && !s.thumbnail.isEmpty()).slice(0, 12).map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  handle('media:cmd', action => ['toggle', 'next', 'prev'].includes(action) && helper.send({ cmd: 'media', action }));
  handle('media:seek', ms => helper.send({ cmd: 'seek', ms: Math.max(0, Math.round(Number(ms) || 0)) }));
  handle('volume:set', level => helper.send({ cmd: 'volume', level: Math.max(0, Math.min(100, Math.round(Number(level) || 0))) }));
  handle('lyrics:get', song => (store.get('lyrics') ? fetchLyrics(song || {}, { cacheDir: data('lyrics'), fetchImpl: webFetch }).catch(() => null) : null));
  handle('song:info', song => (store.get('songInfo') ? fetchSongInfo({ title: String(song?.title || ''), artist: String(song?.artist || '') }, { cacheDir: data('songinfo'), fetchImpl: webFetch }).catch(() => null) : null));
  handle('weather:get', () => weather().catch(e => ({ error: String(e.message || e) })));
  handle('calendar:get', () => calendar().catch(() => null));
  handle('stats:get', () => stats());
  handle('tray:add', paths => { addToTray(Array.isArray(paths) ? paths.slice(0, 50) : []); return trayView(); });
  handle('tray:remove', p => { trayFiles = trayFiles.filter(f => f !== p); saveTray(); return trayView(); });
  handle('tray:open', p => (trayFiles.includes(p) ? shell.showItemInFolder(p) : null));
  handle('clips:copy', text => { lastClip = String(text); clipboard.writeText(lastClip); return true; });
  handle('clips:clear', () => { clips.length = 0; send('clips:changed', clips); return clips; }); // lastClip stays, so the text still on the clipboard does not come straight back
  handle('app:quit', () => { quitting = true; app.quit(); });
  // a file from the tray dragged out of the island into another app (only files that are in the tray)
  ipcMain.on('tray:drag', (e, p) => {
    if (!ours(e) || !trayFiles.includes(p)) return;
    let icon = nativeImage.createFromPath(ICON); if (!icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });
    try { e.sender.startDrag({ file: p, icon }); } catch {}
  });
  handle('share:start', async () => {
    share ||= new Share({ t: (...a) => t(...a), files: liveTray, saveDir: path.join(app.getPath('downloads'), 'Peep'), onReceive: p => { addToTray([p]); new Notification({ title: 'Peep', body: t('Received {name}', { name: path.basename(p) }) }).show(); } });
    try { const s = await share.start(); return { ok: true, ...s, qr: await require('qrcode').toDataURL(s.url, { margin: 1, width: 220 }) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('share:stop', async () => { await share?.stop(); return { ok: true }; });
  handle('buddy:ask', async (question, windowId) => {
    question = String(question || '').trim().slice(0, 2000); if (!question) return { ok: false, error: t('Ask something first.') };
    try {
      let source;
      if (windowId) { // one window you picked
        source = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1200 } })).find(s => s.id === String(windowId));
      } else {        // the whole screen the island is on, with the island itself kept out of the picture
        const d = displayFor(), size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
        island.setOpacity(0);
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }).finally(() => island.setOpacity(1));
        source = sources.find(s => String(s.display_id) === String(d.id)) || sources[0];
      }
      if (!source || source.thumbnail.isEmpty()) throw new Error(t('Could not take the screenshot.'));
      return { ok: true, text: await buddy.ask({ agent: store.get('buddyAgent'), question, png: source.thumbnail.toPNG(), language: agentContext(), t: (...a) => t(...a) }) };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('guard:choice', back => {
    const g = guarding; if (!g) return;
    if (back) helper.send({ cmd: 'minimize', hwnd: g.hwnd }); else snoozed.set(g.hit, Date.now() + store.get('guard.snoozeMin') * 60e3);
    guardWin?.destroy();
  });
  ipcMain.on('island:mouse', (e, inside) => { if (ours(e) && island) island.setIgnoreMouseEvents(!inside, { forward: true }); });
  ipcMain.on('island:focus', (e, on) => { if (ours(e) && island) { if (on) island.focus(); else island.blur(); } });
}

// ---------- start ----------
app.whenReady().then(async () => {
  store = new Store(data('settings.json')); loadLanguage();
  const vault = data('spotify.bin');
  spotify = new Spotify({
    t: (...a) => t(...a), fetchImpl: webFetch,
    open: url => shell.openExternal(url),
    load: () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(vault))); } catch { return null; } },
    save: v => { try { if (v && safeStorage.isEncryptionAvailable()) fs.writeFileSync(vault, safeStorage.encryptString(JSON.stringify(v))); else fs.rmSync(vault, { force: true }); } catch {} }
  });
  try { const t = JSON.parse(fs.readFileSync(trayFile(), 'utf8')); if (Array.isArray(t)) trayFiles = t.map(String); } catch {}
  hub = new Hub({ token: token(), historyFile: data('history.json') });
  hub.context = agentContext();
  hub.on('change', snap => send('ai:state', snap));
  hub.on('finish', ({ session, entry }) => {
    send('ai:finish', entry);
    const name = session.agent === 'codex' ? 'Codex' : 'Claude Code';
    try { new Notification({ title: entry.state === 'done' ? t('{agent} is done', { agent: name }) : t('{agent} hit an error', { agent: name }), body: entry.project ? `${entry.project}: ${entry.prompt}` : entry.prompt, silent: true }).show(); } catch {}
  });
  let hubError = '';
  try { await hub.start(); } catch (e) { hubError = e.code === 'EADDRINUSE' ? t('Port 48611 is in use by another program.') : String(e.message || e); }
  setInterval(() => hub.sweep(), 30e3);
  // hooks carry the current token: keep connected agents in step (a reinstall or a wiped profile makes a new one)
  const a = agentState(); if (a.claude) connect('claude', true); if (a.codex) connect('codex', true);

  wireIpc(); handle('hub:error', () => hubError);
  createIsland(); buildTray(); bindShortcut(); watchClipboard();
  if (!store.get('firstRunDone')) { store.set({ firstRunDone: true }); openSettings(); } // first start: connect an agent
  helper.on('state', s => { send('win:state', s); checkGuard(s.front); });
  helper.on('art', art => send('win:art', art));
  // Pip's eyes follow the pointer wherever it is on the screen, so its position is sent while it moves (30 times a second at most)
  let lastPoint = '';
  setInterval(() => {
    if (!island || island.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), key = p.x + ',' + p.y; if (key === lastPoint) return;
    lastPoint = key; const b = island.getBounds(); send('cursor', { x: p.x - b.x, y: p.y - b.y });
  }, 33);
  helper.start();
  screen.on('display-metrics-changed', placeIsland); screen.on('display-added', placeIsland); screen.on('display-removed', placeIsland);
  app.on('second-instance', openSettings); // starting Peep again from the Start menu shows its settings
});
app.on('before-quit', () => { quitting = true; helper.stop(); hub?.stop(); share?.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
