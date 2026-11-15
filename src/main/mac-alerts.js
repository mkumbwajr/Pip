'use strict';
// iPhone messages and calls on the island (Mac only). Nothing here leaves the Mac.
// Messages: macOS gives apps no way to read other apps' notifications, but the Messages app keeps every iMessage (and
// SMS, when the iPhone forwards them) in ~/Library/Messages/chat.db. Pip reads new rows from it with macOS's own
// sqlite3, read-only, and the sender's name from the Contacts database next to it. Both need Full Disk Access.
// Calls: when the iPhone rings, macOS shows an incoming-call alert. Pip looks for that alert through Accessibility
// (System Events) and shows the caller while it is there. Answering stays in Apple's alert.
// Never run on a Mac before this build: see README.
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (cmd, args, timeout = 5000) => new Promise(resolve => execFile(cmd, args, { timeout, maxBuffer: 4e6 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '') })));
const SQLITE = '/usr/bin/sqlite3';
const HOME = os.homedir();
const CHAT_DB = path.join(HOME, 'Library', 'Messages', 'chat.db');

/** Text of a message saved only as an "attributedBody" (newer macOS): an NSAttributedString in Apple's typedstream
    format, given here as hex. The text follows the "NSString" class name: a 0x2B marker, then its length (one byte, or
    0x81 + two bytes, or 0x82 + four bytes, little-endian), then UTF-8. */
function textFromAttributed(hex) {
  if (!hex) return '';
  const b = Buffer.from(hex, 'hex'), at = b.indexOf('NSString');
  if (at < 0) return '';
  let i = b.indexOf(0x2b, at + 8); if (i < 0 || i > at + 20) return '';
  i++; let len = b[i++];
  if (len === 0x81) { len = b.readUInt16LE(i); i += 2; } else if (len === 0x82) { len = b.readUInt32LE(i); i += 4; }
  if (!len || i + len > b.length) return '';
  return b.subarray(i, i + len).toString('utf8');
}
/** The first line of a message, short enough for the island. */
const firstLine = text => { const l = String(text || '').replace(/￼/g, '').trim().split(/\r?\n/)[0] || ''; return l.length > 90 ? l.slice(0, 89) + '…' : l; };
/** Phone numbers compare on their last nine digits ("+255 712 345 678" and "0712345678" are the same person). */
const phoneKey = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; };
/** Is this alert (its texts and button names, from Accessibility) an incoming call? Works for the languages macOS
    shows most here; the buttons are the surest sign. Returns the caller's name or ''. */
function callerFrom(texts, buttons) {
  const isCall = buttons.some(b => /^(accept|answer|decline|kubali|kataa|jibu)$/i.test(String(b).trim()))
    && texts.some(t => /call|facetime|iphone|simu|anapiga/i.test(String(t)));
  if (!isCall) return '';
  const name = texts.map(t => String(t).trim()).find(t => t && !/^(incoming|facetime|iphone|audio|video|call|now|sasa)\b/i.test(t) && !/call|facetime/i.test(t));
  return name || texts[0] || '';
}

// Every alert window of Notification Center, as its texts and button names. Needs Accessibility for Pip.
const CALL_READ = `function run() {
  var se = Application('System Events'), out = [];
  var p = se.processes.whose({ name: 'NotificationCenter' }); if (!p.length) return '[]';
  var wins = p[0].windows(); for (var w = 0; w < wins.length; w++) {
    var texts = [], buttons = [];
    try { var all = wins[w].entireContents(); for (var i = 0; i < all.length && i < 80; i++) { var e = all[i], r = '';
      try { r = e.role(); } catch (x) {}
      if (r === 'AXStaticText') { try { texts.push(String(e.value())); } catch (x) {} }
      else if (r === 'AXButton') { try { buttons.push(String(e.name() || e.description())); } catch (x) {} } } } catch (x) {}
    out.push({ texts: texts, buttons: buttons });
  }
  return JSON.stringify(out);
}`;

