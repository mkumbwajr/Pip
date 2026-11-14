'use strict';
// Phone transfer over your own Wi-Fi: Peep serves a small page on this PC's LAN address, protected by a random
// link. Scan the QR code with a phone on the same network to download the files in the tray or send files to the PC.
// No cloud relay and no account: nothing leaves your network. The link dies after an hour or when you stop it.
// Trade-off: plain HTTP on the local network, so use it on networks you trust.
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const LIFETIME_MS = 60 * 60 * 1000, UPLOAD_MAX = 2 * 1024 ** 3;
const safeName = n => path.basename(String(n || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'file';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
  return null;
}
function freeName(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let target = path.join(dir, name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} (${i})${ext}`);
  return target;
}

class Share {
  /** files: () => [absolute paths]; saveDir: where uploads go; onReceive(path): told about each upload. */
  constructor({ files, saveDir, onReceive = () => {}, host = lanAddress(), t = s => s }) {
    Object.assign(this, { files, saveDir, onReceive, host, t });
    this.server = null; this.secret = ''; this.timer = null; this.until = 0;
  }
  get url() { return this.server ? `http://${this.host}:${this.server.address().port}/${this.secret}/` : ''; }
  status() { return { on: Boolean(this.server), url: this.url, until: this.until }; }

  start() {
    if (this.server) return Promise.resolve(this.status());
    if (!this.host) return Promise.reject(new Error(this.t('This PC is not on a network.')));
    this.secret = randomBytes(18).toString('base64url');
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.onRequest(req, res));
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => {
        this.server = server; this.until = Date.now() + LIFETIME_MS;
        this.timer = setTimeout(() => this.stop(), LIFETIME_MS);
        resolve(this.status());
      });
    });
  }
  stop() {
    clearTimeout(this.timer);
    const s = this.server; this.server = null; this.secret = ''; this.until = 0;
    return new Promise(r => { if (!s) return r(); s.closeAllConnections?.(); s.close(() => r()); });
  }

  onRequest(req, res) {
    const url = new URL(req.url, 'http://x'), parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== this.secret) { res.writeHead(404).end(); return; }
    const list = this.files().filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (req.method === 'GET' && parts.length === 1) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(this.page(list)); return;
    }
    if (req.method === 'GET' && parts[1] === 'get') {
      const file = list[Number(parts[2])]; if (!file) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` });
      fs.createReadStream(file).pipe(res); return;
    }
    if (req.method === 'PUT' && parts[1] === 'put') {
      if (Number(req.headers['content-length'] || 0) > UPLOAD_MAX) { res.writeHead(413).end(); return; }
      fs.mkdirSync(this.saveDir, { recursive: true });
      const target = freeName(this.saveDir, safeName(decodeURIComponent(parts[2] || ''))), out = fs.createWriteStream(target);
      let size = 0;
      req.on('data', c => { size += c.length; if (size > UPLOAD_MAX) { req.destroy(); out.destroy(); fs.rm(target, () => {}); } });
      req.pipe(out);
      out.on('finish', () => { res.writeHead(200).end('ok'); this.onReceive(target); });
      out.on('error', () => { try { res.writeHead(500).end(); } catch {} });
      return;
    }
    res.writeHead(404).end();
  }

  page(list) {
    const t = this.t, js = v => JSON.stringify(String(v)).replace(/</g, '\\u003c');
    const rows = list.map((f, i) => `<a class="row" href="get/${i}">${esc(path.basename(f))}<span>${esc(t('Download'))}</span></a>`).join('') || `<p class="dim">${esc(t('Nothing in the tray yet.'))}</p>`;
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Peep</title>
<style>body{font:16px system-ui;margin:0;padding:20px;background:#111;color:#eee}h1{font-size:20px}h2{font-size:14px;color:#aaa;margin-top:28px}
.row{display:flex;justify-content:space-between;gap:12px;padding:14px;margin:8px 0;background:#1d1d22;border-radius:12px;color:#eee;text-decoration:none;word-break:break-all}
.row span{color:#9d86ff;white-space:nowrap}.dim{color:#777}label{display:block;padding:18px;border:2px dashed #444;border-radius:12px;text-align:center}input{display:none}#log{color:#aaa;font-size:14px}</style>
<h1>Peep</h1><h2>${esc(t('From your PC'))}</h2>${rows}
<h2>${esc(t('Send to your PC'))}</h2><label>${esc(t('Choose files'))}<input id="f" type="file" multiple></label><p id="log"></p>
<script>const log=document.getElementById('log'),S=${js(t('Sending {name}…'))},OK=${js(t('Sent {name}'))},NO=${js(t('Could not send {name}'))};
document.getElementById('f').onchange=async e=>{for(const f of e.target.files){log.textContent=S.replace('{name}',f.name);
const r=await fetch('put/'+encodeURIComponent(f.name),{method:'PUT',body:f}).catch(()=>null);log.textContent=(r&&r.ok?OK:NO).replace('{name}',f.name);}};</script>`;
  }
}

module.exports = { Share, lanAddress, safeName, freeName };
