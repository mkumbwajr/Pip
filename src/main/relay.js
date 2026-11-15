'use strict';
// Phone transfer when the phone is NOT on the same network: through a box on Pip's server (pip.bang.co.tz/api/relay,
// server/pip-api.py) that lives one hour. Every file and file name is encrypted here or in the phone's browser with
// AES-256-GCM, using a key that is only in the QR code's link after the # (browsers never send that part), so the
// server holds bytes it cannot read. Files sent to this computer are deleted from the server once fetched.
// Format of every encrypted thing: 12-byte IV, then the ciphertext, then the 16-byte tag (what WebCrypto produces).
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { safeName, freeName } = require('./share.js');

const BASE = 'https://pip.bang.co.tz', FILE_MAX = 200 * 1024 * 1024, POLL_MS = 2000;

function seal(key, data) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, c.update(data), c.final(), c.getAuthTag()]);
}
function open(key, box) {
  if (box.length < 28) throw new Error('too short');
  const d = createDecipheriv('aes-256-gcm', key, box.subarray(0, 12)); d.setAuthTag(box.subarray(box.length - 16));
  return Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]);
}
const sealName = (key, name) => seal(key, Buffer.from(String(name), 'utf8')).toString('base64url');
const openName = (key, text) => { try { return open(key, Buffer.from(String(text), 'base64url')).toString('utf8'); } catch { return ''; } };

class Relay {
  /** saveDir: where received files go; onReceive(path); onProgress({ name, got, total, done? }). */
  constructor({ saveDir, onReceive = () => {}, onProgress = () => {}, fetchImpl = fetch, base = BASE }) {
    Object.assign(this, { saveDir, onReceive, onProgress, fetchImpl, base });
    this.id = ''; this.pc = ''; this.key = null; this.timer = null; this.seen = new Set(); this.offered = new Set(); this.busy = false;
  }
  get url() { return this.id ? `${this.base}/send#${this.id}.${this.key.toString('base64url')}` : ''; }
  api(p, extra = '') { return `${this.base}/api/relay/${this.id}${p}?pc=${encodeURIComponent(this.pc)}${extra}`; }

  async start() {
    const r = await this.fetchImpl(this.base + '/api/relay', { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('relay ' + r.status);
    const j = await r.json(); Object.assign(this, { id: j.id, pc: j.pc, key: randomBytes(32), expires: j.expires });
    this.timer = setInterval(() => this.poll().catch(() => {}), POLL_MS);
    return this.url;
  }
  /** What the phone has sent: progress while it arrives, then fetched, opened and saved here. */
  async poll() {
    if (!this.id || this.busy) return; this.busy = true;
    try {
      const r = await this.fetchImpl(this.api('/in'), { signal: AbortSignal.timeout(10000) }); if (!r.ok) return;
      for (const f of (await r.json()).files || []) {
        if (this.seen.has(f.n)) continue;
        const name = safeName(openName(this.key, f.name) || 'file');
        if (!f.done) { this.onProgress({ name, got: f.got, total: f.size }); continue; }
        this.seen.add(f.n); this.onProgress({ name, got: f.size, total: f.size });
        const res = await this.fetchImpl(this.api('/in/' + f.n), { signal: AbortSignal.timeout(10 * 60e3) });
        if (!res.ok) { this.onProgress({ name, failed: true }); continue; }
        let data; try { data = open(this.key, Buffer.from(await res.arrayBuffer())); } catch { this.onProgress({ name, failed: true }); continue; }
        fs.mkdirSync(this.saveDir, { recursive: true });
        const target = freeName(this.saveDir, name); fs.writeFileSync(target, data); this.onReceive(target);
      }
    } finally { this.busy = false; }
  }
  /** Files in the tray, offered to the phone (encrypted). Each one once; very large ones stay on this computer. */
  async offer(files) {
    for (const file of files) {
      if (!this.id || this.offered.has(file)) continue;
      let st; try { st = fs.statSync(file); } catch { continue; } if (!st.isFile() || st.size > FILE_MAX) continue;
      this.offered.add(file);
      const body = seal(this.key, fs.readFileSync(file));
      await this.fetchImpl(this.api('/out'), { method: 'PUT', headers: { 'X-Name': sealName(this.key, path.basename(file)), 'Content-Type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(10 * 60e3) }).catch(() => this.offered.delete(file));
    }
  }
  async stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.id) await this.fetchImpl(this.api(''), { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {});
    this.id = ''; this.seen.clear(); this.offered.clear();
  }
}

module.exports = { Relay, seal, open, sealName, openName };
