'use strict';
// Peep's settings window. Every change is saved at once; the main process tells the island to pick it up.
const api = window.peep;
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = $('#page');
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#e8e8ee'];
let t = window.makeT({}), S = null;

const hatName = h => ({ none: t('No hat'), cap: t('Cap'), crown: t('Crown'), bow: t('Bow') }[h]);
const check = (id, on, label) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;

// The sections in the sidebar: [id, group, name, one line under the title]
const sections = () => [
  ['overview', 'Peep', t('Overview'), t('How Peep is set up on this PC')],
  ['agents', 'Peep', t('Agents'), t('Which agents Peep follows, and how they answer you')],
  ['look', S.settings.mascot.name, t('Look'), t('Name, colour and hat')],
  ['island', t('Settings'), t('Island'), t('Where the island sits on your screen')],
  ['general', t('Settings'), t('General'), t('Language, sound, start-up, weather and calendar')],
  ['music', t('Settings'), t('Music'), t('Lyrics and Spotify devices')],
  ['guard', t('Settings'), t('Focus guard'), t('A pause before the things that distract you')]
];
let current = 'overview';
const fact = (ok, text) => `<div class="fact"><i class="${ok === null ? '' : ok ? 'ok' : 'bad'}"></i><span>${text}</span></div>`;

