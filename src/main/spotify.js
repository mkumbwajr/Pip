'use strict';
// Optional Spotify link, only for choosing which device plays (phone, speaker, this PC). Play, pause and skip already
// work for every player through Windows. You bring your own free Spotify app ID (developer.spotify.com), so there is
// no shared key and no secret: login uses PKCE in your browser and comes back to this PC on 127.0.0.1.
// Tokens are stored through a save/load pair the main process supplies (encrypted with Windows' own vault).
const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');

const REDIRECT_PORT = 48612, REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = 'user-read-playback-state user-modify-playback-state';

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
function authorizeUrl(clientId, challenge, state) {
  return 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES, code_challenge_method: 'S256', code_challenge: challenge, state });
}

class Spotify {
  constructor({ load, save, open, fetchImpl = fetch, t = s => s }) { Object.assign(this, { load, save, open, fetchImpl, t }); this.tokens = load() || null; this.server = null; }
  get connected() { return Boolean(this.tokens?.refresh); }

  async token(body) {
    const r = await this.fetchImpl('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(this.t('Spotify said no ({code}).', { code: r.status }));
    const j = await r.json();
    this.tokens = { clientId: body.client_id, access: j.access_token, refresh: j.refresh_token || this.tokens?.refresh, expires: Date.now() + (j.expires_in - 60) * 1000 };
    this.save(this.tokens);
  }

  /** Opens the browser for login and waits (up to 3 minutes) for Spotify to send the user back. */
  login(clientId) {
    clientId = String(clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) return Promise.reject(new Error(this.t('That does not look like a Spotify client ID.')));
    const { verifier, challenge } = pkce(), state = randomBytes(12).toString('hex');
    this.server?.close();
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { clearTimeout(timer); server.close(); this.server = null; fn(v); };
      const server = this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT);
        if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<body style="font:18px system-ui;padding:40px">Pip: tayari. Unaweza kufunga tab hii.</body>');
        const code = url.searchParams.get('code'); if (!code) return done(reject, new Error(this.t('Login was cancelled.')));
        try { await this.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }); done(resolve, true); } catch (e) { done(reject, e); }
      });
      const timer = setTimeout(() => done(reject, new Error(this.t('Login took too long.'))), 3 * 60 * 1000);
      server.once('error', e => done(reject, e));
      server.listen(REDIRECT_PORT, '127.0.0.1', () => this.open(authorizeUrl(clientId, challenge, state)));
    });
  }
  logout() { this.tokens = null; this.save(null); }

  async api(method, path, body) {
    if (!this.connected) throw new Error(this.t('Not connected to Spotify.'));
    if (Date.now() > this.tokens.expires) await this.token({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh, client_id: this.tokens.clientId });
    const r = await this.fetchImpl('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + this.tokens.access, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
    if (r.status === 401) { this.logout(); throw new Error(this.t('Spotify login expired.')); }
    if (!r.ok) throw new Error(this.t('Spotify said no ({code}).', { code: r.status }));
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  async devices() { return ((await this.api('GET', '/me/player/devices'))?.devices || []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active })); }
  transfer(id) { return this.api('PUT', '/me/player', { device_ids: [String(id)], play: true }); }
}

module.exports = { Spotify, pkce, authorizeUrl, REDIRECT };
