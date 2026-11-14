'use strict';
// Adds and removes Pip's hooks in Claude Code (~/.claude/settings.json) and Codex (~/.codex/hooks.json).
// Only entries that point at Pip's own local address are ever touched; everything else is left byte-for-byte
// as the user's JSON round-trips. A one-time backup is kept next to each file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PORT, PREFIX, LEGACY_PREFIX } = require('./hooks-hub.js');

const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionEnd'];

const claudeFile = () => path.join(os.homedir(), '.claude', 'settings.json');
const codexFile = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json');
const marker = port => `http://127.0.0.1:${port}${PREFIX}/event`;
const legacyMarker = port => `http://127.0.0.1:${port}${LEGACY_PREFIX}/event`; // written by Peep, Pip's earlier name

function readJson(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  if (!text.trim()) return {};
  const v = JSON.parse(text.replace(/^﻿/, '')); // a broken file throws: we never overwrite what we cannot read
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(file + ' is not a JSON object');
  return v;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const backup = file + '.pip-backup';
  // one backup of the file as it was before Pip (or Peep, its earlier name) first touched it
  if (fs.existsSync(file) && !fs.existsSync(backup) && !fs.existsSync(file + '.peep-backup')) fs.copyFileSync(file, backup);
  const tmp = file + '.pip-tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

const REPLY_SCRIPT = 'pip-reply.cjs', STATUS_SCRIPT = 'pip-status.cjs';
const LEGACY_REPLY = 'peep-reply.cjs', LEGACY_STATUS = 'peep-status.cjs';
const isOurs = (hook, port) => {
  const c = typeof hook?.command === 'string' ? hook.command : '', u = typeof hook?.url === 'string' ? hook.url : '';
  return [marker(port), legacyMarker(port)].some(m => u.startsWith(m) || c.includes(m)) || c.includes(REPLY_SCRIPT) || c.includes(LEGACY_REPLY);
};
const isOurStatus = line => typeof line?.command === 'string' && (line.command.includes(STATUS_SCRIPT) || line.command.includes(LEGACY_STATUS));
// forward slashes: the command runs in Git Bash or PowerShell on Windows, and both take them
const nodeCommand = (script, token, port) => `node "${String(script).replace(/\\/g, '/')}" ${token} ${port}`;
/** Removes our handlers from a hooks object, dropping groups and events that end up empty. */
function strip(config, port) {
  if (!config.hooks || typeof config.hooks !== 'object') return false;
  let removed = false;
  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!Array.isArray(g?.hooks)) { kept.push(g); continue; }
      const hooks = g.hooks.filter(h => !isOurs(h, port));
      if (hooks.length !== g.hooks.length) removed = true;
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) config.hooks[event] = kept; else delete config.hooks[event];
  }
  if (!Object.keys(config.hooks).length) delete config.hooks;
  return removed;
}
const has = (config, port) => Object.values(config.hooks || {}).some(groups => Array.isArray(groups) && groups.some(g => (g?.hooks || []).some(h => isOurs(h, port))));

/**
 * scripts: { reply, status } are the paths of the two helper scripts, or left out when Node.js is not on this PC.
 * reply adds a background Stop hook so you can answer from the island; status adds a status line that reports your
 * usage limits. A status line you already have is never replaced.
 */
function installClaude({ token, port = PORT, file = claudeFile(), scripts = {} }) {
  const config = readJson(file); strip(config, port); if (isOurStatus(config.statusLine)) delete config.statusLine; config.hooks ||= {};
  for (const event of CLAUDE_EVENTS) {
    (config.hooks[event] ||= []).push({ hooks: [{ type: 'http', url: marker(port), timeout: event === 'PermissionRequest' ? 300 : 3, headers: { 'X-Pip-Token': token } }] });
  }
  if (scripts.reply) config.hooks.Stop.push({ hooks: [{ type: 'command', command: nodeCommand(scripts.reply, token, port), asyncRewake: true, timeout: 1830 }] });
  if (scripts.status && !config.statusLine) config.statusLine = { type: 'command', command: nodeCommand(scripts.status, token, port) };
  writeJson(file, config);
}
function installCodex({ token, port = PORT, file = codexFile() }) {
  const config = readJson(file); strip(config, port); config.hooks ||= {};
  // curl.exe ships with Windows 10 and 11 (curl on the Mac); the event JSON arrives on stdin
  const command = `${process.platform === 'win32' ? 'curl.exe' : 'curl'} -s -m 3 -H "X-Pip-Token: ${token}" -H "Content-Type: application/json" --data-binary @- "${marker(port)}?agent=codex"`;
  for (const event of CODEX_EVENTS) (config.hooks[event] ||= []).push({ hooks: [{ type: 'command', command, timeout: 5 }] });
  writeJson(file, config);
}
function uninstall(file, port = PORT) {
  if (!fs.existsSync(file)) return false;
  const config = readJson(file);
  const hadStatus = isOurStatus(config.statusLine); if (hadStatus) delete config.statusLine;
  if (!strip(config, port) && !hadStatus) return false;
  writeJson(file, config); return true;
}
const installed = (file, port = PORT) => { try { return has(readJson(file), port); } catch { return false; } };

module.exports = {
  installClaude, installCodex, strip, has, isOurStatus, REPLY_SCRIPT, STATUS_SCRIPT, readJson, claudeFile, codexFile, CLAUDE_EVENTS, CODEX_EVENTS,
  uninstallClaude: (o = {}) => uninstall(o.file || claudeFile(), o.port), uninstallCodex: (o = {}) => uninstall(o.file || codexFile(), o.port),
  claudeInstalled: (o = {}) => installed(o.file || claudeFile(), o.port), codexInstalled: (o = {}) => installed(o.file || codexFile(), o.port)
};
