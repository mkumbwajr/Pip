const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { makeT } = require('../src/shared/i18n.js');
const { Spotify, pkce, authorizeUrl, REDIRECT } = require('../src/main/spotify.js');

test('i18n: translates, fills values, falls back to English', () => {
  const t = makeT({ Done: 'Tayari', '{agent} needs you': '{agent} anakuhitaji', Empty: '' });
  assert.equal(t('Done'), 'Tayari'); assert.equal(t('{agent} needs you', { agent: 'Codex' }), 'Codex anakuhitaji');
  assert.equal(t('Not there'), 'Not there'); assert.equal(t('Empty'), 'Empty'); assert.equal(makeT(null)('x {a}', { a: 1 }), 'x 1');
});

test('swahili: every text used in the app has a translation, and none is left over', () => {
  const root = path.join(__dirname, '..', 'src'), used = new Set();
  const files = ['renderer/island.js', 'renderer/settings.js', 'renderer/guard.js', 'main/main.js', 'main/share.js', 'main/buddy.js', 'main/spotify.js', 'main/google.js'];
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) used.add(m[1].replace(/\\'/g, "'"));
  const sw = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'sw.json'), 'utf8'));
  assert.deepEqual([...used].filter(k => !sw[k]).sort(), [], 'missing from sw.json');
  assert.deepEqual(Object.keys(sw).filter(k => !used.has(k)).sort(), [], 'in sw.json but not used');
  for (const [k, v] of Object.entries(sw)) assert.deepEqual((v.match(/\{\w+\}/g) || []).sort(), (k.match(/\{\w+\}/g) || []).sort(), 'placeholders differ: ' + k);
});

test('spotify: pkce, login url, token refresh and device list', async () => {
  const { verifier, challenge } = pkce();
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const url = new URL(authorizeUrl('a'.repeat(32), challenge, 'st'));
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  let saved = null; const calls = [];
  const fake = async (u, o) => { calls.push(u);
    if (u.includes('/api/token')) return { ok: true, json: async () => ({ access_token: 'new', expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({ devices: [{ id: 'd1', name: 'Simu', type: 'Smartphone', is_active: true }] }) }; };
  const sp = new Spotify({ load: () => ({ clientId: 'c', access: 'old', refresh: 'r', expires: 0 }), save: v => { saved = v; }, open: () => {}, fetchImpl: fake });
  assert.equal(sp.connected, true);
  assert.deepEqual(await sp.devices(), [{ id: 'd1', name: 'Simu', type: 'Smartphone', active: true }]);
  assert.equal(calls.length, 2); assert.equal(saved.access, 'new'); assert.equal(saved.refresh, 'r');
  await assert.rejects(sp.login('nope'));
});
