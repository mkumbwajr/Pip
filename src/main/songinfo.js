'use strict';
// Release year, cover art and the album (when the player gives none) from Apple's public iTunes Search: no key, no account.
// Only the song's title and artist are sent. Each song is asked once and cached on disk, including "not found".
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[(\[](feat|ft|with)\b[^)\]]*[)\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The search result that is this song: same title and artist, the first release of it (not a later deluxe or
    compilation). No match gives null: no year is better than a wrong one. */
function pick(results, title, artist) {
  const tt = norm(title), aa = norm(artist);
  const artistOk = r => !aa || norm(r.artistName).includes(aa) || aa.includes(norm(r.artistName));
  const same = (results || []).filter(r => r.trackName && r.releaseDate && norm(r.trackName) === tt && artistOk(r));
  return same.sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)))[0] || null;
}

async function fetchSongInfo({ title, artist }, { cacheDir, fetchImpl = fetch } = {}) {
  if (!title) return null;
  const key = createHash('sha1').update(['itunes2', title, artist].join('|').toLowerCase()).digest('hex');
  const file = cacheDir ? path.join(cacheDir, key + '.json') : null;
  if (file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')).info; } catch {} }
  const q = new URLSearchParams({ term: [artist, title].filter(Boolean).join(' '), media: 'music', entity: 'song', limit: '10' });
  const res = await fetchImpl('https://itunes.apple.com/search?' + q, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('itunes ' + res.status); // not cached: asked again next time
  const hit = pick((await res.json()).results, title, artist);
  const art = hit?.artworkUrl100 ? String(hit.artworkUrl100).replace(/\/\d+x\d+bb\./, '/600x600bb.') : '';
  const info = hit ? { year: Number(String(hit.releaseDate).slice(0, 4)) || null, album: hit.collectionName || '', artwork: /^https:\/\/[\w.-]+\.mzstatic\.com\//.test(art) ? art : '' } : null;
  if (file) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ info })); } catch {} }
  return info;
}

module.exports = { fetchSongInfo, pick, norm };
