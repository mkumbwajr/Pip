const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { nextEvent, parseEvents } = require('../src/main/ics.js');
const { parseLrc, lineAt, fetchLyrics, simple, splitTitle } = require('../src/main/lyrics.js');
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
  const got = []; const share = new Share({ files: () => [a], saveDir: path.join(dir, 'in'), onReceive: p => got.push(p), host: '127.0.0.1', port: 0 });
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

test('store: modes keep their other switches when one changes; the restore point can be cleared', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peep-modes-')), 'settings.json');
  const s = new Store(file);
  assert.deepEqual(s.get('modes.work'), { min: 50, block: true, only: true, music: true });
  s.set({ modes: { work: { music: false } }, modeRestore: { guardOn: false }, guard: { on: true } });
  const again = new Store(file);
  assert.deepEqual(again.get('modes.work'), { min: 50, block: true, only: true, music: false });
  assert.deepEqual(again.get('modeRestore'), { guardOn: false });
  again.set({ modeRestore: null, guard: { on: false } });
  assert.equal(new Store(file).get('modeRestore'), null); assert.equal(new Store(file).get('guard.on'), false);
  assert.equal(new Store(file).get('guard.sites').length, 5);
});

test('lyrics: "Artist - Title" with no artist is split; a free-text search runs when the exact one finds nothing', async () => {
  assert.deepEqual(splitTitle('Cass - Jidai', ''), { title: 'Jidai', artist: 'Cass' });
  assert.deepEqual(splitTitle('Love - Live', 'Band'), { title: 'Love - Live', artist: 'Band' });
  const asked = [];
  const fake = async url => { const p = new URL(url).searchParams; asked.push(Object.fromEntries(p)); return { ok: true, json: async () => (p.get('q') ? [{ duration: 100, syncedLyrics: '[00:02.00]hi' }] : []) }; };
  const lines = await fetchLyrics({ title: 'Cass - Jidai', artist: '' }, { fetchImpl: fake });
  assert.equal(lines[0].text, 'hi');
  assert.deepEqual(asked, [{ track_name: 'Jidai', artist_name: 'Cass' }, { q: 'Cass Jidai' }]);
});

test('song info: picks the first release of the same song, never a remix; caches the answer', async () => {
  const { pick, fetchSongInfo } = require('../src/main/songinfo.js');
  const results = [
    { artistName: 'The Weeknd & ROSALIA', trackName: 'Blinding Lights (Remix)', collectionName: 'Remix - Single', releaseDate: '2020-12-04T08:00:00Z' },
    { artistName: 'The Weeknd', trackName: 'Blinding Lights', collectionName: 'After Hours (Deluxe)', releaseDate: '2020-03-20T07:00:00Z' },
    { artistName: 'The Weeknd', trackName: 'Blinding Lights', collectionName: 'After Hours', releaseDate: '2019-11-29T08:00:00Z' }];
  assert.equal(pick(results, 'Blinding Lights', 'The Weeknd').collectionName, 'After Hours');
  assert.equal(pick(results, 'Save Your Tears', 'The Weeknd'), null);
  assert.equal(pick([{ artistName: 'Rema', trackName: 'Calm Down (feat. Selena Gomez)', releaseDate: '2022-08-25' }], 'Calm Down', 'Rema').releaseDate, '2022-08-25');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-song-')); let calls = 0;
  const fake = async () => { calls++; return { ok: true, json: async () => ({ results }) }; };
  assert.deepEqual(await fetchSongInfo({ title: 'Blinding Lights', artist: 'The Weeknd' }, { cacheDir: dir, fetchImpl: fake }), { year: 2019, album: 'After Hours', artwork: '' });
  await fetchSongInfo({ title: 'Blinding Lights', artist: 'The Weeknd' }, { cacheDir: dir, fetchImpl: fake }); assert.equal(calls, 1);
});