class MacAlerts extends EventEmitter {
  constructor() { super(); this.lastRow = null; this.names = null; this.namesAt = 0; this.access = { messages: 'unknown', calls: 'unknown' }; this.caller = ''; this.timers = []; this.enabled = { messages: false, calls: false }; this.busy = {}; }
  /** Switch either part on or off (from the settings). */
  set(messages, calls) {
    if (process.platform !== 'darwin') return;
    this.enabled = { messages: Boolean(messages), calls: Boolean(calls) };
    this.timers.forEach(clearInterval); this.timers = [];
    if (this.enabled.messages) { this.lastRow = null; this.timers.push(setInterval(() => this.readMessages(), 3000)); this.readMessages(); }
    if (this.enabled.calls) this.timers.push(setInterval(() => this.readCalls(), 1500));
    if (!this.enabled.calls && this.caller) { this.caller = ''; this.emit('call', null); }
  }
  stop() { this.set(false, false); }
  sql(db, query) { return run(SQLITE, ['-readonly', '-json', db, query]); }
  setAccess(kind, value) { if (this.access[kind] !== value) { this.access[kind] = value; this.emit('access', { ...this.access }); } }
  async readMessages() {
    if (this.busy.m) return; this.busy.m = true;
    try {
      if (this.lastRow === null) { // first look: start after the newest message, so old ones are not shown
        const r = await this.sql(CHAT_DB, 'SELECT IFNULL(MAX(ROWID),0) AS n FROM message;');
        if (!r.ok) { this.setAccess('messages', /authoriz|permission|unable to open|not permitted/i.test(r.err) || !fs.existsSync(CHAT_DB) ? 'denied' : 'error'); return; }
        this.setAccess('messages', 'ok'); try { this.lastRow = JSON.parse(r.out || '[]')[0]?.n || 0; } catch { this.lastRow = 0; } return;
      }
      const r = await this.sql(CHAT_DB, `SELECT m.ROWID AS id, m.text AS text, hex(m.attributedBody) AS body, h.id AS handle, c.display_name AS chat
        FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id LEFT JOIN chat_message_join j ON j.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = j.chat_id
        WHERE m.ROWID > ${Number(this.lastRow) || 0} AND m.is_from_me = 0 AND m.item_type = 0 ORDER BY m.ROWID LIMIT 20;`);
      if (!r.ok) { this.setAccess('messages', 'denied'); this.lastRow = null; return; }
      let rows = []; try { rows = JSON.parse(r.out || '[]'); } catch {}
      if (!rows.length) return;
      this.lastRow = rows[rows.length - 1].id;
      const last = rows[rows.length - 1]; // several at once: show the newest, with how many came
      const from = await this.nameOf(last.handle);
      this.emit('message', { from: from || last.handle || 'Messages', group: last.chat || '', text: firstLine(last.text || textFromAttributed(last.body)), count: rows.length });
    } finally { this.busy.m = false; }
  }
  /** A name from Contacts for a phone number or e-mail address ('' when not saved). Read again every ten minutes. */
  async nameOf(handle) {
    if (!handle) return '';
    if (!this.names || Date.now() - this.namesAt > 600e3) {
      this.names = new Map(); this.namesAt = Date.now();
      const base = path.join(HOME, 'Library', 'Application Support', 'AddressBook');
      const dbs = [path.join(base, 'AddressBook-v22.abcddb')];
      try { for (const d of fs.readdirSync(path.join(base, 'Sources'))) dbs.push(path.join(base, 'Sources', d, 'AddressBook-v22.abcddb')); } catch {}
      for (const db of dbs.filter(f => fs.existsSync(f))) {
        const q = `SELECT TRIM(IFNULL(r.ZFIRSTNAME,'') || ' ' || IFNULL(r.ZLASTNAME,'')) AS name, IFNULL(r.ZORGANIZATION,'') AS org, p.ZFULLNUMBER AS phone, NULL AS mail FROM ZABCDRECORD r JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
          UNION ALL SELECT TRIM(IFNULL(r.ZFIRSTNAME,'') || ' ' || IFNULL(r.ZLASTNAME,'')), IFNULL(r.ZORGANIZATION,''), NULL, e.ZADDRESS FROM ZABCDRECORD r JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK;`;
        const r = await this.sql(db, q); if (!r.ok) continue;
        let rows = []; try { rows = JSON.parse(r.out || '[]'); } catch {}
        for (const x of rows) { const n = x.name || x.org; if (!n) continue; if (x.phone && phoneKey(x.phone)) this.names.set(phoneKey(x.phone), n); if (x.mail) this.names.set(String(x.mail).toLowerCase(), n); }
      }
    }
    return this.names.get(handle.includes('@') ? handle.toLowerCase() : phoneKey(handle)) || '';
  }
  async readCalls() {
    if (this.busy.c) return; this.busy.c = true;
    try {
      const r = await run('osascript', ['-l', 'JavaScript', '-e', CALL_READ], 4000);
      if (!r.ok) { if (/not allowed|assistive|-1719|-25211|1002/i.test(r.err)) this.setAccess('calls', 'denied'); return; }
      this.setAccess('calls', 'ok');
      let wins = []; try { wins = JSON.parse(r.out || '[]'); } catch {}
      let caller = ''; for (const w of wins) { caller = callerFrom(w.texts || [], w.buttons || []); if (caller) break; }
      if (caller !== this.caller) { this.caller = caller; this.emit('call', caller ? { from: caller } : null); }
    } finally { this.busy.c = false; }
  }
}

module.exports = { MacAlerts, textFromAttributed, firstLine, phoneKey, callerFrom };