const views = {
  overview() {
    const s = S.settings;
    return `<div class="panel"><h2>${esc(t('Agents'))}</h2>${fact(S.agents.claude, 'Claude Code: ' + esc(S.agents.claude ? t('Connected') : t('Not connected')))}${fact(S.agents.codex, 'Codex: ' + esc(S.agents.codex ? t('Connected') : t('Not connected')))}
        ${fact(S.node, esc(S.node ? t('Node.js found: you can answer from the island and see your usage.') : t('Answering from here and the usage bars need Node.js on this PC.')))}
        ${S.hubError ? fact(false, esc(S.hubError)) : ''}</div>
      <div class="panel"><h2>Peep</h2>${fact(null, esc(t('Version {v}', { v: S.version })) + ' · MIT')}${fact(null, esc(t('Shortcut: {keys}', { keys: s.shortcut })))}${fact(null, esc(t('Hover over the island to open it. Click it to keep it open.')))}</div>`;
  },
  agents() {
    return `<div class="panel"><h2>${esc(t('Follow'))}</h2>${check('ag-claude', S.agents.claude, esc(t('Follow Claude Code')) + ` <span class="dim small">(~/.claude/settings.json)</span>`)}${check('ag-codex', S.agents.codex, esc(t('Follow Codex')) + ` <span class="dim small">(~/.codex/hooks.json)</span>`)}<div class="small" id="ag-error" data-kind="error"></div></div>
      <div class="panel"><h2>${esc(t('Language'))}</h2>${check('s-agentlang', S.settings.agentLanguage, esc(t('Agents answer me in this language')))}
        <label class="field"><span>${esc(t('Ask about your screen with'))}</span><select id="s-buddy"><option value="claude" ${S.settings.buddyAgent === 'claude' ? 'selected' : ''}>Claude Code</option><option value="codex" ${S.settings.buddyAgent === 'codex' ? 'selected' : ''}>Codex</option></select></label></div>`;
  },
  look() {
    const s = S.settings;
    return `<div class="panel"><label class="field"><span>${esc(t('Name'))}</span><input type="text" id="m-name" maxlength="20" value="${esc(s.mascot.name)}"></label>
      <div class="row"><div class="swatches">${COLORS.map(c => `<button data-color="${c}" class="${c === s.mascot.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div>
        <select id="m-hat" data-narrow>${['none', 'cap', 'crown', 'bow'].map(h => `<option value="${h}" ${h === s.mascot.hat ? 'selected' : ''}>${esc(hatName(h))}</option>`).join('')}</select></div></div>`;
  },
  island() {
    const s = S.settings;
    return `<div class="panel"><div class="seg">
        <button data-mode="attach" class="${s.island.mode === 'detach' ? '' : 'on'}"><b>${esc(t('Attach'))}</b><span>${esc(t('Joined to the top edge of the screen'))}</span></button>
        <button data-mode="detach" class="${s.island.mode === 'detach' ? 'on' : ''}"><b>${esc(t('Detach'))}</b><span>${esc(t('Floating just below the top edge'))}</span></button></div></div>
      <div class="panel"><label class="field"><span>${esc(t('Background transparency'))}</span><div class="row"><input type="range" id="i-alpha" min="0" max="60" value="${Math.round((1 - (s.island.opacity ?? 1)) * 100)}"><span class="dim" id="i-alpha-n">${Math.round((1 - (s.island.opacity ?? 1)) * 100)}%</span></div></label></div>
      ${S.displays > 1 ? `<div class="panel"><label class="field"><span>${esc(t('Screen'))}</span><select id="s-display">${Array.from({ length: S.displays }, (_, i) => `<option value="${i}" ${i === s.island.display ? 'selected' : ''}>${esc(t('Screen {n}', { n: i + 1 }))}</option>`).join('')}</select></label></div>` : ''}`;
  },
  general() {
    const s = S.settings;
    return `<div class="panel"><h2>${esc(t('Language'))}</h2><select id="s-lang">${S.languages.map(l => `<option value="${esc(l.code)}" ${l.code === s.lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="panel">${check('s-sounds', s.sounds, esc(t('Chime when an agent finishes')))}${check('s-auto', S.autostart, esc(t('Start with Windows')))}</div>
      <div class="panel"><label class="field"><span>${esc(t('Town for the weather'))}</span><div class="row"><input type="text" class="grow" id="s-place" value="${esc(s.weather.place)}"><button class="btn" id="w-go">${esc(t('Check'))}</button></div></label>
        <div class="small dim" id="w-out"></div><br>
        <label class="field"><span>${esc(t('Calendar link (private iCal address, https)'))}</span><input type="url" id="s-cal" value="${esc(s.calendarUrl)}"></label></div>`;
  },
  music() {
    const s = S.settings;
    return `<div class="panel">${check('s-lyrics', s.lyrics, esc(t('Show song lyrics (asks lrclib.net for the song)')))}${check('s-songinfo', s.songInfo, esc(t('Show the release year (asks iTunes Search for the song)')))}</div>
      <div class="panel"><h2>Spotify</h2><div class="dim small">${esc(t('Only for choosing which device plays. Needs your own free client ID from developer.spotify.com, with this redirect address:'))} <span class="mono">http://127.0.0.1:48612/callback</span></div>
        <div class="row" data-gap><input type="text" class="grow" id="sp-id" placeholder="Client ID" value="${esc(s.spotifyClientId)}"><button class="btn ${S.spotify ? '' : 'primary'}" id="sp-go">${esc(S.spotify ? t('Disconnect') : t('Connect'))}</button></div><div class="small" id="sp-error" data-kind="error"></div></div>`;
  },
  guard() {
    const s = S.settings;
    return `<div class="panel">${check('g-on', s.guard.on, esc(t('Pause me before these open')))}
      <label class="field"><span>${esc(t('Words to watch for in window titles, separated by commas'))}</span><input type="text" id="g-sites" value="${esc(s.guard.sites.join(', '))}"></label></div>`;
  }
};

function draw() {
  const s = S.settings, list = sections(), now = list.find(x => x[0] === current) || list[0];
  document.title = t('Peep settings'); $('#brand-sub').textContent = t('Settings');
  let group = '';
  $('#nav').innerHTML = list.map(([id, g, name]) => `${g !== group ? `<h3>${esc(group = g)}</h3>` : ''}<button data-go="${id}" class="${id === now[0] ? 'on' : ''}"><i></i>${esc(name)}</button>`).join('');
  $('#foot').textContent = `Peep ${S.version}`;
  $('#title').textContent = now[2]; $('#subtitle').textContent = now[3];
  page.innerHTML = views[now[0]]();
  for (const el of page.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  for (const el of page.querySelectorAll('[data-kind=error]')) el.style.color = 'var(--error)';
  for (const el of page.querySelectorAll('[data-narrow]')) el.style.width = '130px';
  for (const el of page.querySelectorAll('[data-gap]')) el.style.margin = '8px 0';
  document.documentElement.style.setProperty('--pip', s.mascot.color);
  // the live copy of the island in the header
  $('#preview').className = s.island.mode === 'detach' ? 'detach' : '';
  for (const pip of document.querySelectorAll('.pip')) pip.className = 'pip' + (s.mascot.hat !== 'none' ? ' hat-' + s.mascot.hat : '');
  tick();
}
function tick() { $('#pv-clock').textContent = new Date().toLocaleTimeString(S.settings.lang === 'sw' ? 'sw-TZ' : undefined, { hour: '2-digit', minute: '2-digit' }); }
async function save(patch) { S.settings = await api.setSettings(patch); }
/** Looks the town up right away and says what was found, so a typo is visible here and not as an empty card. */
async function checkWeather() {
  const out = $('#w-out'); out.textContent = '…';
  await save({ weather: { place: $('#s-place').value.trim() } });
  const w = await api.weather();
  out.textContent = !S.settings.weather.place ? '' : w?.error ? t('Could not get the weather: {error}', { error: w.error }) : w ? `${w.place}: ${w.temp}${w.unit}` : t('That town was not found.');
  out.style.color = w?.error || !w ? 'var(--error)' : '';
}

page.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mode) { await save({ island: { mode: b.dataset.mode } }); draw(); }
  else if (b.dataset.color) { await save({ mascot: { color: b.dataset.color } }); draw(); }
  else if (b.id === 'w-go') { e.preventDefault(); checkWeather(); }
  else if (b.id === 'sp-go') {
    if (S.spotify) { await api.spotifyLogout(); S.spotify = false; draw(); return; }
    await save({ spotifyClientId: $('#sp-id').value.trim() }); $('#sp-error').textContent = t('Finish the login in your browser…');
    const r = await api.spotifyLogin(); S.spotify = r.ok; draw(); if (!r.ok) $('#sp-error').textContent = r.error;
  }
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { current = b.dataset.go; draw(); page.scrollTop = 0; } });
page.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 's-place') { e.preventDefault(); checkWeather(); } });
page.addEventListener('input', e => {
  if (e.target.id !== 'i-alpha') return;
  $('#i-alpha-n').textContent = e.target.value + '%'; save({ island: { opacity: 1 - e.target.value / 100 } }); // live, while dragging
});
page.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'ag-claude' || el.id === 'ag-codex') {
    const r = await api.connectAgent(el.id.slice(3), el.checked); S.agents = r.agents || S.agents;
    draw(); if (!r.ok) $('#ag-error').textContent = t('Could not change that: {error}', { error: r.error });
  }
  else if (el.id === 's-lang') { await save({ lang: el.value }); location.reload(); }
  else if (el.id === 's-agentlang') save({ agentLanguage: el.checked });
  else if (el.id === 'm-name') { await save({ mascot: { name: el.value.trim() || 'Pip' } }); draw(); }
  else if (el.id === 'm-hat') { await save({ mascot: { hat: el.value } }); draw(); }
  else if (el.id === 's-sounds') save({ sounds: el.checked });
  else if (el.id === 's-lyrics') save({ lyrics: el.checked });
  else if (el.id === 's-songinfo') save({ songInfo: el.checked });
  else if (el.id === 's-auto') S.autostart = await api.setAutostart(el.checked);
  else if (el.id === 's-buddy') save({ buddyAgent: el.value });
  else if (el.id === 's-place') checkWeather();
  else if (el.id === 's-cal') save({ calendarUrl: el.value.trim() });
  else if (el.id === 's-display') save({ island: { display: +el.value } });
  else if (el.id === 'g-on') save({ guard: { on: el.checked } });
  else if (el.id === 'g-sites') save({ guard: { sites: el.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40) } });
});

(async () => {
  S = await api.init(); S.hubError = await api.hubError(); t = window.makeT(S.strings); document.documentElement.lang = S.settings.lang;
  draw(); setInterval(tick, 5000);
})();
