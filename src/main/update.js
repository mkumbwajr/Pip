'use strict';
// Update check: the newest version on pip.bang.co.tz (latest.json), or on GitHub Releases if the site cannot be
// reached. Pip is installed with a plain NSIS installer, so an update is simply the newer installer, which the user
// downloads from the page Pip opens.
const SITE = 'https://pip.bang.co.tz';

/** True when version a ("0.5.0", "v1.2") is newer than b. */
function isNewer(a, b) {
  const n = v => String(v || '').replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
/** Only these pages may be opened from the Updates view. */
const isReleaseUrl = url => /^https:\/\/(pip\.bang\.co\.tz\/|github\.com\/mkumbwajr\/Pip\/releases\/)/.test(String(url));

async function fromSite(fetchImpl) {
  const r = await fetchImpl(SITE + '/latest.json', { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); if (!j.version) throw new Error('no version');
  return { latest: String(j.version).replace(/^v/i, ''), url: isReleaseUrl(j.url) ? j.url : SITE + '/' };
}
async function fromGitHub(fetchImpl) {
  const r = await fetchImpl('https://api.github.com/repos/mkumbwajr/Pip/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return null; // no release published yet
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return { latest: String(j.tag_name || '').replace(/^v/i, ''), url: j.html_url };
}

async function latestRelease({ current, fetchImpl = fetch }) {
  let found;
  try { found = await fromSite(fetchImpl); } catch { found = await fromGitHub(fetchImpl); }
  if (!found) return { current, latest: current, newer: false };
  return { current, latest: found.latest, newer: isNewer(found.latest, current), url: found.url };
}

module.exports = { isNewer, latestRelease, isReleaseUrl, SITE };
