'use strict';
// Phone transfer over your own Wi-Fi: Peep serves a small page on this PC's LAN address, protected by a random
// link. Scan the QR code with a phone on the same network to download the files in the tray or send files to the PC.
// No cloud relay and no account: nothing leaves your network. The link dies after an hour or when you stop it.
// Trade-off: plain HTTP on the local network, so use it on networks you trust.
const http = require('node:http');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// One fixed port, so a firewall rule and the phone's browser history keep working; another free port if it is taken
// Pip, as the page's tab and home-screen icon
const ICON = (() => { try { return 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png')).toString('base64'); } catch { return ''; } })();
const LIFETIME_MS = 60 * 60 * 1000, UPLOAD_MAX = 2 * 1024 ** 3, PORT = 48614;
const safeName = n => path.basename(String(n || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'file';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
  return null;
}
/** The address of the adapter that carries this PC's internet traffic (Wi-Fi or cable), not a virtual one (Docker,
    WSL, VPN). Asking the system which way it would route a packet sends nothing. */
function routeAddress() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4'), done = v => { try { s.close(); } catch {} resolve(v); };
    s.once('error', () => done(null));
    try { s.connect(53, '8.8.8.8', () => { const a = s.address().address; done(a && a !== '0.0.0.0' && !a.startsWith('127.') ? a : null); }); } catch { done(null); }
  });
}
function freeName(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let target = path.join(dir, name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem} (${i})${ext}`);
  return target;
}

class Share {
  /** files: () => [absolute paths]; saveDir: where uploads go; onReceive(path): told about each upload. */
  constructor({ files, saveDir, onReceive = () => {}, host = null, port = PORT, t = s => s }) {
    Object.assign(this, { files, saveDir, onReceive, fixedHost: host, port, t, host: null });
    this.server = null; this.secret = ''; this.timer = null; this.until = 0;
  }
  get url() { return this.server ? `http://${this.host}:${this.server.address().port}/${this.secret}/` : ''; }
  status() { return { on: Boolean(this.server), url: this.url, until: this.until }; }

  async start() {
    if (this.server) return this.status();
    // looked up on every start: the PC may have moved to another Wi-Fi since the last share
    this.host = this.fixedHost || await routeAddress() || lanAddress();
    if (!this.host) throw new Error(this.t('This PC is not on a network.'));
    this.secret = randomBytes(18).toString('base64url');
    const listen = port => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.onRequest(req, res));
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => resolve(server));
    });
    let server;
    try { server = await listen(this.port); } catch (e) { if (e.code !== 'EADDRINUSE' || !this.port) throw e; server = await listen(0); }
    this.server = server; this.until = Date.now() + LIFETIME_MS;
    this.timer = setTimeout(() => this.stop(), LIFETIME_MS);
    return this.status();
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
    const size = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
    const rows = list.map((f, i) => { let n = 0; try { n = fs.statSync(f).size; } catch {}
      return `<a class="row" href="get/${i}"><span class="name">${esc(path.basename(f))}<small>${size(n)}</small></span><span class="get">${esc(t('Download'))}</span></a>`; }).join('')
      || `<p class="empty">${esc(t('Nothing in the tray yet.'))}</p>`;
    const icon = ICON ? `<link rel="icon" href="${ICON}"><link rel="apple-touch-icon" href="${ICON}">` : '';
    return `<!doctype html><html lang="sw"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0b0e"><title>Peep</title>${icon}
<style>
:root{--pip:#7c5cff;--bg:#0b0b0e;--card:#16161b;--line:#26262d;--soft:#b6b6be;--mute:#86868f}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;padding:max(20px,env(safe-area-inset-top)) 18px 40px;color:#f2f2f5;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:560px;margin:0 auto}
header{display:flex;align-items:center;gap:12px;margin:6px 0 26px}
.pip{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:42px;height:38px;border-radius:13px;background:var(--pip)}
.pip i{width:6px;height:11px;border-radius:3px;background:#fff;animation:blink 5s infinite}
@keyframes blink{0%,96%,100%{transform:scaleY(1)}98%{transform:scaleY(.1)}}
header b{display:block;font-size:20px;letter-spacing:-.01em}header span{display:block;font-size:13px;color:var(--mute)}
h2{margin:26px 0 10px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.row{display:flex;align-items:center;gap:12px;padding:14px 16px;margin:8px 0;background:var(--card);border:1px solid var(--line);border-radius:16px;color:#f2f2f5;text-decoration:none}
.row:active{transform:scale(.99)}
.name{flex:1;min-width:0;word-break:break-word}.name small{display:block;color:var(--mute);font-size:12px;margin-top:2px}
.get{flex:none;padding:7px 12px;border-radius:10px;background:#fff;color:#000;font-size:14px;font-weight:600}
.empty{color:var(--mute);margin:8px 2px}
.pick{display:flex;flex-direction:column;align-items:center;gap:8px;padding:26px 16px;border:1.5px dashed #3a3a44;border-radius:18px;text-align:center;color:var(--soft);cursor:pointer}
.pick b{color:#fff;font-size:16px}.pick svg{width:30px;height:30px;color:#fff}
input{display:none}
.job{margin:10px 0;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:16px}
.top{display:flex;align-items:center;gap:10px}.top .name{font-size:15px}
.state{flex:none;width:22px;height:22px;display:grid;place-items:center}
.spin{width:18px;height:18px;border:2.5px solid #33333c;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.ok{width:22px;height:22px;border-radius:50%;background:#2fbf71;display:grid;place-items:center;animation:pop .3s ease}
.ok svg{width:13px;height:13px;color:#fff}.bad{color:#ff5d6c;font-weight:700}
@keyframes pop{from{transform:scale(.4);opacity:0}}
.bar{height:5px;margin-top:10px;border-radius:3px;background:#26262d;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--pip),#b5a4ff);border-radius:3px;transition:width .15s linear}
.job.done .bar i{background:#2fbf71}.job.fail .bar i{background:#ff5d6c}
.meta{margin-top:6px;font-size:12px;color:var(--mute);display:flex;justify-content:space-between}
footer{margin-top:34px;text-align:center;font-size:12px;color:var(--mute)}
</style>
<header><span class="pip"><i></i><i></i></span><div><b>Peep</b><span>${esc(t('Files between your phone and your PC'))}</span></div></header>
<h2>${esc(t('From your PC'))}</h2>${rows}
<h2>${esc(t('Send to your PC'))}</h2>
<label class="pick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><b>${esc(t('Choose files'))}</b><span>${esc(t('They go to the Peep folder in Downloads on the PC.'))}</span><input id="f" type="file" multiple></label>
<div id="jobs"></div>
<footer>Peep · BANG DIGITAL</footer>
<script>
const SENDING=${js(t('Sending…'))},SENT=${js(t('Sent'))},FAILED=${js(t('Could not send. Try again.'))};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const mb=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const tick='<span class="ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';
function send(file){return new Promise(done=>{
  const el=document.createElement('div');el.className='job';
  el.innerHTML='<div class="top"><span class="name">'+esc(file.name)+'</span><span class="state"><span class="spin"></span></span></div><div class="bar"><i></i></div><div class="meta"><span class="what">'+SENDING+'</span><span class="pct">0%</span></div>';
  document.getElementById('jobs').prepend(el);
  const bar=el.querySelector('.bar i'),pct=el.querySelector('.pct'),what=el.querySelector('.what'),state=el.querySelector('.state');
  const x=new XMLHttpRequest();x.open('PUT','put/'+encodeURIComponent(file.name));
  x.upload.onprogress=e=>{if(!e.lengthComputable)return;const p=Math.round(100*e.loaded/e.total);bar.style.width=p+'%';pct.textContent=p+'% · '+mb(e.loaded)+' / '+mb(e.total);};
  x.onload=()=>{const ok=x.status===200;el.classList.add(ok?'done':'fail');bar.style.width='100%';state.innerHTML=ok?tick:'<span class="bad">!</span>';what.textContent=ok?SENT:FAILED;if(ok)pct.textContent=mb(file.size);done();};
  x.onerror=()=>{el.classList.add('fail');state.innerHTML='<span class="bad">!</span>';what.textContent=FAILED;done();};
  x.send(file);});}
document.getElementById('f').onchange=async e=>{for(const f of [...e.target.files])await send(f);e.target.value='';};
</script></html>`;
  }
}

module.exports = { Share, lanAddress, routeAddress, safeName, freeName, PORT };
