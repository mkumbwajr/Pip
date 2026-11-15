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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-')); let calls = 0;
  const fake = async () => { calls++; return { ok: true, json: async () => [{ duration: 200, syncedLyrics: '[00:01.00]la' }] }; };
  const song = { title: 'Song', artist: 'A', durationSec: 201 };
  assert.equal((await fetchLyrics(song, { cacheDir: dir, fetchImpl: fake }))[0].text, 'la');
  await fetchLyrics(song, { cacheDir: dir, fetchImpl: fake }); assert.equal(calls, 2); // the two searches of the first lookup; the second comes from the cache
});

test('share: secret link, download, upload with a safe name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-')), a = path.join(dir, 'a.txt'); fs.writeFileSync(a, 'hello');
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
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pip-')), 's.json');
  const s = new Store(file); assert.equal(s.get('mascot.name'), 'Pip');
  s.set({ mascot: { color: '#fff' } });
  const again = new Store(file); assert.equal(again.get('mascot.color'), '#fff'); assert.equal(again.get('mascot.name'), 'Pip');
});

test('store: modes keep their other switches when one changes; the restore point can be cleared', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pip-modes-')), 'settings.json');
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
  assert.deepEqual(asked.sort((a, b) => Object.keys(a)[0].localeCompare(Object.keys(b)[0])), [{ q: 'Cass Jidai' }, { track_name: 'Jidai', artist_name: 'Cass' }]); // both searches go out together
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-song-')); let calls = 0;
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
  const site = await latestRelease({ current: '0.4.0', build: '', fetchImpl: async u => (u.startsWith('https://pip.bang.co.tz/') ? { ok: true, status: 200, json: async () => ({ version: '0.5.0', url: 'https://pip.bang.co.tz/download/Pip-Setup-0.5.0.exe', mac: 'https://pip.bang.co.tz/download/Pip-0.5.0-mac.dmg' }) } : assert.fail('github asked')) });
  assert.deepEqual(site, { current: '0.4.0', latest: '0.5.0', newer: true, url: process.platform === 'darwin' ? 'https://pip.bang.co.tz/download/Pip-0.5.0-mac.dmg' : 'https://pip.bang.co.tz/download/Pip-Setup-0.5.0.exe' }); // each system gets its own download
  // site down: GitHub Releases
  const r = await latestRelease({ current: '0.4.0', fetchImpl: async u => (u.startsWith('https://pip.bang.co.tz/') ? { ok: false, status: 502 } : { status: 200, ok: true, json: async () => ({ tag_name: 'v0.5.0', html_url: 'https://github.com/mkumbwajr/Pip/releases/tag/v0.5.0' }) }) });
  assert.equal(r.newer, true); assert.equal(r.latest, '0.5.0');
  // the same version built again later: newer only by the build stamp, for this system
  const sys = process.platform === 'darwin' ? 'mac' : 'win';
  const answer = build => async () => ({ ok: true, status: 200, json: async () => ({ version: '0.7.0', url: 'https://pip.bang.co.tz/download/Pip-Setup-0.7.0.exe', mac: 'https://pip.bang.co.tz/download/Pip-0.7.0-mac.dmg', build: { [sys]: build } }) });
  assert.equal((await latestRelease({ current: '0.7.0', build: '202611150900', fetchImpl: answer('202611151200') })).newer, true);
  assert.equal((await latestRelease({ current: '0.7.0', build: '202611151200', fetchImpl: answer('202611151200') })).newer, false);
  assert.equal((await latestRelease({ current: '0.7.0', build: '', fetchImpl: answer('202611151200') })).newer, false, 'run from source: no stamp, no nagging');
  assert.equal((await latestRelease({ current: '0.8.0', build: '202601010000', fetchImpl: answer('202611151200') })).newer, false, 'an older version is never offered');
  const { isReleaseUrl } = require('../src/main/update.js');
  assert.equal(isReleaseUrl('https://pip.bang.co.tz/download/x.exe'), true); assert.equal(isReleaseUrl('https://evil.example/pip.bang.co.tz/'), false);
});

test('google: Pip never asks for email contents or headers (only counts), so it can be verified for everyone', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main', 'google.js'), 'utf8');
  assert.ok(!/gmail\.(readonly|metadata|modify)|mail\.google\.com\/$/.test(src), 'no restricted Gmail permission');
  assert.ok(!/\/messages/.test(src), 'no message is ever listed or read');
});

