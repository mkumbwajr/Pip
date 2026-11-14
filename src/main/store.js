'use strict';
// A small JSON settings store. One file, written atomically, with defaults merged in on read.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  firstRunDone: false,
  lang: 'sw',            // 'sw' Kiswahili (Tanzania) or 'en' English
  agentLanguage: true,   // ask the agents to answer in the app's language
  spotifyClientId: '',
  agents: { claude: false, codex: false },
  island: { display: 0, scale: 1 },
  mascot: { name: 'Pip', color: '#7c5cff', hat: 'none' },
  sounds: true,
  lyrics: true,
  weather: { place: '', lat: null, lon: null },
  calendarUrl: '',
  note: '',
  guard: { on: false, sites: ['youtube', 'tiktok', 'instagram', 'x.com', 'reddit'], snoozeMin: 5 },
  buddyAgent: 'claude',
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
