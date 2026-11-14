'use strict';
// Phones reach Peep's share page through Windows Firewall. Windows asks the first time Peep listens, but that prompt
// only allows "private" networks unless you tick "public" too, so on a Wi-Fi Windows calls public the phone's request
// is dropped and the page never loads. Peep adds one rule of its own, after you approve it in Windows' admin prompt:
// Peep.exe only, incoming TCP, only from devices on the same local network, on any network type.
const { spawnSync, spawn } = require('node:child_process');

const RULE = 'Peep phone sharing';

/** Reads `netsh advfirewall firewall show rule ... verbose`: is there an enabled allow rule for this program? */
function ruleCovers(output, exe) {
  const blocks = String(output || '').split(/\r?\n\s*\r?\n/);
  return blocks.some(b => /Enabled:\s*Yes/i.test(b) && /Action:\s*Allow/i.test(b) && /Direction:\s*In/i.test(b)
    && b.toLowerCase().includes(String(exe).toLowerCase()));
}
function hasRule(exe = process.execPath) {
  if (process.platform !== 'win32') return true;
  try {
    const r = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${RULE}`, 'verbose'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return r.status === 0 && ruleCovers(r.stdout, exe);
  } catch { return false; }
}
/** Shows Windows' admin prompt once; resolves with whether the rule is now in place. */
function addRule(exe = process.execPath) {
  if (process.platform !== 'win32') return Promise.resolve(true);
  const q = s => s.replace(/"/g, '');
  const netsh = `advfirewall firewall delete rule name="${RULE}" & netsh advfirewall firewall add rule name="${RULE}" dir=in action=allow program="${q(exe)}" enable=yes profile=any remoteip=localsubnet protocol=tcp`;
  const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c netsh ${netsh.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait`;
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    p.on('exit', () => resolve(hasRule(exe))); p.on('error', () => resolve(false));
  });
}

module.exports = { RULE, ruleCovers, hasRule, addRule };
