'use strict';
// The macOS counterpart of win-helper.js, with the same events and commands, so the rest of Pip does not care which
// one runs. macOS has no system-wide "now playing" any app can read, so this asks the two players people use, Spotify
// and Apple Music, through AppleScript (JavaScript flavour, run by the built-in osascript), plus the system volume.
// macOS asks once whether Pip may control each player. Never run before a Mac build exists: see README.
// Wi-Fi and Bluetooth come from macOS's own tools (networksetup, ipconfig, system_profiler), every ten seconds.
// Not available on the Mac (yet): the front window (so the focus guard).
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const POLL_MS = 1500;
// One poll: the volume, then the first of Spotify / Music that is running and not stopped (a playing one wins).
// .running() does not start a player that is closed.
const READ = `function run() {
  var me = Application.currentApplication(); me.includeStandardAdditions = true;
  var out = { media: null, volume: null };
  try { var v = me.getVolumeSettings(); out.volume = { level: v.outputVolume, muted: v.outputMuted }; } catch (e) {}
  var players = ['Spotify', 'Music'];
  for (var i = 0; i < players.length; i++) {
    try {
      var name = players[i], p = Application(name); if (!p.running()) continue;
      var st = String(p.playerState()); if (st === 'stopped') continue;
      var t = p.currentTrack(), dur = Number(t.duration()) || 0, art = '';
      if (name === 'Spotify') { try { art = String(t.artworkUrl() || ''); } catch (e) {} }
      var m = { title: String(t.name() || ''), artist: String(t.artist() || ''), album: String(t.album() || ''), playing: st === 'playing',
        positionMs: Math.round((Number(p.playerPosition()) || 0) * 1000), durationMs: Math.round(name === 'Spotify' ? dur : dur * 1000), canSeek: true, app: name, artUrl: art };
      if (!out.media || m.playing) out.media = m; if (m.playing) break;
    } catch (e) {}
  }
  return JSON.stringify(out);
}`;
const run = (cmd, args, timeout = 6000) => new Promise(resolve => execFile(cmd, args, { timeout }, (err, out) => resolve(err ? null : String(out))));
const NET_MS = 10000;

/** The Wi-Fi device ("en0" on most Macs) from networksetup's list of ports. */
function wifiDevice(listing) { const m = String(listing || '').match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\S+)/); return m ? m[1] : null; }
/** "Wi-Fi Power (en0): On" -> true */
const wifiOn = text => /:\s*On\s*$/i.test(String(text || '').trim());
/** The network name from `ipconfig getsummary`; newer macOS hides it ("<redacted>") from apps without location access. */
function ssidOf(summary) { const m = String(summary || '').match(/^\s*SSID : (.+)$/m); const v = m ? m[1].trim() : ''; return v && !/redacted/i.test(v) ? v : ''; }
/** Bluetooth on or off from `system_profiler SPBluetoothDataType -json` (null when the Mac has no Bluetooth). */
function btOn(json) {
  try { const c = JSON.parse(json).SPBluetoothDataType?.[0]?.controller_properties; const st = String(c?.controller_state || c?.controller_powerState || ''); return st ? /on/i.test(st) : null; } catch { return null; }
}

