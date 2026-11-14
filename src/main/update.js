'use strict';
// Update check: the newest release on GitHub against the running version. Peep is installed with a plain NSIS
// installer, so an update is simply the newer installer, downloaded from the release page by the user.

/** True when version a ("0.5.0", "v1.2") is newer than b. */
function isNewer(a, b) {
  const n = v => String(v || '').replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const x = n(a), y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}

async function latestRelease({ current, fetchImpl = fetch }) {
  const r = await fetchImpl('https://api.github.com/repos/mkumbwajr/Peep/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return { current, latest: current, newer: false }; // no release published yet
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(), latest = String(j.tag_name || '').replace(/^v/i, '');
  return { current, latest, newer: isNewer(latest, current), url: j.html_url };
}

module.exports = { isNewer, latestRelease };