test('google: events become { title, start, end, allDay }, cancelled ones dropped; scopes stay read-only', () => {
  const { toEvents, authorizeUrl, SCOPES } = require('../src/main/google.js');
  const out = toEvents([
    { summary: 'Standup', start: { dateTime: '2026-11-14T09:00:00Z' }, end: { dateTime: '2026-11-14T09:15:00Z' } },
    { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-11-14T08:00:00Z' }, end: { dateTime: '2026-11-14T08:30:00Z' } },
    { summary: 'Holiday', start: { date: '2026-11-13' }, end: { date: '2026-11-14' } }]);
  assert.deepEqual(out.map(e => [e.title, e.allDay]), [['Holiday', true], ['Standup', false]]);
  assert.equal(out[1].end - out[1].start, 15 * 60e3);
  assert.deepEqual(SCOPES.split(' ').sort(), ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.labels']);
  const u = new URL(authorizeUrl('x.apps.googleusercontent.com', 'ch', 'st'));
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:48613'); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

test('update: version comparison and the "no release yet" answer', async () => {
  const { isNewer, latestRelease } = require('../src/main/update.js');
  assert.equal(isNewer('0.5.0', '0.4.0'), true); assert.equal(isNewer('v0.4.1', '0.4.0'), true); assert.equal(isNewer('0.4.0', '0.4.0'), false);
  assert.equal(isNewer('0.10.0', '0.9.9'), true); assert.equal(isNewer('0.3.9', '0.4.0'), false); assert.equal(isNewer('1.0', '0.9.9'), true);
  assert.deepEqual(await latestRelease({ current: '0.4.0', fetchImpl: async () => ({ status: 404, ok: false }) }), { current: '0.4.0', latest: '0.4.0', newer: false });
  // the site answers first
  const site = await latestRelease({ current: '0.4.0', fetchImpl: async u => (u.startsWith('https://peep.bang.co.tz/') ? { ok: true, status: 200, json: async () => ({ version: '0.5.0', url: 'https://peep.bang.co.tz/download/Peep-Setup-0.5.0.exe' }) } : assert.fail('github asked')) });
  assert.deepEqual(site, { current: '0.4.0', latest: '0.5.0', newer: true, url: 'https://peep.bang.co.tz/download/Peep-Setup-0.5.0.exe' });
  // site down: GitHub Releases
  const r = await latestRelease({ current: '0.4.0', fetchImpl: async u => (u.startsWith('https://peep.bang.co.tz/') ? { ok: false, status: 502 } : { status: 200, ok: true, json: async () => ({ tag_name: 'v0.5.0', html_url: 'https://github.com/mkumbwajr/Peep/releases/tag/v0.5.0' }) }) });
  assert.equal(r.newer, true); assert.equal(r.latest, '0.5.0');
  const { isReleaseUrl } = require('../src/main/update.js');
  assert.equal(isReleaseUrl('https://peep.bang.co.tz/download/x.exe'), true); assert.equal(isReleaseUrl('https://evil.example/peep.bang.co.tz/'), false);
});

test('google: Peep never asks for email contents or headers (only counts), so it can be verified for everyone', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main', 'google.js'), 'utf8');
  assert.ok(!/gmail\.(readonly|metadata|modify)|mail\.google\.com\/$/.test(src), 'no restricted Gmail permission');
  assert.ok(!/\/messages/.test(src), 'no message is ever listed or read');
});

test('share: the page address comes from the adapter that carries traffic; the firewall rule check reads netsh', async () => {
  const { routeAddress } = require('../src/main/share.js');
  const a = await routeAddress(); assert.ok(a === null || /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const { ruleCovers } = require('../src/main/firewall.js');
  const out = 'Rule Name:                            Peep phone sharing\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProfiles:                             Domain,Private,Public\r\nRemoteIP:                             LocalSubnet\r\nProtocol:                             TCP\r\nAction:                               Allow\r\nProgram:                              C:\\Users\\A\\AppData\\Local\\Programs\\Peep\\Peep.exe\r\n';
  assert.equal(ruleCovers(out, 'c:\\users\\a\\appdata\\local\\programs\\peep\\peep.exe'), true);
  assert.equal(ruleCovers(out.replace('Yes', 'No'), 'C:\\Users\\A\\AppData\\Local\\Programs\\Peep\\Peep.exe'), false);
  assert.equal(ruleCovers(out, 'C:\\Other\\Peep.exe'), false);
  assert.equal(ruleCovers('No rules match the specified criteria.', 'x'), false);
});

test('song info: cover art address comes from Apple only, at 600 px', async () => {
  const { fetchSongInfo } = require('../src/main/songinfo.js');
  const results = [{ artistName: 'Rema', trackName: 'Calm Down', collectionName: 'Rave & Roses', releaseDate: '2022-02-11', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/100x100bb.jpg' }];
  const info = await fetchSongInfo({ title: 'Calm Down', artist: 'Rema' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ results }) }) });
  assert.equal(info.artwork, 'https://is1-ssl.mzstatic.com/image/thumb/Music/x/600x600bb.jpg');
  results[0].artworkUrl100 = 'https://evil.example/100x100bb.jpg';
  assert.equal((await fetchSongInfo({ title: 'Calm Down', artist: 'Rema' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ results }) }) })).artwork, '');
});

test('lyrics: a song without timed lyrics is an empty list (cached); a network failure throws so it is asked again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-ly-')); let calls = 0;
  const none = async () => { calls++; return { ok: true, json: async () => [{ duration: 100, plainLyrics: 'la' }] }; };
  assert.deepEqual(await fetchLyrics({ title: 'Song', artist: 'A' }, { cacheDir: dir, fetchImpl: none }), []);
  assert.deepEqual(await fetchLyrics({ title: 'Song', artist: 'A' }, { cacheDir: dir, fetchImpl: none }), []);
  assert.equal(calls, 2); // exact search + free-text search, then served from the cache
  await assert.rejects(fetchLyrics({ title: 'Other', artist: 'B' }, { cacheDir: dir, fetchImpl: async () => ({ ok: false, status: 503 }) }));
  assert.deepEqual(await fetchLyrics({ title: 'Other', artist: 'B' }, { cacheDir: dir, fetchImpl: none }), []); // not cached after the failure
});