test('share: the page address comes from the adapter that carries traffic; the firewall rule check reads netsh', async () => {
  const { routeAddress } = require('../src/main/share.js');
  const a = await routeAddress(); assert.ok(a === null || /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const { ruleCovers } = require('../src/main/firewall.js');
  const out = 'Rule Name:                            Pip phone sharing\r\n----------------------------------------------------------------------\r\nEnabled:                              Yes\r\nDirection:                            In\r\nProfiles:                             Domain,Private,Public\r\nRemoteIP:                             LocalSubnet\r\nProtocol:                             TCP\r\nAction:                               Allow\r\nProgram:                              C:\\Users\\A\\AppData\\Local\\Programs\\Pip\\Pip.exe\r\n';
  assert.equal(ruleCovers(out, 'c:\\users\\a\\appdata\\local\\programs\\pip\\pip.exe'), true);
  assert.equal(ruleCovers(out.replace('Yes', 'No'), 'C:\\Users\\A\\AppData\\Local\\Programs\\Pip\\Pip.exe'), false);
  assert.equal(ruleCovers(out, 'C:\\Other\\Pip.exe'), false);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-ly-')); let calls = 0;
  const none = async () => { calls++; return { ok: true, json: async () => [{ duration: 100, plainLyrics: 'la' }] }; };
  assert.deepEqual(await fetchLyrics({ title: 'Song', artist: 'A' }, { cacheDir: dir, fetchImpl: none }), []);
  assert.deepEqual(await fetchLyrics({ title: 'Song', artist: 'A' }, { cacheDir: dir, fetchImpl: none }), []);
  assert.equal(calls, 2); // exact search + free-text search, then served from the cache
  await assert.rejects(fetchLyrics({ title: 'Other', artist: 'B' }, { cacheDir: dir, fetchImpl: async () => ({ ok: false, status: 503 }) }));
  assert.deepEqual(await fetchLyrics({ title: 'Other', artist: 'B' }, { cacheDir: dir, fetchImpl: none }), []); // not cached after the failure
});

test('pip chat: the whole conversation goes in the prompt, newest last, and asks for no tools', () => {
  const { chatPrompt } = require('../src/main/buddy.js');
  const p = chatPrompt([{ role: 'me', text: 'habari' }, { role: 'pip', text: 'poa' }, { role: 'me', text: 'nisaidie' }], 'Pip');
  assert.match(p, /Do not use any tools/);
  assert.ok(p.indexOf('User: habari') < p.indexOf('Pip: poa') && p.indexOf('Pip: poa') < p.indexOf('User: nisaidie'));
  assert.ok(p.endsWith('Pip:'));
});

test('mac helper: the AppleScript it runs is valid JavaScript, and unknown commands are refused', () => {
  const { MacHelper, READ } = require('../src/main/mac-helper.js');
  assert.doesNotThrow(() => new Function(READ + '\nreturn run;'));
  const h = new MacHelper();
  assert.equal(h.send({ cmd: 'media', action: 'explode' }), false); assert.equal(h.send({ cmd: 'radio' }), false);
  if (process.platform !== 'darwin') { h.start(); assert.equal(h.timer, null); } // does nothing off the Mac (on a Mac it would poll for ever and keep the test run open)
  h.stop();
});

test('account: only preferences travel; sign-in restores an account that has some; newer changes win', async () => {
  const { Account, pick } = require('../src/main/account.js');
  const all = { lang: 'en', note: 'n', agents: { claude: true }, google: { clientId: 'x', secret: 'y' }, firstRunDone: true, island: { display: 2, scale: 1.2, mode: 'detach' }, mascot: { name: 'Bob' } };
  assert.deepEqual(pick(all), { lang: 'en', note: 'n', island: { scale: 1.2, mode: 'detach' }, mascot: { name: 'Bob' } }); // no agents, logins or screen
  let server = { data: { lang: 'sw', mascot: { name: 'Pipo' } }, updatedAt: 500 }, saved = null, applied = [];
  const fake = async (url, o) => {
    const p = new URL(url).pathname;
    if (p === '/api/login') return { ok: true, status: 200, json: async () => ({ token: 'tok', email: 'a@b.c' }) };
    if (p === '/api/prefs' && o.method === 'GET') return { ok: true, status: 200, json: async () => server };
    if (p === '/api/prefs' && o.method === 'PUT') { server = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ updatedAt: server.updatedAt }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const acc = new Account({ load: () => null, save: v => { saved = v; }, getSettings: () => all, apply: p => applied.push(p), fetchImpl: fake, base: 'https://x/api' });
  assert.equal(await acc.signIn('id'), 'restored');
  assert.deepEqual(applied[0], { lang: 'sw', mascot: { name: 'Pipo' } }); assert.equal(saved.token, 'tok'); assert.equal(saved.syncedAt, 500);
  assert.equal(await acc.pull(), false); // nothing newer
  server = { data: { lang: 'en' }, updatedAt: 900 }; assert.equal(await acc.pull(), true); assert.equal(saved.syncedAt, 900);
  await acc.push(); assert.equal(server.data.mascot.name, 'Bob'); assert.ok(server.updatedAt > 900);
  // an empty account takes this device's preferences
  server = { data: null, updatedAt: 0 }; const acc2 = new Account({ load: () => null, save: () => {}, getSettings: () => all, apply: () => assert.fail('nothing to apply'), fetchImpl: fake, base: 'https://x/api' });
  assert.equal(await acc2.signIn('id'), 'saved'); assert.equal(server.data.lang, 'en');
});

test('mac helper: reads Wi-Fi and Bluetooth from the output of macOS tools', () => {
  const { wifiDevice, wifiOn, ssidOf, btOn } = require('../src/main/mac-helper.js');
  assert.equal(wifiDevice('Hardware Port: Ethernet\nDevice: en1\n\nHardware Port: Wi-Fi\nDevice: en0\n'), 'en0');
  assert.equal(wifiDevice('Hardware Port: Ethernet\nDevice: en1\n'), null);
  assert.equal(wifiOn('Wi-Fi Power (en0): On'), true); assert.equal(wifiOn('Wi-Fi Power (en0): Off'), false);
  assert.equal(ssidOf('<dictionary> {\n  SSID : Nyumbani\n}'), 'Nyumbani'); assert.equal(ssidOf('  SSID : <redacted>'), ''); // hidden without location access
  assert.equal(btOn(JSON.stringify({ SPBluetoothDataType: [{ controller_properties: { controller_state: 'attrib_on' } }] })), true);
  assert.equal(btOn(JSON.stringify({ SPBluetoothDataType: [{ controller_properties: { controller_state: 'attrib_off' } }] })), false);
  assert.equal(btOn('not json'), null);
});

test('song info: the cover may come from a close match, the year only from an exact one', () => {
  const { pickCover, pick } = require('../src/main/songinfo.js');
  const rows = [{ trackName: 'Blinding Lights', artistName: 'The Weeknd', artworkUrl100: 'a', releaseDate: '2019' }, { trackName: 'Other', artistName: 'Someone', artworkUrl100: 'b', releaseDate: '2001' }];
  assert.equal(pick(rows, 'Blinding Lights - Radio Edit', 'The Weeknd'), null); // no exact match: no year
  assert.equal(pickCover(rows, 'Blinding Lights - Radio Edit', 'The Weeknd').artworkUrl100, 'a');
  assert.equal(pickCover(rows, 'Komasava (Comment ça va)', 'Diamond Platnumz'), null); // never someone else's cover
});

test('relay: what one side seals only the same key opens, and a changed byte is refused', () => {
  const { seal, open, sealName, openName } = require('../src/main/relay.js');
  const key = require('node:crypto').randomBytes(32), other = require('node:crypto').randomBytes(32);
  const box = seal(key, Buffer.from('siri'));
  assert.equal(open(key, box).toString(), 'siri'); assert.throws(() => open(other, box));
  box[20] ^= 1; assert.throws(() => open(key, box));
  assert.equal(openName(key, sealName(key, 'picha.jpg')), 'picha.jpg'); assert.equal(openName(other, sealName(key, 'x')), '');
});

test('license: the trial, a wrong clock, offline use, and unlocking after a payment', async () => {
  const { License, deviceHash, OFFLINE_DAYS } = require('../src/main/license.js');
  const DAY = 86400000; let clock = 1_000_000_000_000, saved = null, server = { licensed: false, selling: true, started: clock }, sent = [];
  const fake = async (url, o) => {
    sent.push({ url, auth: o.headers.Authorization || '', body: o.body ? JSON.parse(o.body) : null });
    if (url.endsWith('/license/status')) return { ok: true, status: 200, json: async () => ({ licensed: server.licensed, selling: server.selling, priceTzs: 5000, now: clock + 3 * DAY, trialEndsAt: server.started + 7 * DAY }) };
    if (url.includes('/pay/')) return { ok: true, status: 200, json: async () => ({ order: 'PIP-x', status: server.licensed ? 'paid' : 'pending', licensed: server.licensed }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  let token = '';
  const lic = new License({ load: () => null, save: v => { saved = v; }, device: () => deviceHash('machine'), token: () => token, fetchImpl: fake, base: 'https://x/api', now: () => clock });
  assert.equal(lic.view().locked, false); assert.equal(lic.view().daysLeft, 7, 'never reached the server: the trial counts from the first start');
  assert.match(deviceHash('machine'), /^[0-9a-f]{64}$/); assert.notEqual(deviceHash('machine'), deviceHash('other'));
  // this computer's clock is 3 days behind the server's: the server's time counts
  await lic.check(); assert.equal(lic.view().daysLeft, 4); assert.equal(sent[0].body.device, deviceHash('machine')); assert.equal(sent[0].auth, '', 'signed out: no token sent');
  clock += 5 * DAY; assert.equal(lic.view().locked, true, 'trial over');
  server.selling = false; await lic.check(); assert.equal(lic.view().locked, false, 'payments not open: nothing locks'); server.selling = true; await lic.check();
  // signs in and pays: the order check re-checks the license, and Pip unlocks
  token = 'tok'; server.licensed = true;
  const o = await lic.order('PIP-x'); assert.equal(o.licensed, true); assert.equal(lic.view().locked, false); assert.equal(sent.at(-1).auth, 'Bearer tok');
  // offline for a long time: a bought license holds for 30 days without a check, then needs one
  clock += (OFFLINE_DAYS - 1) * DAY; assert.equal(lic.view().locked, false);
  clock += 2 * DAY; assert.equal(lic.view().locked, true);
  assert.ok(saved.checkedAt && saved.localStart, 'the last answer is kept for the next start');
});
