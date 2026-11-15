'use strict';
// Pip's license, on this device: the 7-day trial and the one-time purchase (server/license.py keeps the truth).
// After the trial, the island and the agents' status keep working; the other tabs ask for the license.
//
// Asks pip.bang.co.tz now and then (at start, every six hours, after signing in or out, while a payment is pending).
// What it sends: a one-way hash of this device's ID (so the trial cannot restart), and the Pip account's session
// token when signed in (the license belongs to the account). Offline, the last answer is used: a bought license stays
// valid for 30 days without a check, the trial runs out by its own date.
const crypto = require('node:crypto');

const BASE = 'https://pip.bang.co.tz/api';
const DAY = 86400000, TRIAL_DAYS = 7, OFFLINE_DAYS = 30;

/** A stable, private ID for this device: sha256 of the system's machine ID (or of a random one kept by Pip). */
function deviceHash(machineId) { return crypto.createHash('sha256').update('pip-device:' + String(machineId)).digest('hex'); }

class License {
  /** load/save: the last answer ({ licensed, trialEndsAt, offset, checkedAt, priceTzs, localStart }).
      device(): the device hash. token(): the Pip account's session token, or ''. */
  constructor({ load, save, device, token, fetchImpl = fetch, base = BASE, now = () => Date.now() }) {
    Object.assign(this, { load, save, device, token, fetchImpl, base, now });
    this.state = load() || {};
    if (!this.state.localStart) { this.state.localStart = now(); save(this.state); } // the trial's start if the server is never reached
  }

  async call(method, path, body) {
    const tok = this.token();
    const r = await this.fetchImpl(this.base + path, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  }

  /** Asks the server; keeps its answer (and how far this device's clock is off). */
  async check() {
    const j = await this.call('POST', '/license/status', { device: this.device() });
    this.state = { ...this.state, licensed: Boolean(j.licensed), selling: Boolean(j.selling), priceTzs: j.priceTzs || this.state.priceTzs, checkedAt: this.now(),
      offset: typeof j.now === 'number' ? j.now - this.now() : 0, ...(j.trialEndsAt ? { trialEndsAt: j.trialEndsAt } : {}) };
    this.save(this.state); return this.view();
  }

  /** What the island and Settings show. locked: the trial is over and there is no license. */
  view() {
    const s = this.state, at = this.now() + (s.offset || 0);
    const licensed = Boolean(s.licensed) && this.now() - (s.checkedAt || 0) < OFFLINE_DAYS * DAY;
    const ends = s.trialEndsAt || (s.localStart + TRIAL_DAYS * DAY);
    // selling: the server can take payments. Until it says so, nothing locks (and Settings shows no trial)
    return { licensed, selling: Boolean(s.selling), locked: Boolean(s.selling) && !licensed && at > ends, trialEndsAt: ends, daysLeft: licensed ? 0 : Math.max(0, Math.ceil((ends - at) / DAY)),
      priceTzs: s.priceTzs || 5000, signedIn: Boolean(this.token()), checkedAt: s.checkedAt || 0 };
  }

  /** Mobile money: EvPay sends a prompt to this phone. Returns { order, operator }. */
  payMobile(phone, operator) { return this.call('POST', '/pay/mobile', { phone: String(phone || ''), ...(operator ? { operator } : {}) }); }
  /** Card: EvPay's own page, opened in the browser. Returns { order, checkoutUrl }. */
  payCard(email) { return this.call('POST', '/pay/card', email ? { email } : {}); }
  /** How a payment is going; once it is paid, the license is checked again so Pip unlocks. */
  async order(ref) {
    const j = await this.call('GET', '/pay/' + encodeURIComponent(String(ref)));
    if (j.status === 'paid' || j.licensed) await this.check().catch(() => {});
    return { ...j, ...this.view() };
  }
}

module.exports = { License, deviceHash, BASE, TRIAL_DAYS, OFFLINE_DAYS };
