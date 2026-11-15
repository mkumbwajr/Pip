'use strict';
// Pip: main process. Owns the island window, the tray icon, the hook hub and every bridge to the system.
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
const { MacHelper } = require('./mac-helper.js');
const { Share } = require('./share.js');
const firewall = require('./firewall.js');
const { nextEvent } = require('./ics.js');
const { fetchLyrics, splitTitle } = require('./lyrics.js');
const { fetchSongInfo } = require('./songinfo.js');
const buddy = require('./buddy.js');
const { Spotify } = require('./spotify.js');
const { Google, clientFor } = require('./google.js');
const { Account } = require('./account.js');
const { Relay } = require('./relay.js');
const { latestRelease, isReleaseUrl } = require('./update.js');
const { License, deviceHash } = require('./license.js');
const { makeT } = require('../shared/i18n.js');

// Pip.exe --remove-hooks: take Pip's entries out of the agents' config files and leave. The uninstaller runs this.
if (process.argv.includes('--remove-hooks')) { try { hooks.uninstallClaude(); } catch {} try { hooks.uninstallCodex(); } catch {} app.exit(0); return; }
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
// Pip was called Peep before 0.5. On the first start after the update, bring the user's things over from Peep's
// folder: settings, the hook token, history, the files in the tray, Google and Spotify logins (encrypted with a key
// kept in "Local State", so that file comes too) and the lyrics, song and cover caches. Runs before Electron reads
// Local State; nothing is deleted from the old folder.
let migratedFromPeep = false;
(function migrateFromPeep() {
  try {
    const to = app.getPath('userData'), from = path.join(path.dirname(to), 'Peep');
    if (from === to || !fs.existsSync(from) || fs.existsSync(path.join(to, 'settings.json'))) return;
    fs.mkdirSync(to, { recursive: true });
    for (const f of ['settings.json', 'hook-token', 'history.json', 'tray.json', 'google.bin', 'spotify.bin', 'Local State']) {
      try { fs.copyFileSync(path.join(from, f), path.join(to, f)); } catch {}
    }
    for (const d of ['lyrics', 'songinfo', 'artwork']) { try { fs.cpSync(path.join(from, d), path.join(to, d), { recursive: true }); } catch {} }
    migratedFromPeep = true;
  } catch {}
})();
// Windows groups taskbar buttons and remembers their picture per app ID. Runs from source (npm start, tests) use their
// own ID, so the installed Pip never inherits Electron's icon from a development run on the same PC.
const APP_ID = app.isPackaged ? 'tz.co.bang.pip' : 'tz.co.bang.pip.dev';
app.setAppUserModelId(APP_ID);

