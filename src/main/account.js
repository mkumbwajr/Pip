'use strict';
// The optional Pip account: your preferences, note, weather town and calendar link, kept on Pip's server
// (pip.bang.co.tz/api, server/pip-api.py) so another PC or Mac signed in to the same account picks them up.
// Sign-in is Google's (who you are, nothing else); the server hands back a session token, stored encrypted here.
// Nothing device-bound syncs: which agents are connected, logins (Google, Spotify), the screen the island sits on.
// Changes win by time: the newest save, from whichever device, is what every device ends up with.

const BASE = 'https://pip.bang.co.tz/api';
// the server's messages (English), in the app's language
const SERVER_SAYS = {
  'That email address does not look right': t => t('That email address does not look right.'),
  'Too many codes asked for. Try again in an hour.': t => t('Too many codes asked for. Try again in an hour.'),
  'The email could not be sent. Try again.': t => t('The email could not be sent. Try again.'),
  'That code has expired. Ask for a new one.': t => t('That code has expired. Ask for a new one.'),
  'That code is not right.': t => t('That code is not right.')
};
// what travels; dotted names take one field of an object
const SYNC = ['lang', 'country', 'agentLanguage', 'buddyAgent', 'hiddenTabs', 'homeStyle', 'mascot', 'sounds', 'lyrics', 'songInfo',
  'weather', 'calendarUrl', 'note', 'guard', 'modes', 'shortcut',
  'island.mode', 'island.opacity', 'island.brightness', 'island.scale', 'island.openOn', 'island.clock', 'island.radios', 'island.artGlow'];

/** The part of the settings that syncs, as a nested object. */
function pick(settings) {
  const out = {};
  for (const key of SYNC) {
    const [a, b] = key.split('.'), v = b ? settings?.[a]?.[b] : settings?.[a];
    if (v === undefined) continue;
    if (b) (out[a] ||= {})[b] = v; else out[a] = v;
  }
  return JSON.parse(JSON.stringify(out));
}

class Account {
  /** load/save: the session ({ token, email, syncedAt }), stored encrypted by the main process.
      getSettings(): all settings; apply(patch): sets them the way the settings window does (the island follows). */
  constructor({ load, save, getSettings, apply, fetchImpl = fetch, base = BASE, t = s => s }) {
    Object.assign(this, { load, save, getSettings, apply, fetchImpl, base, t });
    this.session = load() || null; this.timer = null; this.applying = false; this.error = '';
  }
  get signedIn() { return Boolean(this.session?.token); }
  status() { return { signedIn: this.signedIn, email: this.session?.email || '', syncedAt: this.session?.syncedAt || 0, error: this.error }; }

  async call(method, path, body) {
    const r = await this.fetchImpl(this.base + path, { method, headers: { 'Content-Type': 'application/json', ...(this.session?.token ? { Authorization: 'Bearer ' + this.session.token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login' && !path.startsWith('/email/')) { this.forget(); throw new Error(this.t('Your Pip account signed out. Sign in again.')); }
    if (!r.ok) throw new Error(SERVER_SAYS[j.error]?.(this.t) || j.error || this.t('Pip\'s server said no ({code}).', { code: r.status }));
    return j;
  }
  remember(patch) { this.session = { ...this.session, ...patch }; this.save(this.session); }
  forget() { clearTimeout(this.timer); this.session = null; this.save(null); }

  /** Signs in with a Google ID token. Returns 'restored' when the account already had preferences (now on this
      device too), or 'saved' when this device's preferences became the account's. */
  async signIn(idToken) { return this.finish(await this.call('POST', '/login', { idToken })); }
  /** Email sign-in, step 1: Pip's server emails a six-digit code (from no-reply@bang.co.tz). */
  async emailCode(email, lang) { await this.call('POST', '/email/start', { email, lang }); }
  /** Step 2: the code from that email. Same outcome as signIn. */
  async signInEmail(email, code) { return this.finish(await this.call('POST', '/email/verify', { email, code })); }
  async finish(j) {
    this.remember({ token: j.token, email: j.email, syncedAt: 0 });
    const remote = await this.call('GET', '/prefs');
    if (remote.data) { this.take(remote); return 'restored'; }
    await this.push(); return 'saved';
  }
  /** This device's preferences up to the account (called a moment after each change). */
  async push() {
    if (!this.signedIn) return;
    const updatedAt = Date.now();
    await this.call('PUT', '/prefs', { data: pick(this.getSettings()), updatedAt });
    this.remember({ syncedAt: updatedAt }); this.error = '';
  }
  /** Takes the account's preferences when they are newer than what this device last saw. */
  async pull() {
    if (!this.signedIn) return false;
    const remote = await this.call('GET', '/prefs'); this.error = '';
    if (!remote.data || remote.updatedAt <= (this.session.syncedAt || 0)) return false;
    this.take(remote); return true;
  }
  take(remote) {
    this.applying = true;
    try { this.apply(pick(remote.data)); } finally { this.applying = false; }
    this.remember({ syncedAt: remote.updatedAt });
  }
  /** After a local change: save it to the account a few seconds later (several changes go up together). */
  changed() {
    if (!this.signedIn || this.applying) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push().catch(e => { this.error = String(e.message || e); }), 3000);
  }
  async signOut() { try { await this.call('POST', '/logout'); } catch {} this.forget(); }
  /** Deletes the account's preferences on the server and signs every device out. This device keeps its settings. */
  async remove() { await this.call('DELETE', '/account'); this.forget(); }
}

module.exports = { Account, pick, SYNC, BASE };
