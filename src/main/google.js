'use strict';
// Optional Google sign-in, for two things only: today's and this month's calendar events, and the NUMBER of unread
// emails in the inbox (never senders, subjects or text). Both permissions are ones Google can verify without a paid
// security assessment, so the app can be opened to everyone. You bring your own OAuth client (a "Desktop app" client from
// console.cloud.google.com), so there is no shared key. Login runs in your browser with PKCE and comes back to this
// PC on 127.0.0.1. Tokens are stored through a save/load pair the main process supplies (encrypted by Windows).
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { pkce } = require('./spotify.js');

const REDIRECT_PORT = 48613, REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}`;
// calendar.readonly cannot change anything; gmail.labels gives the unread count and cannot open any message
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.labels';

function authorizeUrl(clientId, challenge, state) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state, access_type: 'offline', prompt: 'consent' });
}
/** Google's event shape to Pip's: { title, start, end (ms), allDay }. Cancelled events are left out. */
function toEvents(items) {
  return (items || []).filter(e => e.status !== 'cancelled').map(e => {
    const allDay = Boolean(e.start?.date && !e.start?.dateTime);
    const at = v => (v?.dateTime ? Date.parse(v.dateTime) : v?.date ? new Date(v.date + 'T00:00:00').getTime() : NaN);
    return { title: e.summary || '', start: at(e.start), end: at(e.end), allDay };
  }).filter(e => Number.isFinite(e.start)).sort((a, b) => a.start - b.start);
}

class Google {
  constructor({ load, save, open, fetchImpl = fetch, t = s => s }) { Object.assign(this, { load, save, open, fetchImpl, t }); this.tokens = load() || null; this.server = null; }
  get connected() { return Boolean(this.tokens?.refresh); }

  async token(body) {
    const r = await this.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(this.t('Google said no ({code}).', { code: r.status }));
    const j = await r.json();
    this.tokens = { clientId: body.client_id, secret: body.client_secret, access: j.access_token, refresh: j.refresh_token || this.tokens?.refresh, expires: Date.now() + (j.expires_in - 60) * 1000 };
    this.save(this.tokens);
  }

  /** Opens the browser for login and waits (up to 3 minutes) for Google to send the user back. */
  login(clientId, secret) {
    clientId = String(clientId || '').trim(); secret = String(secret || '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId) || !secret) return Promise.reject(new Error(this.t('Paste the client ID and client secret of your Google desktop app first.')));
    const { verifier, challenge } = pkce(), state = randomBytes(12).toString('hex');
    this.server?.close();
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); server.close(); this.server = null; fn(v); };
      const server = this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT);
        if (url.pathname !== '/' || url.searchParams.get('state') !== state) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<body style="font:18px system-ui;padding:40px">Pip: tayari. Unaweza kufunga tab hii.</body>');
        const code = url.searchParams.get('code'); if (!code) return done(reject, new Error(this.t('Login was cancelled.')));
        try { await this.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, client_secret: secret, code_verifier: verifier }); done(resolve, true); } catch (e) { done(reject, e); }
      });
      const timer = setTimeout(() => done(reject, new Error(this.t('Login took too long.'))), 3 * 60 * 1000);
      server.once('error', e => done(reject, e));
      server.listen(REDIRECT_PORT, '127.0.0.1', () => this.open(authorizeUrl(clientId, challenge, state)));
    });
  }
  logout() { this.tokens = null; this.save(null); }

  async api(url) {
    if (!this.connected) throw new Error(this.t('Not signed in to Google.'));
    if (Date.now() > this.tokens.expires) await this.token({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh, client_id: this.tokens.clientId, client_secret: this.tokens.secret });
    const r = await this.fetchImpl(url, { headers: { Authorization: 'Bearer ' + this.tokens.access }, signal: AbortSignal.timeout(10000) });
    if (r.status === 401) { this.logout(); throw new Error(this.t('Google login expired. Sign in again.')); }
    if (!r.ok) throw new Error(this.t('Google said no ({code}).', { code: r.status }));
    return r.json();
  }
  /** Events between two times (ms) from the primary calendar. */
  async events(from, to) {
    const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
    return toEvents((await this.api('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q)).items);
  }
  /** How many unread emails are in the inbox. Only the count: the label call carries no message at all. */
  async unread() { return Number((await this.api('https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX')).messagesUnread) || 0; }
}

/** The client to sign in with: your own from Settings when you set one, else the one Pip ships with. */
function clientFor(own) {
  if (own?.clientId && own?.secret) return { clientId: own.clientId, secret: own.secret };
  try { const c = require('./google-client.json'); if (c.clientId && c.secret) return { clientId: c.clientId, secret: c.secret }; } catch {}
  return null;
}

module.exports = { Google, authorizeUrl, toEvents, clientFor, REDIRECT, SCOPES };
