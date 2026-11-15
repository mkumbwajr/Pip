'use strict';
// A small JSON settings store. One file, written atomically, with defaults merged in on read.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  firstRunDone: false,
  lang: 'sw',            // 'sw' Kiswahili (Tanzania) or 'en' English
  agentLanguage: true,   // ask the agents to answer in the app's language
  spotifyClientId: '',
  google: { clientId: '', secret: '' }, // your own Google "Desktop app" OAuth client, for calendar and the unread count
  hiddenTabs: [],        // tabs taken off the bar with Customize (Home always stays)
  agents: { claude: false, codex: false },
  island: { display: 0, mode: 'attach', opacity: 1, brightness: 0.1, scale: 1, openOn: 'hover', clock: 'auto', radios: true, artGlow: true }, // attach: joined to the top edge; detach: floating just below it. brightness: the tab colour behind the pages
  // openOn: 'hover' or 'click'. clock: 'auto' (the language's own), '12' or '24'. radios: Wi-Fi and Bluetooth in the strip. artGlow: the music tab takes the cover's colour
  homeStyle: 'clock',    // Home's layout: 'clock', 'dials', 'colours' or 'apps' (picked in the welcome or in Settings)
  country: '',           // from the welcome; only used to suggest the language
  mascot: { name: 'Pip', color: '#7c5cff', hat: 'none' },
  sounds: true,
  motionSounds: true,
  iphone: { messages: true, calls: true }, // Mac: iPhone messages (sender and first line) and incoming calls on the island    // the quiet sounds of the island moving (wake, rest, open, fold, music, phone)
  lyrics: true,
  songInfo: true,        // release year from iTunes Search (song title and artist are sent)
  weather: { place: '', lat: null, lon: null },
  calendarUrl: '',
  note: '',
  guard: { on: false, sites: ['youtube', 'tiktok', 'instagram', 'x.com', 'reddit'], snoozeMin: 5 },
  // Modes: a timer with three switches. block turns the focus guard on; music off pauses what is playing.
  modes: {
    work: { min: 50, block: true, only: true, music: true },
    study: { min: 45, block: true, only: true, music: false },
    sleep: { min: 30, block: true, only: true, music: false },
    game: { min: 60, block: false, only: true, music: true }
  },
  modeRestore: null,     // while a mode runs: what to put back when it stops ({ guardOn })
  buddyAgent: 'claude',
  autoUpdate: true,      // look for a newer Pip on pip.bang.co.tz by itself (at start and every six hours)
  updateOffered: '',
  trialNotice: 0,        // the trial end already announced (once, the day before)     // the newest update already announced, so the notification comes once per release
  shortcut: 'Control+Alt+Space'
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}

class Store {
  constructor(file) { this.file = file; this.data = merge(DEFAULTS, this.read()); }
  read() { try { const v = JSON.parse(fs.readFileSync(this.file, 'utf8')); return isObj(v) ? v : {}; } catch { return {}; } }
  get(key) { return key.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data); }
  all() { return JSON.parse(JSON.stringify(this.data)); }
  /** Back to the defaults, keeping only what is listed (e.g. which agents are connected, so their hooks stay in step). */
  reset(keep = []) { const k = {}; for (const key of keep) k[key] = this.data[key]; this.data = merge(DEFAULTS, {}); return this.set(k); }
  set(patch) {
    this.data = merge(this.data, patch);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    return this.all();
  }
}

module.exports = { Store, DEFAULTS, merge };
