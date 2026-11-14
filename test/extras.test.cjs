const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { nextEvent, parseEvents } = require('../src/main/ics.js');
const { parseLrc, lineAt, fetchLyrics, simple } = require('../src/main/lyrics.js');
const { Share, safeName } = require('../src/main/share.js');
const { Store } = require('../src/main/store.js');

test('ics: next event, folded lines, weekly repeat, cancelled', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Old', 'DTSTART:20200101T100000Z', 'DTEND:20200101T110000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Stand', ' up\\, team', 'DTSTART:20260105T090000Z', 'DTEND:20260105T091500Z', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Gone', 'DTSTART:20261114T000000Z', 'STATUS:CANCELLED', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261225', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.equal(parseEvents(ics).length, 3);
  const e = nextEvent(ics, Date.UTC(2026, 10, 14, 12));
  assert.equal(e.title, 'Standup, team');
  assert.equal(e.start.toISOString(), '2026-11-16T09:00:00.000Z');
  assert.equal(nextEvent(ics, Date.UTC(2026, 10, 16, 9, 5)).start.toISOString(), '2026-11-16T09:00:00.000Z'); // still going
  assert.equal(nextEvent(ics, Date.UTC(2026, 10, 16, 9, 15)).start.toISOString(), '2026-11-23T09:00:00.000Z');
});

test('lyrics: parse, current line, cache', async () => {
  const lines = parseLrc('[00:01.50]one\n[00:05.00][00:09.00]two\nno tag');
  assert.deepEqual(lines.map(l => l.t), [1500, 5000, 9000]);
  assert.equal(lineAt(lines, 6000).text, 'two'); assert.equal(lineAt(lines, 100), null);
  assert.equal(simple('Song - Remastered 2011'), 'Song');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-')); let calls = 0;
  const fake = async () => { calls++; return { ok: true, json: async () => [{ duration: 200, syncedLyrics: '[00:01.00]la' }] }; };
  const song = { title: 'Song', artist: 'A', durationSec: 201 };
  assert.equal((await fetchLyrics(song, { cacheDir: dir, fetchImpl: fake }))[0].text, 'la');
  await fetchLyrics(song, { cacheDir: dir, fetchImpl: fake }); assert.equal(calls, 1);
});

test('share: secret link, download, upload with a safe name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-')), a = path.join(dir, 'a.txt'); fs.writeFileSync(a, 'hello');
  const got = []; const share = new Share({ files: () => [a], saveDir: path.join(dir, 'in'), onReceive: p => got.push(p), host: '127.0.0.1' });
  const { url } = await share.start();
  try {
    assert.equal((await fetch(url.replace(/\/[^/]+\/$/, '/wrong/'))).status, 404);
    assert.match(await (await fetch(url)).text(), /a\.txt/);
    assert.equal(await (await fetch(url + 'get/0')).text(), 'hello');
    assert.equal((await fetch(url + 'put/' + encodeURIComponent('..\\..\\evil.txt'), { method: 'PUT', body: 'x' })).status, 200);
    assert.equal(path.dirname(got[0]), path.join(dir, 'in')); assert.equal(fs.readFileSync(got[0], 'utf8'), 'x');
    assert.equal(safeName('a/b:c?.txt'), 'b_c_.txt');
  } finally { await share.stop(); }
  assert.equal(share.status().on, false);
});

test('store: defaults, deep merge, persistence', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peep-')), 's.json');
  const s = new Store(file); assert.equal(s.get('mascot.name'), 'Pip');
  s.set({ mascot: { color: '#fff' } });
  const again = new Store(file); assert.equal(again.get('mascot.color'), '#fff'); assert.equal(again.get('mascot.name'), 'Pip');
});
