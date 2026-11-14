'use strict';
// Starts and talks to the PowerShell helper (src/helpers/win-helper.ps1). On other systems nothing is started and
// every question simply has no answer, so the rest of Peep still runs (useful for development).
const { spawn } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class WinHelper extends EventEmitter {
  constructor() { super(); this.child = null; this.state = { media: null, volume: null, front: null, net: null, at: 0 }; this.art = null; this.buffer = ''; this.restarts = 0; this.stopped = false; }
  start() {
    if (process.platform !== 'win32' || this.child || this.stopped) return;
    const script = path.join(__dirname, '..', 'helpers', 'win-helper.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // -ExecutionPolicy Bypass applies to this one process only: Windows blocks unsigned scripts by default.
    this.child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk; let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i).trim(); this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.type === 'art') { this.art = { key: m.key, data: m.data || '' }; this.emit('art', this.art); } else if (m.type === 'state') { this.state = { media: m.media || null, volume: m.volume || null, front: m.front || null, net: m.net || null, at: Date.now() }; this.emit('state', this.state); } } catch {}
      }
    });
    const gone = () => { this.child = null; if (!this.stopped && this.restarts++ < 5) setTimeout(() => this.start(), 3000); };
    this.child.on('exit', gone); this.child.on('error', gone);
  }
  send(command) { try { if (this.child) this.child.stdin.write(JSON.stringify(command) + '\n'); return Boolean(this.child); } catch { return false; } }
  stop() { this.stopped = true; try { this.child?.stdin.end(); } catch {} }
}

module.exports = { WinHelper };