const data = (...p) => path.join(app.getPath('userData'), ...p);
const RENDERER = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
// windows and the tray on Windows use the same multi-size .ico as Pip.exe, so every place shows the same Pip
const WIN_ICON = path.join(__dirname, '..', '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const ISLAND = { width: 700, height: 312 }; // room for the open panel (640 x 288), its shoulders and its shadow

let license = null, store, hub, island = null, settingsWin = null, guardWin = null, tray = null, share = null, spotify = null, google = null, account = null, relay = null, quitting = false;
let strings = {}, t = makeT(strings);

// ---------- language ----------
const LOCALES = path.join(__dirname, '..', 'locales');
const LANG_NAMES = { en: 'English', sw: 'Kiswahili' };
const languages = () => [{ code: 'en', name: 'English' }, ...fs.readdirSync(LOCALES).filter(f => /^[a-z]{2}\.json$/.test(f)).map(f => ({ code: f.slice(0, 2), name: LANG_NAMES[f.slice(0, 2)] || f.slice(0, 2) }))];
function loadLanguage() {
  const code = store.get('lang'); strings = {};
  if (code !== 'en') { try { strings = JSON.parse(fs.readFileSync(path.join(LOCALES, code + '.json'), 'utf8')); } catch {} }
  t = makeT(strings, { mac: process.platform === 'darwin' });
}
// What the agents are told at the start of each session, so they answer the way the island speaks.
const AGENT_LANGUAGE = {
  sw: 'Language: always write your replies to the user in Swahili as it is spoken in Tanzania. Use everyday, conversational Swahili, mixed naturally with the English tech words Tanzanian developers actually use (Swanglish), for example "file", "code", "bug", "ku-run", "ku-edit", "ku-install". Do not use formal textbook Swahili and do not use Kenyan usage or Sheng. Keep code, commands, file names, error messages and identifiers exactly as they are; only your own explanations are in Swahili.'
};
const agentContext = () => (store.get('agentLanguage') ? AGENT_LANGUAGE[store.get('lang')] || '' : '');
// Pip's own chat and screen questions always answer in Pip's language (the switch above is about the coding agents)
const pipLanguage = () => AGENT_LANGUAGE[store.get('lang')] || '';

// ---------- helper scripts for Claude Code (they need Node.js on the PC) ----------
let nodeOk = null;
function hasNode() { if (nodeOk === null) { try { nodeOk = spawnSync('node', ['-v'], { shell: process.platform === 'win32', windowsHide: true, timeout: 5000 }).status === 0; } catch { nodeOk = false; } } return nodeOk; }
const hookScript = name => path.join(__dirname, '..', 'hooks', name).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const claudeScripts = () => (hasNode() ? { reply: hookScript(hooks.REPLY_SCRIPT), status: hookScript(hooks.STATUS_SCRIPT) } : {});
const helper = process.platform === 'darwin' ? new MacHelper() : new WinHelper(); // the same events and commands on both
// A Mac app opened from the Dock gets a bare PATH (/usr/bin:/bin...), without Homebrew or npm's folders, so node,
// claude and codex would not be found. Ask the login shell once for the PATH a terminal would have.
if (process.platform === 'darwin') try {
  const r = spawnSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 4000 });
  const extra = String(r.stdout || '').trim().split(':').filter(p => p.startsWith('/'));
  process.env.PATH = [...new Set([...extra, ...String(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin'])].filter(Boolean).join(':');
} catch {}

function token() {
  const file = data('hook-token');
  try { const t = fs.readFileSync(file, 'utf8').trim(); if (/^[0-9a-f]{48}$/.test(t)) return t; } catch {}
  const t = randomBytes(24).toString('hex'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, t); return t;
}
const send = (channel, payload) => { if (island && !island.isDestroyed()) island.webContents.send(channel, payload); };
// Chromium's own network stack: it follows the Windows proxy and certificate settings, which Node's fetch does not
const webFetch = (url, options) => net.fetch(url, options);

// Windows shows a notification's app name and icon from the app ID's entry under HKCU\Software\Classes\AppUserModelId.
// Without it, toasts and pop-ups fall back to "Electron". Written per user (no admin), refreshed at every start because
// the icon file lives in Pip's own folder; the uninstaller removes the key.
function registerAppId() {
  if (process.platform !== 'win32') return;
  try {
    const png = data('pip-icon.png'); fs.mkdirSync(path.dirname(png), { recursive: true }); fs.writeFileSync(png, fs.readFileSync(ICON));
    fs.writeFileSync(data('pip-icon.ico'), fs.readFileSync(WIN_ICON)); // a real file the Windows shell can read (not inside app.asar)
    const key = 'HKCU\\Software\\Classes\\AppUserModelId\\' + APP_ID;
    for (const [name, value] of [['DisplayName', 'Pip'], ['IconUri', png], ['IconBackgroundColor', 'FF0C0C10']])
      spawnSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, timeout: 5000 });
  } catch {}
}

// Downloads, or <home>\Downloads when Windows cannot say where it is (an unusual profile)
const downloadsDir = () => { try { return app.getPath('downloads'); } catch { return path.join(os.homedir(), 'Downloads'); } };

// ---------- the island window ----------
// A Mac with a camera notch has a taller menu bar (about 37 points against 24). The folded island then sits behind the
// notch (its own height, the camera's width in the middle). Electron cannot see the notch itself, so this is measured.
function notchInfo() {
  if (process.platform !== 'darwin') return null;
  const d = displayFor(), bar = d.workArea.y - d.bounds.y;
  return bar >= 32 && d.bounds.y === 0 ? { width: 200, height: bar } : null;
}
function displayFor() { const all = screen.getAllDisplays(); return all[store.get('island.display')] || screen.getPrimaryDisplay(); }
// Island size (Settings, 80 to 140%): the page is zoomed and the window grows or shrinks with it, so nothing is cut off
const islandScale = () => Math.max(0.8, Math.min(1.4, Number(store?.get('island.scale')) || 1));
function placeIsland() {
  if (!island) return;
  const { x, y, width } = displayFor().bounds; // the very top of the screen: "attach" sits flush against it
  const k = islandScale(), w = Math.round(ISLAND.width * k), h = Math.round(ISLAND.height * k);
  island.setBounds({ x: Math.round(x + (width - w) / 2), y, width: w, height: h });
  island.webContents.setZoomFactor(k);
}
// Windows lets a newly opened topmost window (a browser pop-up, a full-screen video, another overlay) sit above Pip.
// Pip puts itself back in front whenever the window in front changes, and every few seconds as a safety net.
// moveTop does not take the keyboard focus, so typing in the other window is not interrupted.
// Only when another window has come to the front (and on blur), never on a timer: moving a transparent window to the
// top makes Windows repaint it, which showed as a flicker every few seconds.
function keepOnTop() {
  if (!island || island.isDestroyed() || !island.isVisible() || guardWin) return; // the focus guard's pause screen stays above
  if (!island.isAlwaysOnTop()) island.setAlwaysOnTop(true, 'screen-saver');
  island.moveTop();
}
function createIsland() {
  island = new BrowserWindow({
    ...ISLAND, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: true, icon: WIN_ICON,
    // macOS pushes windows down below the menu bar; a frameless window with this flag goes exactly where it is put,
    // so the island can sit at y=0, over the menu bar and around the camera notch
    enableLargerThanScreen: process.platform === 'darwin',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' }
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  island.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through until the pointer is over the island itself
  island.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  island.webContents.on('will-navigate', e => e.preventDefault());
  island.loadFile(path.join(RENDERER, 'island.html'));
  island.once('ready-to-show', () => { placeIsland(); island.showInactive(); keepOnTop(); });
  island.webContents.on('did-finish-load', () => island.webContents.setZoomFactor(islandScale()));
  island.on('blur', keepOnTop);
  island.on('close', e => { if (!quitting) e.preventDefault(); });
}

// A change to the settings, from the settings window, the island or another device (the Pip account): saved, then
// whatever depends on it follows (shortcut, island size and place, weather, language, the agents' language line).
function applySettings(patch) {
  if (!patch || typeof patch !== 'object') return store.all();
  const before = store.all(), after = store.set(patch);
  if (before.shortcut !== after.shortcut) bindShortcut();
  if (before.island.display !== after.island.display || before.island.scale !== after.island.scale) placeIsland();
  if (before.weather.place !== after.weather.place && !(patch.weather && 'lat' in patch.weather)) { store.set({ weather: { lat: null, lon: null } }); weatherCache.at = 0; }
  if (before.lang !== after.lang) { loadLanguage(); tray?.refresh(); }
  if (after.autoUpdate && !before.autoUpdate) checkForUpdate(); // switched back on: look now, not in six hours
  helper.watch = Boolean(after.guard.on); // the Mac reads browser tabs only while the focus guard is on
  hub.context = agentContext(); changed(); for (const w of [settingsWin, welcomeWin]) if (w && !w.isDestroyed()) w.webContents.send('app:changed');
  return store.all();
}

// ---------- the welcome: seven short steps the first time Pip starts ----------
let welcomeWin = null;
function openWelcome() {
  if (welcomeWin && !welcomeWin.isDestroyed()) { welcomeWin.show(); welcomeWin.focus(); return; }
  welcomeWin = new BrowserWindow({ width: 560, height: 660, resizable: false, maximizable: false, fullscreenable: false, title: 'Pip', backgroundColor: '#0c0c10', autoHideMenuBar: true, icon: WIN_ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  welcomeWin.setMenu(null);
  welcomeWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  welcomeWin.webContents.on('will-navigate', e => e.preventDefault());
  welcomeWin.loadFile(path.join(RENDERER, 'welcome.html'));
  welcomeWin.on('closed', () => { welcomeWin = null; });
}

// ---------- the settings window ----------
function openSettings(section) {
  section = /^[a-z]{2,20}$/.test(String(section || '')) ? section : '';
  if (settingsWin && !settingsWin.isDestroyed()) { if (section) settingsWin.webContents.send('settings:go', section); settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({ width: 1060, height: 740, minWidth: 820, minHeight: 560, title: t('Pip settings'), backgroundColor: '#0c0c10', autoHideMenuBar: true, icon: WIN_ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  settingsWin.setMenu(null);
  // The taskbar button takes its picture from these details, not from the cache Windows keeps per app ID (which can
  // still hold another picture, e.g. Electron's own while developing). Pip.exe when installed, else the .ico copy.
  if (process.platform === 'win32') try {
    settingsWin.setAppDetails({ appId: APP_ID, appIconPath: app.isPackaged ? process.execPath : data('pip-icon.ico'), appIconIndex: 0, relaunchDisplayName: 'Pip',
      relaunchCommand: app.isPackaged ? `"${process.execPath}"` : '' });
  } catch {}
  settingsWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'), section ? { hash: section } : undefined);
  settingsWin.on('closed', () => { settingsWin = null; });
}
const changed = () => send('app:changed');

// ---------- tray ----------
function buildTray() {
  // the .ico carries a hand-drawn 16 and 20 px Pip; Windows picks the one that fits the tray
  let image = nativeImage.createFromPath(WIN_ICON);
  if (process.platform === 'darwin') { image = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png')); image.setTemplateImage(true); } // the Mac menu bar wants a black template it tints itself
  tray = new Tray(image); tray.setToolTip('Pip');
  const menu = () => Menu.buildFromTemplate([
    { label: t('Open island'), click: () => send('island:toggle', true) },
    { label: t('Settings'), click: openSettings },
    { type: 'separator' },
    { label: process.platform === 'darwin' ? t('Open at login') : t('Start with Windows'), type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: t('Quit Pip'), click: () => { quitting = true; app.quit(); } }
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
function saveTray() { try { fs.writeFileSync(trayFile(), JSON.stringify(trayFiles)); } catch {} send('tray:changed', trayView()); relay?.offer(liveTray()).catch(() => {}); } // a phone on another network sees new tray files too
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

// ---------- cover art for songs whose player gives none: from iTunes Search (the same switch as the release year) ----------
async function fillArtwork(key, replaceTiny = false) {
  if (!store.get('songInfo') || !key) return;
  const [title, artist] = key.split('|'), song = splitTitle(title, artist);
  const file = data('artwork', require('node:crypto').createHash('sha1').update(key.toLowerCase()).digest('hex') + '.jpg');
  let b64 = '';
  try { b64 = fs.readFileSync(file).toString('base64'); } catch {
    const info = await fetchSongInfo(song, { cacheDir: data('songinfo'), fetchImpl: webFetch }).catch(() => null);
    if (!info?.artwork) return;
    const r = await webFetch(info.artwork, { signal: AbortSignal.timeout(10000) }).catch(() => null); if (!r?.ok) return;
    const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > 3e6) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); } catch {}
    b64 = buf.toString('base64');
  }
  if (helper.art?.key !== key || (helper.art.data && !(replaceTiny && helper.art.data.length <= 3000))) return; // the song changed meanwhile, or the player sent a real cover
  helper.art = { key, data: b64 }; send('win:art', helper.art);
}

// The moment a new song starts, its lyrics and its release details are looked up (both cached on disk), so the island
// finds them ready instead of starting the lookups only when it asks.
function prefetchSong(m) {
  if (store.get('lyrics')) fetchLyrics({ title: m.title, artist: m.artist, durationSec: Math.round((m.durationMs || 0) / 1000) }, { cacheDir: data('lyrics'), fetchImpl: webFetch }).catch(() => {});
  if (store.get('songInfo')) fetchSongInfo(splitTitle(m.title, m.artist), { cacheDir: data('songinfo'), fetchImpl: webFetch }).catch(() => {});
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
  // covers the screen with a light dim (drawn by the page) so the distracting window waits behind it; shown only once
  // drawn, so there is no white flash, and focused so Esc and the buttons work straight away
  guardWin = new BrowserWindow({ ...d.bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, minimizable: false, maximizable: false, show: false, title: 'Pip', icon: WIN_ICON,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  guardWin.setAlwaysOnTop(true, 'screen-saver');
  guardWin.once('ready-to-show', () => { guardWin?.show(); guardWin?.focus(); });
  guardWin.loadFile(path.join(RENDERER, 'guard.html'), { query: { what: hit } });
  guardWin.on('closed', () => { guardWin = null; guarding = null; });
}

// ---------- IPC: only Pip's own pages may call these ----------
const ours = e => String(e.senderFrame?.url || '').startsWith(pathToFileURL(RENDERER).href);
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (ours(e) ? fn(...args) : null));

function wireIpc() {
  handle('app:init', () => ({ version: app.getVersion(), platform: process.platform, notch: notchInfo(), settings: store.all(), ai: hub.snapshot(), agents: agentState(), win: helper.state,
    art: helper.art, tray: trayView(), clips, displays: screen.getAllDisplays().length, autostart: app.getLoginItemSettings().openAtLogin,
    strings, languages: languages(), node: hasNode(), spotify: spotify.connected, google: google.connected, googleBuiltIn: Boolean(clientFor(null)), account: account.status(), license: license.view() }));
  handle('app:strings', () => strings);
  handle('settings:set', patch => { const all = applySettings(patch); account?.changed(); return all; });
  // the Pip account (optional): Google says who you are, Pip's server keeps your preferences for your other devices
  handle('account:status', () => account.status());
  handle('account:signin', async () => {
    const c = clientFor(null); // the account server knows only the Google client Pip ships with
    if (!c) return { ok: false, error: t('This build of Pip has no Google sign-in, so it cannot use a Pip account.') };
    try { const how = await account.signIn(await google.identity(c.clientId, c.secret)); checkLicense(); return { ok: true, how, ...account.status() }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('account:emailCode', async email => { try { await account.emailCode(String(email || '').trim(), store.get('lang')); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('account:emailVerify', async (email, code) => {
    try { const how = await account.signInEmail(String(email || '').trim(), String(code || '').replace(/\D/g, '')); checkLicense(); return { ok: true, how, ...account.status() }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('account:sync', async () => { try { if (!(await account.pull())) await account.push(); return { ok: true, ...account.status() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('account:signout', async () => { await account.signOut(); checkLicense(); return account.status(); });
  // the license: the trial, buying it (EvPay, through Pip's server), and how a payment is going
  handle('license:status', () => license.view());
  handle('license:check', async () => { await checkLicense(); return license.view(); });
  handle('license:payMobile', async (phone, operator) => {
    try { return { ok: true, ...(await license.payMobile(String(phone || '').slice(0, 20), operator ? String(operator) : '')) }; }
    catch (e) { return { ok: false, error: payError(e) }; }
  });
  handle('license:payCard', async () => {
    try {
      const r = await license.payCard(account.status().email || '');
      if (!/^https:\/\//.test(String(r.checkoutUrl || ''))) throw new Error('EvPay did not return a card page');
      shell.openExternal(r.checkoutUrl); return { ok: true, order: r.order };
    } catch (e) { return { ok: false, error: payError(e) }; }
  });
  handle('license:order', async ref => { try { const r = await license.order(String(ref || '')); if (r.licensed) licenseChanged(); return { ok: true, ...r }; } catch (e) { return { ok: false, error: payError(e) }; } });
  handle('license:buy', () => { send('island:buy'); });
  handle('account:delete', async () => { try { await account.remove(); checkLicense(); return { ok: true, ...account.status() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('settings:open', section => openSettings(section));
  handle('autostart:set', on => { app.setLoginItemSettings({ openAtLogin: Boolean(on) }); return app.getLoginItemSettings().openAtLogin; });
  handle('agents:connect', (agent, on) => { const r = connect(String(agent), Boolean(on)); changed(); return r; });
  handle('ai:decide', (id, behavior) => hub.decide(String(id), String(behavior)));
  handle('ai:reply', (id, text) => hub.reply(String(id), String(text || '')));
  handle('radio:set', (kind, on) => ['WiFi', 'Bluetooth'].includes(kind) && helper.send({ cmd: 'radio', kind, on: Boolean(on) }));
  handle('spotify:login', async () => { try { await spotify.login(store.get('spotifyClientId')); changed(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('spotify:logout', () => { spotify.logout(); changed(); return { ok: true }; });
  handle('spotify:devices', async () => { try { return { ok: true, devices: await spotify.devices() }; } catch (e) { return { ok: false, error: String(e.message || e), connected: spotify.connected }; } });
  handle('spotify:transfer', async id => { try { await spotify.transfer(id); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('google:login', async () => {
    const c = clientFor(store.get('google')); if (!c) return { ok: false, error: t('Paste the client ID and client secret of your Google desktop app first.'), needsClient: true };
    try { await google.login(c.clientId, c.secret); changed(); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('google:logout', () => { google.logout(); changed(); return { ok: true }; });
  handle('google:events', async (from, to) => { try { return { ok: true, events: await google.events(Number(from), Number(to)) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('google:unread', async () => { try { return { ok: true, count: await google.unread() }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  // Pip agent: a new chat with the question filled in, in the user's browser (nothing is sent until they press enter there)
  handle('agent:open', (which, question) => {
    const q = encodeURIComponent(String(question || '').slice(0, 4000));
    const url = which === 'chatgpt' ? 'https://chatgpt.com/?q=' + q : which === 'claude' ? 'https://claude.ai/new?q=' + q : null;
    return url ? shell.openExternal(url) : null;
  });
  handle('pip:chat', async messages => {
    const list = (Array.isArray(messages) ? messages : []).filter(m => m && (m.role === 'me' || m.role === 'pip')).map(m => ({ role: m.role, text: String(m.text || '').slice(0, 4000) }));
    if (!list.length || list[list.length - 1].role !== 'me') return { ok: false, error: t('Ask something first.') };
    try { return { ok: true, text: await buddy.chat({ agent: store.get('buddyAgent'), messages: list, name: store.get('mascot').name || 'Pip', language: pipLanguage(), t: (...a) => t(...a) }) }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  handle('art:fill', key => { if (helper.art?.key === String(key) && !(helper.art.data && helper.art.data.length > 3000)) fillArtwork(String(key), true); });
  handle('google:openInbox', () => shell.openExternal('https://mail.google.com/mail/u/0/#inbox'));
  // Updates: asks GitHub (only when you press the button) for the newest release, and opens its page to download it
  handle('app:update', async () => { try { return { ok: true, ...(await latestRelease({ current: app.getVersion(), fetchImpl: webFetch })) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  handle('app:release', url => (isReleaseUrl(url) ? shell.openExternal(String(url)) : null));
  // links in Settings and the welcome: only Pip's own website and its GitHub page
  handle('app:link', url => (/^https:\/\/(pip\.bang\.co\.tz|github\.com\/mkumbwajr\/Pip)(\/|$)/.test(String(url)) ? shell.openExternal(String(url)) : null));
  handle('app:restart', () => { quitting = true; app.relaunch(); app.exit(0); });
  handle('settings:reset', () => { store.reset(['agents', 'firstRunDone', 'google', 'spotifyClientId', 'note']); placeIsland(); bindShortcut(); changed(); return store.all(); });
  handle('welcome:open', () => openWelcome());
  handle('welcome:done', () => { if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close(); send('island:toggle', true); });
  handle('buddy:windows', async () => {
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 240, height: 150 } });
    return list.filter(s => s.name && s.name !== 'Pip' && !s.thumbnail.isEmpty()).slice(0, 12).map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  handle('media:cmd', action => ['toggle', 'next', 'prev'].includes(action) && helper.send({ cmd: 'media', action }));
  handle('media:seek', ms => helper.send({ cmd: 'seek', ms: Math.max(0, Math.round(Number(ms) || 0)) }));
  handle('volume:set', level => helper.send({ cmd: 'volume', level: Math.max(0, Math.min(100, Math.round(Number(level) || 0))) }));
  handle('lyrics:get', song => (store.get('lyrics') ? fetchLyrics(song || {}, { cacheDir: data('lyrics'), fetchImpl: webFetch }).catch(() => null) : [])); // null only when lrclib could not be reached
  handle('song:info', song => (store.get('songInfo') ? fetchSongInfo({ title: String(song?.title || ''), artist: String(song?.artist || '') }, { cacheDir: data('songinfo'), fetchImpl: webFetch }).catch(() => null) : null));
  handle('weather:get', () => weather().catch(e => ({ error: String(e.message || e) })));
  handle('calendar:get', () => calendar().catch(() => null));
  handle('stats:get', () => stats());
  handle('tray:add', paths => { addToTray(Array.isArray(paths) ? paths.slice(0, 50) : []); return trayView(); });
  handle('tray:remove', p => { trayFiles = trayFiles.filter(f => f !== p); saveTray(); return trayView(); });
  handle('tray:open', p => (trayFiles.includes(p) ? shell.showItemInFolder(p) : null));
  handle('clips:copy', text => { lastClip = String(text); clipboard.writeText(lastClip); return true; });
  handle('clips:last', () => clips[0]?.text || '');
  handle('clips:clear', () => { clips.length = 0; send('clips:changed', clips); return clips; }); // lastClip stays, so the text still on the clipboard does not come straight back
  handle('app:quit', () => { quitting = true; app.quit(); });
  // a file from the tray dragged out of the island into another app (only files that are in the tray)
  ipcMain.on('tray:drag', (e, p) => {
    if (!ours(e) || !trayFiles.includes(p)) return;
    let icon = nativeImage.createFromPath(ICON); if (!icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });
    try { e.sender.startDrag({ file: p, icon }); } catch {}
  });
  handle('share:start', async () => {
    const received = p => { addToTray([p]); send('share:progress', { name: path.basename(p), done: true }); new Notification({ title: 'Pip', icon: ICON, body: t('Received {name}', { name: path.basename(p) }) }).show(); };
    share ||= new Share({ t: (...a) => t(...a), files: liveTray, saveDir: path.join(downloadsDir(), 'Pip'), onProgress: p => send('share:progress', p), onReceive: received });
    let lan = null; try { lan = await share.start(); } catch {}
    // any network: the encrypted relay on Pip's server. The QR code opens it; the same-Wi-Fi page keeps working beside it.
    let far = '';
    try {
      if (!relay) { relay = new Relay({ saveDir: path.join(downloadsDir(), 'Pip'), fetchImpl: webFetch, onProgress: p => send('share:progress', p), onReceive: received }); far = await relay.start(); relay.offer(liveTray()).catch(() => {}); }
      else far = relay.url;
    } catch { relay = null; }
    const url = far || lan?.url; if (!url) return { ok: false, error: t('This PC is not on a network.') };
    // margin 4 is the quiet zone the QR standard asks for: phone cameras need it to find the code
    return { ok: true, on: true, url, anyNetwork: Boolean(far), lan: lan?.url || '', firewall: far ? true : firewall.hasRule(), qr: await require('qrcode').toDataURL(url, { margin: 4, width: 264, errorCorrectionLevel: 'M' }) };
  });
  handle('share:stop', async () => { await share?.stop(); await relay?.stop(); relay = null; return { ok: true }; });
  handle('share:firewall', async () => ({ ok: await firewall.addRule() }));
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
      return { ok: true, text: await buddy.ask({ agent: store.get('buddyAgent'), question, png: source.thumbnail.toPNG(), language: pipLanguage(), t: (...a) => t(...a) }) };
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
// ---------- the license ----------
// This device's ID for the trial: Windows' MachineGuid, the Mac's hardware UUID, or a random one Pip keeps. Only a
// hash of it ever leaves the computer (license.js).
function machineId() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-f-]{20,})/i.exec(r.stdout || ''); if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const r = spawnSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = /"IOPlatformUUID"\s*=\s*"([0-9A-F-]{20,})"/i.exec(r.stdout || ''); if (m) return m[1];
    }
  } catch {}
  const file = data('device-id');
  try { const id = fs.readFileSync(file, 'utf8').trim(); if (id) return id; } catch {}
  const id = randomBytes(16).toString('hex'); try { fs.writeFileSync(file, id); } catch {} return id;
}
let deviceId = null;
function licenseChanged() {
  const v = license.view(); send('license:changed', v);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('app:changed');
  // one notification the day before the trial ends
  if (v.selling && !v.licensed && !v.locked && v.daysLeft === 1 && store.get('trialNotice') !== v.trialEndsAt) {
    store.set({ trialNotice: v.trialEndsAt });
    try { new Notification({ title: t('Your Pip trial ends tomorrow'), icon: ICON, body: t('Buy Pip once for TSh {price} to keep every tab.', { price: v.priceTzs.toLocaleString('en') }) }).show(); } catch {}
  }
}
async function checkLicense() { try { await license.check(); } catch {} licenseChanged(); }
// the server's answers (English), in the app's language
const PAY_SAYS = {
  'That phone number does not look right': () => t('That phone number does not look right.'),
  'That network is not supported': () => t('That mobile network is not supported.'),
  'Payments are not set up yet': () => t('Payments are not open yet. Try again later.'),
  'Too many payment attempts. Try again in an hour.': () => t('Too many payment attempts. Try again in an hour.'),
  'This account already has a license': () => t('This account already has Pip.'),
  'Sign in again': () => t('Sign in to your Pip account first.')
};
function payError(e) { const m = String(e.message || e); return PAY_SAYS[m] ? PAY_SAYS[m]() : t('The payment could not be started: {error}', { error: m }); }

// A newer installer on pip.bang.co.tz (a higher version, or the same version built later): offered once with a
// notification that opens the download, and kept in the island's menu until Pip is updated. Settings can switch it off.
let updateTimer = null;
async function checkForUpdate() {
  if (!store.get('autoUpdate')) return;
  try {
    const u = await latestRelease({ current: app.getVersion(), fetchImpl: webFetch });
    if (!u.newer || !isReleaseUrl(u.url)) return;
    send('update:available', { ok: true, ...u });
    const key = u.latest + '+' + (u.build || '');
    if (store.get('updateOffered') === key) return;
    store.set({ updateOffered: key });
    const n = new Notification({ title: t('A new Pip is ready'), icon: ICON, body: t('Pip {version} is out. Click to download it.', { version: u.latest }) });
    n.on('click', () => shell.openExternal(u.url)); n.show();
  } catch {}
}
function scheduleUpdates() { clearInterval(updateTimer); setTimeout(checkForUpdate, 60e3); updateTimer = setInterval(checkForUpdate, 6 * 3600e3); }

app.whenReady().then(async () => {
  store = new Store(data('settings.json')); loadLanguage(); registerAppId();
  // Peep started with Windows: Pip takes over that place, and Peep's own start-up entry goes
  if (migratedFromPeep && process.platform === 'win32') {
    const run = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const had = ['electron.app.Peep', 'Peep'].filter(v => spawnSync('reg', ['query', run, '/v', v], { windowsHide: true }).status === 0);
    if (had.length) { app.setLoginItemSettings({ openAtLogin: true }); for (const v of had) spawnSync('reg', ['delete', run, '/v', v, '/f'], { windowsHide: true }); }
  }
  const vault = data('spotify.bin');
  spotify = new Spotify({
    t: (...a) => t(...a), fetchImpl: webFetch,
    open: url => shell.openExternal(url),
    load: () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(vault))); } catch { return null; } },
    save: v => { try { if (v && safeStorage.isEncryptionAvailable()) fs.writeFileSync(vault, safeStorage.encryptString(JSON.stringify(v))); else fs.rmSync(vault, { force: true }); } catch {} }
  });
  const avault = data('account.bin');
  account = new Account({
    t: (...a) => t(...a), fetchImpl: webFetch, getSettings: () => store.all(), apply: patch => applySettings(patch),
    load: () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(avault))); } catch { return null; } },
    save: v => { try { if (v && safeStorage.isEncryptionAvailable()) fs.writeFileSync(avault, safeStorage.encryptString(JSON.stringify(v))); else fs.rmSync(avault, { force: true }); } catch {} }
  });
  // another device may have changed something: look shortly after start, then every ten minutes
  const pullAccount = () => account.pull().catch(e => { account.error = String(e.message || e); });
  setTimeout(pullAccount, 5000); setInterval(pullAccount, 10 * 60e3);
  scheduleUpdates();
  deviceId = deviceHash(machineId());
  license = new License({
    fetchImpl: webFetch, device: () => deviceId, token: () => account?.session?.token || '',
    load: () => { try { return JSON.parse(fs.readFileSync(data('license.json'), 'utf8')); } catch { return null; } },
    save: v => { try { fs.writeFileSync(data('license.json'), JSON.stringify(v)); } catch {} }
  });
  setTimeout(checkLicense, 3000); setInterval(checkLicense, 6 * 3600e3);
  const gvault = data('google.bin');
  google = new Google({
    t: (...a) => t(...a), fetchImpl: webFetch, open: url => shell.openExternal(url),
    load: () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(gvault))); } catch { return null; } },
    save: v => { try { if (v && safeStorage.isEncryptionAvailable()) fs.writeFileSync(gvault, safeStorage.encryptString(JSON.stringify(v))); else fs.rmSync(gvault, { force: true }); } catch {} }
  });
  try { const t = JSON.parse(fs.readFileSync(trayFile(), 'utf8')); if (Array.isArray(t)) trayFiles = t.map(String); } catch {}
  hub = new Hub({ token: token(), historyFile: data('history.json') });
  hub.context = agentContext();
  hub.on('change', snap => send('ai:state', snap));
  hub.on('finish', ({ session, entry }) => {
    send('ai:finish', entry);
    const name = session.agent === 'codex' ? 'Codex' : 'Claude Code';
    try { new Notification({ title: entry.state === 'done' ? t('{agent} is done', { agent: name }) : t('{agent} hit an error', { agent: name }), icon: ICON, body: entry.project ? `${entry.project}: ${entry.prompt}` : entry.prompt, silent: true }).show(); } catch {}
  });
  let hubError = '';
  try { await hub.start(); } catch (e) { hubError = e.code === 'EADDRINUSE' ? t('Port 48611 is in use by another program.') : String(e.message || e); }
  setInterval(() => hub.sweep(), 30e3);
  // hooks carry the current token: keep connected agents in step (a reinstall or a wiped profile makes a new one)
  // also when Peep (Pip's earlier name) was connected: its entries are replaced by Pip's own
  const a = agentState(), was = store.get('agents');
  if (a.claude || was.claude) connect('claude', true); if (a.codex || was.codex) connect('codex', true);

  wireIpc(); handle('hub:error', () => hubError);
  createIsland(); buildTray(); bindShortcut(); watchClipboard();
  if (!store.get('firstRunDone')) { store.set({ firstRunDone: true }); openWelcome(); } // first start: the welcome, which also connects an agent
  let lastFront = null;
  let lastSong = '';
  helper.on('state', s => { const k = s.media ? s.media.title + '|' + s.media.artist : ''; if (k && k !== lastSong) { lastSong = k; prefetchSong(s.media); }
    send('win:state', s); checkGuard(s.front); if (s.front?.hwnd !== lastFront) { lastFront = s.front?.hwnd; keepOnTop(); } });
  // the Mac helper says when it installs blueutil (to switch Bluetooth), so a click that takes a while is explained
  helper.on('notice', what => { const body = { 'blueutil-installing': t('Installing blueutil with Homebrew, so Pip can switch Bluetooth…'), 'blueutil-ready': t('Bluetooth can now be switched from the island.'), 'blueutil-failed': t('Could not install blueutil. Opening Bluetooth settings instead.') }[what];
    if (body) try { new Notification({ title: 'Pip', icon: ICON, body, silent: true }).show(); } catch {} });
  helper.on('art', art => { send('win:art', art); if (!art.data) fillArtwork(art.key); });
  // Pip's eyes follow the pointer wherever it is on the screen, so its position is sent while it moves (30 times a second at most)
  let lastPoint = '';
  setInterval(() => {
    if (!island || island.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), key = p.x + ',' + p.y; if (key === lastPoint) return;
    lastPoint = key; const b = island.getBounds(), k = islandScale(); send('cursor', { x: (p.x - b.x) / k, y: (p.y - b.y) / k }); // in the page's own (zoomed) pixels
  }, 33);
  helper.watch = Boolean(store.get('guard').on); helper.start();
  screen.on('display-metrics-changed', placeIsland); screen.on('display-added', placeIsland); screen.on('display-removed', placeIsland);
  app.on('second-instance', openSettings); // starting Pip again from the Start menu shows its settings
});
app.on('before-quit', () => { quitting = true; helper.stop(); hub?.stop(); share?.stop(); relay?.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
