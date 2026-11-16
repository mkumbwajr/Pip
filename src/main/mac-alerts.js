'use strict';
// iPhone messages and calls on the island (Mac only). Nothing here leaves the Mac, and Pip reads no files for it.
// macOS gives apps no way to read other apps' notifications, so Pip looks at the alerts macOS shows on screen, through
// Accessibility (System Events): a Messages alert gives who wrote (Pip shows the name only, never the text), and the
// incoming-call alert gives who is calling while the iPhone rings. Answering stays in Apple's alert.
// One permission for both: Accessibility. Tested on the owner's Mac only after this build: see README.
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');

const run = (cmd, args, timeout = 5000) => new Promise(resolve => execFile(cmd, args, { timeout, maxBuffer: 4e6 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') })));

/** Is this alert (its texts and button names, from Accessibility) an incoming call? Works for the languages macOS
    shows most here; the buttons are the surest sign. Returns the caller's name or ''. */
function callerFrom(texts, buttons) {
  const isCall = buttons.some(b => /^(accept|answer|decline|kubali|kataa|jibu)$/i.test(String(b).trim()))
    && texts.some(t => /call|facetime|iphone|simu|anapiga/i.test(String(t)));
  if (!isCall) return '';
  const name = texts.map(t => String(t).trim()).find(t => t && !/^(incoming|facetime|iphone|audio|video|call|now|sasa)\b/i.test(t) && !/call|facetime/i.test(t));
  return name || texts[0] || '';
}
/** Is this alert from the Messages app? macOS names the app in the alert's description ("Messages, Juma, …") or as
    its first text. Returns who wrote (the alert's title) or ''. The message itself is never kept. */
function senderFrom(texts, descs) {
  const clean = texts.map(t => String(t).trim()).filter(Boolean);
  const fromMessages = descs.some(d => /^(messages|imessage|ujumbe)\b/i.test(String(d).trim())) || /^(messages|imessage)$/i.test(clean[0] || '');
  if (!fromMessages) return '';
  const rest = /^(messages|imessage)$/i.test(clean[0] || '') ? clean.slice(1) : clean;
  return (rest.find(t => !/^(now|sasa|\d+[smh] ago|\d+:\d\d)$/i.test(t)) || '').slice(0, 60);
}

// Every alert window of Notification Center: its texts, button names and the descriptions macOS gives each alert.
const READ = `function run() {
  var se = Application('System Events'), out = [];
  var p = se.processes.whose({ name: 'NotificationCenter' }); if (!p.length) return '[]';
  var wins = p[0].windows(); for (var w = 0; w < wins.length; w++) {
    var texts = [], buttons = [], descs = [];
    try { var all = wins[w].entireContents(); for (var i = 0; i < all.length && i < 80; i++) { var e = all[i], r = '';
      try { r = e.role(); } catch (x) {}
      if (r === 'AXStaticText') { try { texts.push(String(e.value())); } catch (x) {} }
      else if (r === 'AXButton') { try { buttons.push(String(e.name() || e.description())); } catch (x) {} }
      else if (r === 'AXGroup') { try { var d = e.description(); if (d) descs.push(String(d)); } catch (x) {} } } } catch (x) {}
    out.push({ texts: texts, buttons: buttons, descs: descs });
  }
  return JSON.stringify(out);
}`;

class MacAlerts extends EventEmitter {
  constructor() { super(); this.access = 'unknown'; this.caller = ''; this.seen = new Set(); this.timer = null; this.enabled = { messages: false, calls: false }; this.busy = false; }
  /** Switch either part on or off (from the settings). */
  set(messages, calls) {
    if (process.platform !== 'darwin') return;
    this.enabled = { messages: Boolean(messages), calls: Boolean(calls) };
    clearInterval(this.timer); this.timer = null;
    if (this.enabled.messages || this.enabled.calls) { this.seen = null; this.timer = setInterval(() => this.read(), 1500); this.read(); }
    if (!this.enabled.calls && this.caller) { this.caller = ''; this.emit('call', null); }
  }
  stop() { this.set(false, false); }
  async read() {
    if (this.busy) return; this.busy = true;
    try {
      const r = await run('osascript', ['-l', 'JavaScript', '-e', READ], 4000);
      if (!r.ok) { if (/not allowed|assistive|-1719|-25211|1002|-1743/i.test(r.err)) this.setAccess('denied'); return; }
      this.setAccess('ok');
      let wins = []; try { wins = JSON.parse(r.out || '[]'); } catch {}
      if (this.enabled.calls) {
        let caller = ''; for (const w of wins) { caller = callerFrom(w.texts || [], w.buttons || []); if (caller) break; }
        if (caller !== this.caller) { this.caller = caller; this.emit('call', caller ? { from: caller } : null); }
      }
      if (this.enabled.messages) {
        // a message alert counts once, when it first appears; alerts already there when Pip started are skipped
        const now = new Set();
        for (const w of wins) { const from = senderFrom(w.texts || [], w.descs || []); if (from) now.add(from + '\u0000' + (w.texts || []).join('|')); }
        if (this.seen) for (const k of now) if (!this.seen.has(k)) this.emit('message', { from: k.split('\u0000')[0] });
        this.seen = now;
      }
    } finally { this.busy = false; }
  }
  setAccess(v) { if (this.access !== v) { this.access = v; this.emit('access', v); } }
}

module.exports = { MacAlerts, callerFrom, senderFrom };
