'use strict';
// The hub: a tiny HTTP server on 127.0.0.1 that receives hook events from Claude Code and Codex and turns them
// into per-session state the island can draw. Nothing here needs Electron, so it runs under `node --test`.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { timingSafeEqual } = require('node:crypto');

// PIP_HUB_PORT only for test runs (the smoke test next to a running Pip); real installs always use 48611
const PORT = Number(process.env.PIP_HUB_PORT) || 48611;
const PREFIX = '/pip';
// Pip was called Peep before 0.5: its hooks call /peep/... with an X-Peep-Token header. They keep working until
// Pip rewrites them on its first start, so an agent never goes quiet during the update.
const LEGACY_PREFIX = '/peep';
const PERMISSION_WAIT_MS = 4 * 60 * 1000, REPLY_WAIT_MS = 30 * 60 * 1000;
const FEED_MAX = 30, HISTORY_MAX = 50, BODY_MAX = 2 * 1024 * 1024;

const clip = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = p => (p ? path.win32.basename(String(p).replace(/\//g, '\\')) : '');

/** One short human line for a tool call: what it is doing, and to what. */
function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  switch (name) {
    case 'Read': return { verb: 'Reading', detail: base(file) };
    case 'Write': return { verb: 'Writing', detail: base(file) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': case 'apply_patch': return { verb: 'Editing', detail: base(file) };
    case 'Bash': case 'shell': case 'exec_command': return { verb: 'Running', detail: clip(Array.isArray(input.command) ? input.command.join(' ') : input.command || input.cmd, 120) };
    case 'Grep': case 'Glob': return { verb: 'Searching', detail: clip(input.pattern, 80) };
    case 'WebFetch': return { verb: 'Fetching', detail: clip(input.url, 80) };
    case 'WebSearch': return { verb: 'Searching the web', detail: clip(input.query, 80) };
    case 'Task': case 'Agent': return { verb: 'Delegating', detail: clip(input.description, 80) };
    default: return { verb: 'Using', detail: clip(name, 60) };
  }
}

class Hub extends EventEmitter {
  constructor({ token, port = PORT, historyFile = null } = {}) {
    super();
    if (!token) throw new Error('Hub needs a token');
    this.token = token; this.port = port; this.historyFile = historyFile;
    this.sessions = new Map();
    this.pending = new Map(); // session id → { res, timer }: a permission request waiting for Allow or Deny
    this.waiters = new Map(); // session id → { res, timer }: a finished turn waiting for a reply typed in the island
    this.context = '';        // extra instructions handed to each new agent session (for example: answer in Swahili)
    this.usage = null;        // { fiveHour: { pct, resetsAt }, sevenDay: { pct, resetsAt }, at } from the status line
    this.history = [];
    if (historyFile) { try { const h = JSON.parse(fs.readFileSync(historyFile, 'utf8')); if (Array.isArray(h)) this.history = h; } catch {} }
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.onRequest(req, res));
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => { this.port = this.server.address().port; resolve(this.port); });
    });
  }
  stop() { for (const id of this.pending.keys()) this.release(id, null); for (const id of this.waiters.keys()) this.endWait(id, null); return new Promise(r => (this.server ? this.server.close(() => r()) : r())); }

  authorised(req) {
    const given = Buffer.from(String(req.headers['x-pip-token'] || req.headers['x-peep-token'] || '')), want = Buffer.from(this.token);
    return given.length === want.length && timingSafeEqual(given, want);
  }

  onRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = url.pathname.startsWith(LEGACY_PREFIX + '/') ? LEGACY_PREFIX : PREFIX, route = url.pathname.slice(prefix.length + 1);
    if (req.method !== 'POST' || !url.pathname.startsWith(prefix + '/') || !['event', 'status', 'wait'].includes(route) || !this.authorised(req)) { res.writeHead(404).end(); return; }
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > BODY_MAX) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      let event; try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
      if (route === 'status') { this.setUsage(event); res.writeHead(200).end('{}'); return; }
      if (route === 'wait') { this.wait(event, res); return; }
      const agent = url.searchParams.get('agent') === 'codex' ? 'codex' : 'claude';
      const hold = this.handle(event, agent);
      if (hold) {
        const timer = setTimeout(() => this.release(hold, null), PERMISSION_WAIT_MS);
        this.pending.set(hold, { res, timer });
        res.on('close', () => { if (this.pending.get(hold)?.res === res) { clearTimeout(timer); this.pending.delete(hold); } });
      } else {
        const name = event.hook_event_name;
        const body = name === 'SessionStart' && this.context ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: this.context } } : {};
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
      }
    });
  }

  session(id, agent, cwd) {
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, agent, cwd: '', project: '', state: 'idle', activity: null, feed: [], prompt: '', ask: null, canReply: false, reply: '', startedAt: 0, updatedAt: Date.now(), edits: [] };
      this.sessions.set(id, s);
    }
    if (cwd && !s.cwd) { s.cwd = cwd; s.project = base(cwd); }
    return s;
  }

  /** Applies one hook event. Returns a session id when the HTTP response must be held open for a permission answer. */
  handle(event, agent = 'claude') {
    const name = event.hook_event_name || event.hookEventName, id = String(event.session_id || event.sessionId || agent);
    if (!name) return null;
    const s = this.session(id, agent, event.cwd), now = Date.now();
    s.updatedAt = now;
    let hold = null;
    const push = line => { s.feed.push({ at: now, ...line }); if (s.feed.length > FEED_MAX) s.feed.shift(); };
    const settle = () => { if (s.ask) { s.ask = null; this.release(id, null); } };

    switch (name) {
      case 'SessionStart': s.state = 'idle'; break;
      case 'UserPromptSubmit':
        // typed in the terminal: nothing left to answer from the island
        this.endWait(id, null);
        settle(); s.state = 'working'; s.prompt = clip(event.prompt, 400); s.startedAt = now; s.activity = { verb: 'Thinking', detail: '' }; s.feed = []; s.edits = [];
        break;
      case 'PreToolUse': {
        settle(); s.state = 'working'; s.activity = describeTool(event.tool_name, event.tool_input); push(s.activity);
        break;
      }
      case 'PostToolUse': {
        settle(); s.state = 'working';
        const d = describeTool(event.tool_name, event.tool_input);
        if ((d.verb === 'Editing' || d.verb === 'Writing') && d.detail && !s.edits.includes(d.detail)) s.edits.push(d.detail);
        break;
      }
      case 'PostToolUseFailure': settle(); push({ verb: 'Failed', detail: clip(event.tool_name, 60), bad: true }); break;
      case 'PermissionRequest': {
        const d = describeTool(event.tool_name, event.tool_input);
        s.state = 'asking'; s.ask = { kind: 'permission', tool: event.tool_name || '', ...d, canAnswer: agent === 'claude' };
        if (agent === 'claude') { this.release(id, null); hold = id; }
        break;
      }
      case 'Notification':
        if (s.state === 'working' && /permission|input|waiting/i.test(String(event.message || event.notification_type || ''))) { s.state = 'asking'; s.ask = { kind: 'attention', verb: 'Needs you', detail: clip(event.message, 160), canAnswer: false }; }
        break;
      case 'Stop': case 'SubagentStop': if (name === 'Stop') { settle(); this.finish(s, 'done', event); } break;
      case 'StopFailure': settle(); this.finish(s, 'error', event); break;
      case 'SessionEnd': settle(); this.endWait(id, null); this.sessions.delete(id); break;
      default: break;
    }
    this.emit('change', this.snapshot());
    return hold;
  }

  finish(s, state, event) {
    s.state = state; s.activity = null; s.reply = clip(event.last_assistant_message || '', 600);
    const entry = { at: Date.now(), agent: s.agent, project: s.project, prompt: s.prompt, state, tookMs: s.startedAt ? Date.now() - s.startedAt : 0, edits: s.edits.slice(0, 20), reply: clip(event.last_assistant_message || '', 600) };
    if (s.prompt) {
      this.history.unshift(entry); this.history.length = Math.min(this.history.length, HISTORY_MAX);
      if (this.historyFile) { try { fs.mkdirSync(path.dirname(this.historyFile), { recursive: true }); fs.writeFileSync(this.historyFile, JSON.stringify(this.history)); } catch {} }
    }
    this.emit('finish', { session: { ...s }, entry });
  }

  /** Answers a held permission request. behavior: 'allow' | 'deny' | null (null: let the terminal ask). */
  release(id, behavior) {
    const p = this.pending.get(id); if (!p) return false;
    clearTimeout(p.timer); this.pending.delete(id);
    const body = behavior ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied from Pip' } } } : {};
    try { p.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); } catch {}
    return true;
  }
  decide(id, behavior) {
    if (!['allow', 'deny'].includes(behavior)) return false;
    const ok = this.release(id, behavior), s = this.sessions.get(id);
    if (s && ok) { s.ask = null; s.state = 'working'; s.updatedAt = Date.now(); this.emit('change', this.snapshot()); }
    return ok;
  }

  /** The status line script posts what Claude Code told it: how much of the 5-hour and weekly limits is used. */
  setUsage(data) {
    const win = w => (w && Number.isFinite(Number(w.used_percentage)) ? { pct: Math.max(0, Math.min(100, Math.round(Number(w.used_percentage)))), resetsAt: Number(w.resets_at) * 1000 || 0 } : null);
    const fiveHour = win(data?.rate_limits?.five_hour), sevenDay = win(data?.rate_limits?.seven_day);
    if (!fiveHour && !sevenDay) return;
    this.usage = { fiveHour, sevenDay, at: Date.now() }; this.emit('change', this.snapshot());
  }

  /** The reply script (a background Stop hook) waits here until you answer in the island, or the wait runs out. */
  wait(event, res) {
    const id = String(event.session_id || 'claude'), s = this.session(id, 'claude', event.cwd);
    this.endWait(id, null);
    const timer = setTimeout(() => this.endWait(id, null), REPLY_WAIT_MS);
    this.waiters.set(id, { res, timer }); s.canReply = true;
    res.on('close', () => { if (this.waiters.get(id)?.res === res) { clearTimeout(timer); this.waiters.delete(id); s.canReply = false; this.emit('change', this.snapshot()); } });
    this.emit('change', this.snapshot());
  }
  endWait(id, text) {
    const w = this.waiters.get(id); if (!w) return false;
    clearTimeout(w.timer); this.waiters.delete(id);
    const s = this.sessions.get(id); if (s) s.canReply = false;
    try { w.res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(text ? { reply: text } : {})); } catch {}
    return true;
  }
  /** Sends your answer to a Claude Code session that has stopped; it wakes up and carries on. */
  reply(id, text) {
    text = String(text || '').trim().slice(0, 8000); if (!text) return false;
    const ok = this.endWait(id, text), s = this.sessions.get(id);
    if (ok && s) { s.state = 'working'; s.prompt = clip(text, 400); s.startedAt = Date.now(); s.activity = { verb: 'Thinking', detail: '' }; s.updatedAt = Date.now(); this.emit('change', this.snapshot()); }
    return ok;
  }

  /** Sessions quiet for a long time are dropped; finished ones fall back to idle after a while. */
  sweep(now = Date.now()) {
    let changed = false;
    for (const [id, s] of this.sessions) {
      if (now - s.updatedAt > 6 * 3600e3) { this.sessions.delete(id); changed = true; }
      else if ((s.state === 'done' || s.state === 'error') && now - s.updatedAt > 5 * 60e3) { s.state = 'idle'; changed = true; }
    }
    if (changed) this.emit('change', this.snapshot());
  }

  snapshot() {
    const rank = { asking: 4, error: 3, working: 2, done: 1, idle: 0 };
    const sessions = [...this.sessions.values()].sort((a, b) => rank[b.state] - rank[a.state] || b.updatedAt - a.updatedAt).map(s => ({ ...s, feed: s.feed.slice(-8) }));
    const usage = this.usage && Date.now() - this.usage.at < 6 * 3600e3 ? this.usage : null;
    return { sessions, top: sessions[0]?.state || 'idle', history: this.history.slice(0, 20), usage };
  }
}

module.exports = { Hub, describeTool, PORT, PREFIX, LEGACY_PREFIX };
