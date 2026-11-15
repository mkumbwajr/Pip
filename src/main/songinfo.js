'use strict';
// Release year, cover art and the album (when the player gives none) from Apple's public iTunes Search, and covers iTunes
// lacks from Deezer's public search: no key, no account.
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
/** For the cover only, a close match is good enough: the same artist and a title that contains the other once extras
    like "(feat. ...)", "- Remastered" or "Radio Edit" are dropped. A cover from the right artist and song beats none. */
const core = s => norm(String(s || '').replace(/\s+[-–]\s+.*$/, '').replace(/[(\[].*?[)\]]/g, ''));
function pickCover(results, title, artist) {
  const tt = core(title), aa = norm(artist); if (!tt) return null;
  const artistOk = r => !aa || norm(r.artistName).includes(aa) || aa.includes(norm(r.artistName)) || aa.split(' ').some(w => w.length > 2 && norm(r.artistName).includes(w));
  return (results || []).find(r => r.artworkUrl100 && artistOk(r) && (core(r.trackName) === tt || core(r.trackName).includes(tt) || tt.includes(core(r.trackName)))) || null;
}

async function fetchSongInfo({ title, artist }, { cacheDir, fetchImpl = fetch } = {}) {
  if (!title) return null;
  const key = createHash('sha1').update(['itunes3', title, artist].join('|').toLowerCase()).digest('hex'); // itunes3: covers from close matches too
  const file = cacheDir ? path.join(cacheDir, key + '.json') : null;
  if (file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')).info; } catch {} }
  const q = new URLSearchParams({ term: [artist, title].filter(Boolean).join(' '), media: 'music', entity: 'song', limit: '10' });
  const res = await fetchImpl('https://itunes.apple.com/search?' + q, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('itunes ' + res.status); // not cached: asked again next time
  let results = (await res.json()).results; const hit = pick(results, title, artist); let cover = hit || pickCover(results, title, artist);
  // nothing close: search again with the bare title (brackets and " - ..." extras spoil the search itself)
  const bare = String(title).replace(/\s+[-–]\s+.*$/, '').replace(/[(\[].*?[)\]]/g, '').trim();
  if (!cover && bare && bare !== title) {
    const again = await fetchImpl('https://itunes.apple.com/search?' + new URLSearchParams({ term: [artist, bare].filter(Boolean).join(' '), media: 'music', entity: 'song', limit: '10' }), { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (again?.ok) { results = (await again.json()).results; cover = pickCover(results, title, artist); }
  }
  // still no cover: Deezer's public search (no key), whose catalogue has far more East African music than iTunes
  let deezerArt = '';
  if (!cover) {
    const dz = await fetchImpl('https://api.deezer.com/search?' + new URLSearchParams({ q: [artist, bare || title].filter(Boolean).join(' '), limit: '10' }), { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (dz?.ok) {
      const rows = ((await dz.json().catch(() => ({}))).data || []).map(r => ({ trackName: r.title, artistName: r.artist?.name, artworkUrl100: r.album?.cover_xl || r.album?.cover_big || '' }));
      const found = pickCover(rows, title, artist); if (found && /^https:\/\/[\w.-]+\.dzcdn\.net\//.test(found.artworkUrl100)) deezerArt = found.artworkUrl100;
    }
  }
  const art = cover?.artworkUrl100 ? String(cover.artworkUrl100).replace(/\/\d+x\d+bb\./, '/600x600bb.') : '';
  const artwork = /^https:\/\/[\w.-]+\.mzstatic\.com\//.test(art) ? art : deezerArt;
  // the year and album only from an exact match (no year is better than a wrong one); the cover from a close one too
  const info = hit ? { year: Number(String(hit.releaseDate).slice(0, 4)) || null, album: hit.collectionName || '', artwork } : artwork ? { year: null, album: '', artwork } : null;
  if (file) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ info })); } catch {} }
  return info;
}

module.exports = { fetchSongInfo, pick, pickCover, norm };