const osa = (script, args = []) => new Promise(resolve => execFile('osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 4000 }, (err, out) => resolve(err ? null : String(out).trim())));

class MacHelper extends EventEmitter {
  constructor() { super(); this.state = { media: null, volume: null, front: null, net: null, at: 0 }; this.art = null; this.timer = null; this.busy = false; this.last = ''; this.lastAt = 0; this.player = 'Spotify'; this.net = null; this.wifiDev = undefined; this.netTimer = null; }
  start() {
    if (process.platform !== 'darwin' || this.timer) return;
    this.timer = setInterval(() => this.poll(), POLL_MS); this.poll();
    this.netTimer = setInterval(() => this.readNet(), NET_MS); this.readNet();
  }
  async poll() {
    if (this.busy) return; this.busy = true;
    try {
      const raw = await osa(READ); if (!raw) return;
      let s; try { s = JSON.parse(raw); } catch { return; }
      const m = s.media;
      if (m) this.player = m.app;
      // a new state when something you would see changed, and every ten seconds to keep the song position honest
      const key = JSON.stringify([m?.title, m?.artist, m?.playing, s.volume?.level, s.volume?.muted, this.net]);
      if (key === this.last && Date.now() - this.lastAt < 10000) return;
      this.last = key; this.lastAt = Date.now();
      const media = m ? { title: m.title, artist: m.artist, album: m.album, playing: m.playing, positionMs: m.positionMs, durationMs: m.durationMs, canSeek: m.canSeek, app: m.app } : null;
      this.state = { media, volume: s.volume, front: null, net: this.net, at: Date.now() };
      this.emit('state', this.state);
      const artKey = m ? `${m.title}|${m.artist}` : '';
      if (m && this.art?.key !== artKey) { this.art = { key: artKey, data: '' }; this.loadArt(artKey, m.artUrl); }
    } finally { this.busy = false; }
  }
  /** Wi-Fi (on, network name) and Bluetooth (on); the island shows an icon for each one the Mac has. */
  async readNet() {
    if (this.wifiDev === undefined) this.wifiDev = wifiDevice(await run('networksetup', ['-listallhardwareports']));
    const net = {};
    if (this.wifiDev) {
      const power = await run('networksetup', ['-getairportpower', this.wifiDev]);
      if (power !== null) { const on = wifiOn(power); net.wifi = { on, ssid: on ? ssidOf(await run('ipconfig', ['getsummary', this.wifiDev])) : '' }; }
    }
    const bt = btOn(await run('system_profiler', ['SPBluetoothDataType', '-json'], 15000));
    if (bt !== null) net.bt = { on: bt };
    const next = net.wifi || net.bt ? net : null;
    if (JSON.stringify(next) !== JSON.stringify(this.net)) { this.net = next; this.last = ''; this.poll(); } // show it at once
  }
  /** Spotify gives a link to the cover; Music gives none here, so Pip's own lookup (iTunes Search) fills it in. */
  async loadArt(key, url) {
    let data = '';
    if (/^https:\/\/i\.scdn\.co\//.test(url || '')) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length < 3e6) data = b.toString('base64'); } } catch {}
    }
    if (this.art?.key !== key) return;
    this.art = { key, data }; this.emit('art', this.art);
  }
  /** The same commands win-helper takes: media (toggle, next, prev), seek, volume. Others have nothing to do here. */
  send(c) {
    const p = JSON.stringify(this.player);
    if (c?.cmd === 'media') { const fn = { toggle: 'playpause', next: 'nextTrack', prev: 'previousTrack' }[c.action]; if (fn) osa(`Application(${p}).${fn}()`).then(() => { this.last = ''; this.poll(); }); return Boolean(fn); }
    if (c?.cmd === 'seek') { osa(`Application(${p}).playerPosition = ${Math.max(0, Number(c.ms) || 0) / 1000}`); this.last = ''; return true; }
    if (c?.cmd === 'radio' && c.kind === 'WiFi' && this.wifiDev) { run('networksetup', ['-setairportpower', this.wifiDev, c.on ? 'on' : 'off']).then(() => setTimeout(() => this.readNet(), 1500)); return true; }
    if (c?.cmd === 'radio' && c.kind === 'Bluetooth') { // macOS has no built-in switch: blueutil if it is installed, else Bluetooth settings
      const tool = ['/opt/homebrew/bin/blueutil', '/usr/local/bin/blueutil'].find(f => { try { return require('node:fs').existsSync(f); } catch { return false; } });
      if (tool) run(tool, ['--power', c.on ? '1' : '0']).then(() => setTimeout(() => this.readNet(), 1500));
      else run('open', ['x-apple.systempreferences:com.apple.BluetoothSettings']);
      return true;
    }
    if (c?.cmd === 'volume') { osa(`var a = Application.currentApplication(); a.includeStandardAdditions = true; a.setVolume(null, { outputVolume: ${Math.max(0, Math.min(100, Number(c.level) || 0))} })`); return true; }
    return false;
  }
  stop() { clearInterval(this.timer); clearInterval(this.netTimer); this.timer = this.netTimer = null; }
}

module.exports = { MacHelper, READ, wifiDevice, wifiOn, ssidOf, btOn };
