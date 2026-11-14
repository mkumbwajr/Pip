'use strict';
// Timed lyrics from LRCLIB (lrclib.net: open, no key). Only the song's title, artist and length are sent.
// Each song is asked once and cached on disk, including "not found".
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

/** "[01:02.50] words" → [{ t: ms, text }], sorted. Lines can carry several time tags. */
function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]; if (!tags.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: (+m[1] * 60 + +m[2]) * 1000 + (m[3] ? Math.round(+('0.' + m[3]) * 1000) : 0), text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** The line being sung at `ms` (null before the first one). */
function lineAt(lines, ms) { let cur = null; for (const l of lines) { if (l.t <= ms) cur = l; else break; } return cur; }

/** Some players (Windows Media Player with untagged files) send "Artist - Title" as the title and no artist. */
function splitTitle(title, artist) {
  const m = !artist && String(title).match(/^(.+?)\s+[-–]\s+(.+)$/);
  return m ? { title: m[2].trim(), artist: m[1].trim() } : { title, artist };
}
const simple = s => String(s || '').replace(/\s*[-–(\[].*(remaster|live|feat|version|edit|mono|stereo).*$/i, '').trim();

async function fetchLyrics({ title, artist, durationSec }, { cacheDir, fetchImpl = fetch } = {}) {
  if (!title) return null;
  const key = createHash('sha1').update([title, artist, Math.round(durationSec || 0)].join('|').toLowerCase()).digest('hex');
  const file = cacheDir ? path.join(cacheDir, key + '.json') : null;
  if (file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')).lines || []; } catch {} }
  const headers = { 'User-Agent': 'Pip (https://github.com/mkumbwajr/pip)' };
  ({ title, artist } = splitTitle(title, artist));
  const ask = async params => {
    const res = await fetchImpl('https://lrclib.net/api/search?' + new URLSearchParams(params), { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('lrclib ' + res.status); // not cached: asked again next time
    return (await res.json()).filter(h => h.syncedLyrics);
  };
  let hits = await ask({ track_name: simple(title), artist_name: String(artist || '').split(/,|&| feat/i)[0].trim() });
  if (!hits.length) hits = await ask({ q: [artist, simple(title)].filter(Boolean).join(' ') }); // looser: one free-text search
  const hit = hits.find(h => !durationSec || Math.abs((h.duration || 0) - durationSec) <= 3) || hits[0];
  const lines = hit ? parseLrc(hit.syncedLyrics) : []; // [] = this song has no timed lyrics (cached); a thrown error = ask again later
  if (file) { try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ lines })); } catch {} }
  return lines;
}

module.exports = { parseLrc, lineAt, fetchLyrics, simple, splitTitle };
