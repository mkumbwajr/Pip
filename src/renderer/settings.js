'use strict';
// Pip's settings window. Every change is saved at once; the main process tells the island to pick it up.
// Layout: a sidebar of sections (each with its own icon and colour), a header band in that colour with a live copy of
// the folded island and a search box, then cards of rows: a title, one line of help, and the control on the right.
const api = window.pipApp;
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = $('#page');
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#14a3a8', '#f0435a', '#e8e8ee'];
let t = window.makeT({}), S = null, current = 'home', query = '', confirmReset = false, confirmDelete = false, accountBusy = false, mail = { stage: 'enter', address: '', busy: false };

// ---------- building blocks ----------
const group = (title, rows, extra = '') => `<section class="grp">${title ? `<h2>${esc(title)}</h2>` : ''}<div class="card ${extra}">${rows.join('')}</div></section>`;
// ico: an icon name from icons.js, or a company's own logo (an <svg> from a brand helper there)
const row = (ico, title, sub, control = '', cls = '') => `<div class="row ${cls}" data-find="${esc((title + ' ' + sub).toLowerCase())}">${ico ? (ico.startsWith('<svg') ? `<span class="ri ri-logo">${ico}</span>` : `<span class="ri">${icon(ico)}</span>`) : ''}<div class="rt"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>${control ? `<div class="rc">${control}</div>` : ''}</div>`;
const toggle = (key, on, label) => `<button type="button" class="tg ${on ? 'on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(label)}"><i></i></button>`;
const seg = (key, value, options) => `<div class="sg" data-seg="${key}">${options.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
const slider = (id, min, max, step, value, suffix = '%') => `<div class="sl"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><span id="${id}-n">${value}${suffix}</span></div>`;
const button = (id, label, cls = '') => `<button type="button" class="btn ${cls}" id="${id}">${esc(label)}</button>`;
const hatName = h => ({ none: t('No hat'), cap: t('Cap'), crown: t('Crown'), bow: t('Bow') }[h]);
const mascot = (hat = S.settings.mascot.hat, big = false) => `<span class="mascot${big ? ' big' : ''}${hat !== 'none' ? ' hat-' + hat : ''}"><span class="hat"></span><i></i><i></i></span>`;
const AGENTS = [['claude', 'Claude Code', '~/.claude/settings.json'], ['codex', 'Codex', '~/.codex/hooks.json']];
const SITE_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', reddit: 'Reddit', 'x.com': 'X', facebook: 'Facebook', netflix: 'Netflix' };
const tabNames = () => [['ai', t('Agents')], ['pip', 'Pip'], ['music', t('Music')], ['focus', t('Focus')], ['modes', t('Modes')], ['tray', t('Files')], ['note', t('Note')], ['clips', t('Copied')], ['calendar', t('Calendar')], ['mail', t('Mail')]];

// [id, group, icon, name, one line under the title, colour of the header band]
const sections = () => [
  ['home', 'Pip', 'home', t('Home'), t('Pip on this PC at a glance'), 'var(--pip)'],
  ['connections', 'Pip', 'link', t('Connections'), t('The agents and accounts Pip follows'), '#f5a524'],
  ['license', 'Pip', 'key', t('Pip license'), t('Your trial and your license'), '#2fbf71'],
  ['chat', 'Pip', 'chat', t('AI & Chat'), t('How the agents and Pip answer you'), '#2f9bff'],
  ['mascot', 'Pip', 'pip', S.settings.mascot.name || 'Pip', t('Name and colour'), 'var(--pip)'],
  ['wardrobe', 'Pip', 'hat', t('Wardrobe'), t('Something for Pip to wear'), '#ff5c8a'],
  ['general', t('Settings'), 'sliders', t('General'), t('Language, start-up, sound and the app itself'), '#6f6f7c'],
  ['island', t('Settings'), 'island', t('Island'), t('Size, look and behaviour of the island'), '#7c5cff'],
  ['music', t('Settings'), 'music', t('Music'), t('Lyrics, song details and colours'), '#ff5c8a'],
  ['places', t('Settings'), 'weather', t('Weather & calendar'), t('Your town and your calendar'), '#14a3a8'],
  ['apps', t('Settings'), 'apps', t('Apps'), t('Which tabs show on the island'), '#2fbf71'],
  ['guard', t('Settings'), 'shield', t('Focus guard'), t('A pause before the things that distract you'), '#f0435a'],
  ['support', t('About'), 'help', t('Support'), t('Help, links and the licence'), '#6f6f7c']
];

// ---------- the sections ----------
const views = {
  home() {
    const s = S.settings, n = (S.agents.claude ? 1 : 0) + (S.agents.codex ? 1 : 0), today = new Date().toDateString();
    const done = (S.ai.history || []).filter(h => new Date(h.at).toDateString() === today).length;
    const stat = (ico, value, label, cls = '') => `<div class="stat ${cls}"><span class="ri">${icon(ico)}</span><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
    return `<div class="stats">${stat('link', `${n}/2`, t('Agents connected'), n ? 'ok' : 'warn')}${stat('ai', String((S.ai.sessions || []).length), t('Sessions now'))}${stat('check', String(done), t('Finished today'))}${stat('keyboard', s.shortcut.replace(/Control/, 'Ctrl').replace(/\+/g, ' + '), t('Shortcut'))}</div>`
      + group(t('Status'), [
        row('ai', t('Answer from the island'), S.node ? t('Node.js found: you can answer from the island and see your usage.') : t('Answering from here and the usage bars need Node.js on this PC.'), `<span class="pill ${S.node ? 'ok' : 'warn'}">${esc(S.node ? t('Ready') : t('Missing'))}</span>`),
        ...(S.hubError ? [row('info', t('Problem'), S.hubError, '<span class="pill warn">!</span>')] : []),
        row('island', t('Open the island'), t('Hover over the island to open it. Click it to keep it open.'), button('show-welcome', t('Show the welcome again')))
      ]);
  },
  connections() {
    const agents = AGENTS.map(([id, name, file]) => row(id === 'claude' ? claudeLogo() : openaiLogo(), name, S.agents[id] ? t('Connected') + ' · ' + file : file,
      `<button type="button" class="btn ${S.agents[id] ? '' : 'primary'}" data-agent="${id}">${esc(S.agents[id] ? t('Disconnect') : t('Connect'))}</button>`));
    const s = S.settings, a = S.account || {};
    const when = a.syncedAt ? new Date(a.syncedAt).toLocaleString(S.settings.lang === 'sw' ? 'sw-TZ' : undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const account = group(t('Pip account'), a.signedIn ? [
        row('check', a.email, (when ? t('Synced {when}', { when }) : t('Signed in')) + (a.error ? ' · ' + a.error : ''), button('acct-sync', accountBusy ? t('Syncing…') : t('Sync now')) + button('acct-out', t('Sign out'))),
        row('trash', t('Delete my Pip account'), t('Removes your saved preferences from Pip\'s server and signs out every device. This PC keeps its settings.'), button('acct-del', confirmDelete ? t('Sure? Delete') : t('Delete'), 'danger'))
      ] : [row('link', t('Pip account'), t('Optional. Saves your preferences, note, town and calendar link, so any PC or Mac with Pip can pick them up.'),
        button('acct-in', accountBusy ? t('Finish the login in your browser…') : t('Sign in with Google'), 'primary')),
        mail.stage === 'enter'
          ? row('mail', t('Or with email'), t('We email you a 6-digit code. No password.'), `<input type="email" id="mail-addr" placeholder="${esc(t('you@example.com'))}" value="${esc(mail.address)}">${button('mail-send', mail.busy ? t('Sending…') : t('Send code'))}`, 'wide')
          : row('mail', t('Type the code'), t('We sent a 6-digit code to {email}.', { email: mail.address }), `<input type="text" id="mail-code" inputmode="numeric" maxlength="6" placeholder="000000">${button('mail-verify', mail.busy ? t('Checking…') : t('Sign in'), 'primary')}${button('mail-back', t('Use another email'))}`, 'wide')
      ]) + `<div class="err" id="acct-error"></div>`;
    return account + group(t('Agents'), [...agents, row('shield', t('Only the status is read, on your own PC.'), t('Pip adds its own small hooks and keeps a backup of your file.'), '', 'note')], 'agents')
      + `<div class="err" id="ag-error"></div>`
      + group(t('Accounts'), [
        row(googleG(), 'Google', t('For your calendar and the number of unread emails (never who or what).'), button('go-go', S.google ? t('Sign out') : t('Sign in with Google'), S.google ? '' : 'primary')),
        ...(S.googleBuiltIn ? [] : [row('', t('Your own Google client'), t('Client ID and secret of a Desktop app client.'), `<input type="text" id="go-id" placeholder="Client ID" value="${esc(s.google.clientId)}"><input type="password" id="go-secret" placeholder="Client secret" value="${esc(s.google.secret)}">`, 'wide')]),
        row(spotifyLogo(), 'Spotify', t('Only for choosing which device plays. Needs your own free client ID from developer.spotify.com, with this redirect address:') + ' http://127.0.0.1:48612/callback',
          `<input type="text" id="sp-id" placeholder="Client ID" value="${esc(s.spotifyClientId)}">${button('sp-go', S.spotify ? t('Disconnect') : t('Connect'), S.spotify ? '' : 'primary')}`, 'wide')
      ]) + `<div class="err" id="acc-error"></div>`;
  },
  license() {
    const L = S.license || {}, a = S.account || {}, price = 'TSh ' + Number(L.priceTzs || 5000).toLocaleString('en');
    const status = L.licensed ? t('Bought') : !L.selling ? t('Free for now') : L.locked ? t('The trial is over') : t('Trial: {n} days left', { n: L.daysLeft ?? 7 });
    return group(t('Pip license'), [
        row(L.licensed ? 'check' : 'key', status,
          L.licensed ? t('Every tab is open, on every PC and Mac with your Pip account.') : t('After 7 days, the island and agent status keep working; the other tabs need the license ({price}, once).', { price }),
          L.licensed ? '' : button('lic-buy', t('Buy Pip'), 'primary')),
        a.signedIn ? row('link', a.email, t('The license lives in your Pip account, so it works on every PC and Mac you sign in to.'), button('lic-check', t('Check again')))
          : row('link', t('Pip account'), t('The license lives in your Pip account, so it works on every PC and Mac you sign in to.'), button('lic-signin', t('Sign in first')))
      ])
      + group(t('How to pay'), [
        row('phone', t('Mobile money'), 'M-Pesa · Mixx by Yas · Airtel Money · HaloPesa'),
        row('card', t('Card'), 'Visa · Mastercard'),
        row('help', t('Refunds'), t('Email info@bang.co.tz within 14 days of paying, and we sort it out or refund you.'))
      ]);
  },
  chat() {
    const s = S.settings;
    return group(t('Agents'), [row('globe', t('Agents answer me in this language'), t('Asked at the start of every session.'), toggle('agentLanguage', s.agentLanguage, t('Agents answer me in this language')))])
      + group(t('Pip’s chat'), [row('chat', t('Who answers Pip’s chat'), t('Through its own program and your own login. Screen questions too.'), seg('buddyAgent', s.buddyAgent, [['claude', 'Claude Code'], ['codex', 'Codex']]))]);
  },
  mascot() {
    const s = S.settings;
    return `<div class="stage">${mascot(s.mascot.hat, true)}<b>${esc(s.mascot.name)}</b></div>`
      + group('', [
        row('pencil', t('Name'), t('What Pip is called on the island.'), `<input type="text" id="m-name" maxlength="20" value="${esc(s.mascot.name)}">`),
        row('palette', t('Colour'), t('The face, the glow and the accents.'), `<div class="swatches">${COLORS.map(c => `<button type="button" data-color="${c}" class="${c === s.mascot.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}<input type="color" id="m-custom" value="${esc(s.mascot.color)}" aria-label="${esc(t('Your own colour'))}"></div>`, 'wide')
      ]);
  },
  wardrobe() {
    return `<div class="hats">${['none', 'cap', 'crown', 'bow'].map(h => `<button type="button" class="hatcard ${h === S.settings.mascot.hat ? 'on' : ''}" data-hat="${h}">${mascot(h, true)}<b>${esc(hatName(h))}</b></button>`).join('')}</div>`;
  },
  general() {
    const s = S.settings;
    return group(t('Language'), [row('globe', t('Language'), t('Pip’s own words. The agents follow it if you allow it.'), seg('lang', s.lang, S.languages.map(l => [l.code, l.name])))])
      + group(t('Start-up and sound'), [
        row('power', S.platform === 'darwin' ? t('Open at login') : t('Start with Windows'), t('Pip is there when you sign in.'), toggle('autostart', S.autostart, t('Start with Windows'))),
        row('bell', t('Chime when an agent finishes'), t('A short sound, and another when an agent needs you.'), toggle('sounds', s.sounds, t('Chime when an agent finishes'))),
        row('refresh', t('Tell me when a new Pip is out'), t('Looks at pip.bang.co.tz at start and every six hours.'), toggle('autoUpdate', s.autoUpdate !== false, t('Tell me when a new Pip is out'))),
        row('keyboard', t('Shortcut'), t('Opens and folds the island from anywhere.'), `<span class="kbd">${s.shortcut.split('+').map(k => `<kbd>${esc(k.replace('Control', 'Ctrl'))}</kbd>`).join('')}</span>`)
      ])
      + group(t('App'), [
        row('star', t('Welcome'), t('The six first steps, again.'), button('show-welcome', t('Show the welcome again'))),
        row('restart', t('Restart Pip'), t('Closes Pip and opens it again.'), button('restart', t('Restart'))),
        row('power', t('Quit Pip'), t('The island goes away until you start Pip again.'), button('quit', t('Quit'))),
        row('trash', t('Reset settings'), t('Everything back to how it came. Connected agents, logins and your note stay.'), button('reset', confirmReset ? t('Sure? Reset') : t('Reset'), 'danger'))
      ]);
  },
  island() {
    const s = S.settings, i = s.island;
    return group(t('Placement'), [
        row('island', t('Where it sits'), t('Joined to the top edge, or floating just below it.'), seg('island.mode', i.mode === 'detach' ? 'detach' : 'attach', [['attach', t('Attach')], ['detach', t('Detach')]])),
        ...(S.displays > 1 ? [row('apps', t('Screen'), t('Which screen the island is on.'), seg('island.display', i.display, Array.from({ length: S.displays }, (_, n) => [n, t('Screen {n}', { n: n + 1 })])))] : [])
      ])
      + group(t('Look'), [
        row('search', t('Island size'), t('Bigger or smaller, text and all.'), slider('i-size', 80, 140, 5, Math.round((i.scale || 1) * 100))),
        row('sun', t('Background transparency'), t('How much of your screen shows through.'), slider('i-alpha', 0, 60, 1, Math.round((1 - (i.opacity ?? 1)) * 100))),
        row('palette', t('Background brightness'), t('The colour glow behind each tab.'), slider('i-bright', 0, 60, 1, Math.round((i.brightness ?? 0.1) * 100))),
        row('home', t('Home layout'), t('What you see first when the island opens.'), seg('homeStyle', s.homeStyle || 'clock', [['clock', t('Clock')], ['dials', t('Dials')], ['colours', t('Colours')], ['apps', t('All apps')]]))
      ])
      + group(t('Behaviour'), [
        row('arrow', t('Open the island'), t('On hover, or only when you click it.'), seg('island.openOn', i.openOn || 'hover', [['hover', t('Hover')], ['click', t('Click')]])),
        row('clock', t('Clock'), t('How the time is written.'), seg('island.clock', i.clock || 'auto', [['auto', t('Auto')], ['12', '12h'], ['24', '24h']])),
        row('wifi', t('Wi-Fi and Bluetooth'), t('Small icons in the strip; a click switches them.'), toggle('island.radios', i.radios !== false, t('Wi-Fi and Bluetooth')))
      ]);
  },
  music() {
    const s = S.settings;
    return group(t('Music'), [
      row('lyrics', t('Lyrics'), t('Show song lyrics (asks lrclib.net for the song)'), toggle('lyrics', s.lyrics, t('Lyrics'))),
      row('info', t('Song details'), t('Release year, album and missing covers (asks iTunes Search for the song)'), toggle('songInfo', s.songInfo, t('Song details'))),
      row('palette', t('Music colour'), t('The music tab glows in the colour of the cover.'), toggle('island.artGlow', s.island.artGlow !== false, t('Music colour')))
    ]);
  },
  places() {
    const s = S.settings;
    return group(t('Weather'), [row('weather', t('Town for the weather'), t('Only the name you type is sent, to Open-Meteo.'), `<input type="text" id="s-place" value="${esc(s.weather.place)}">${button('w-go', t('Check'))}`, 'wide')])
      + `<div class="out" id="w-out"></div>`
      + group(t('Calendar'), [row('calendar', t('Calendar link (private iCal address, https)'), t('Or sign in with Google under Connections.'), `<input type="url" id="s-cal" value="${esc(s.calendarUrl)}">`, 'wide')]);
  },
  apps() {
    const hidden = new Set(S.settings.hiddenTabs || []);
    return `<div class="apps">${tabNames().map(([id, name]) => `<div class="app ${hidden.has(id) ? '' : 'on'}" data-find="${esc(name.toLowerCase())}"><span class="ri">${icon(id)}</span><b>${esc(name)}</b>${toggle('tab.' + id, !hidden.has(id), name)}</div>`).join('')}</div>
      <p class="hint">${esc(t('Home always stays.'))}</p>`;
  },
  guard() {
    const g = S.settings.guard;
    return group(t('Focus guard'), [
        row('shield', t('Pause me before these open'), t('A calm screen asks if you really want to go there.'), toggle('guard.on', g.on, t('Pause me before these open'))),
        row('clock', t('Leave me alone for'), t('After you choose to go on anyway.'), seg('guard.snoozeMin', g.snoozeMin, [[1, '1 min'], [5, '5 min'], [10, '10 min'], [15, '15 min']]))
      ])
      + group(t('Apps and sites'), [`<div class="chips">${g.sites.map((s, n) => `<span class="chip">${esc(SITE_NAMES[s.toLowerCase()] || s)}<button type="button" data-site-x="${n}" aria-label="${esc(t('Remove'))}">✕</button></span>`).join('')}
        <input type="text" id="g-add" placeholder="${esc(t('Add a site or app…'))}"></div>`]);
  },
  support() {
    const link = (ico, title, sub, url) => row(ico, title, sub, `<button type="button" class="btn" data-link="${esc(url)}">${icon('external')}${esc(t('Open'))}</button>`);
    return group(t('Help'), [
        link('globe', t('Website'), 'pip.bang.co.tz', 'https://pip.bang.co.tz'),
        link('help', t('Report a problem'), t('On GitHub, in English or Swahili.'), 'https://github.com/mkumbwajr/Pip/issues'),
        link('shield', t('Privacy'), t('What leaves your PC, and when.'), 'https://pip.bang.co.tz/privacy'),
        link('heart', t('Source code'), t('Free and open source (MIT).'), 'https://github.com/mkumbwajr/Pip')
      ])
      + `<div class="about">${mascot(S.settings.mascot.hat, true)}<b>Pip ${esc(S.version)}</b><span>© ${new Date().getFullYear()} BANG DIGITAL LTD</span><span>${esc(t('MIT licence. Free for 7 days, then a one-time license. No telemetry.'))}</span></div>`;
  }
};

// ---------- drawing ----------
function draw() {
  const s = S.settings, list = sections(), now = list.find(x => x[0] === current) || list[0];
  document.title = t('Pip settings'); $('#brand-sub').textContent = t('Settings');
  let grp = '';
  $('#nav').innerHTML = list.map(([id, g, ico, name, , col]) => `${g !== grp ? `<h3>${esc(grp = g)}</h3>` : ''}<button type="button" data-go="${id}" data-col="${col}" class="${id === now[0] && !query ? 'on' : ''}"><span class="ni">${icon(ico)}</span>${esc(name)}</button>`).join('');
  for (const b of document.querySelectorAll('#nav [data-col]')) b.style.setProperty('--c', b.dataset.col);
  $('#foot-ver').textContent = `Pip ${S.version}`; $('#foot-copy').textContent = `© ${new Date().getFullYear()} BANG DIGITAL LTD`;
  document.documentElement.style.setProperty('--pip', s.mascot.color);
  if (query) { // every section, then only the rows that match
    $('#title').textContent = t('Search'); $('#subtitle').textContent = t('Settings that match “{q}”', { q: query }); $('#hero-ico').innerHTML = icon('search');
    document.documentElement.style.setProperty('--band', '#6f6f7c');
    page.innerHTML = list.map(([id, , , name]) => `<div class="found" data-sec="${id}"><h4>${esc(name)}</h4>${views[id]()}</div>`).join('') + `<p class="none" hidden>${esc(t('No setting matches.'))}</p>`;
    const q = query.toLowerCase(); let any = false;
    for (const r of page.querySelectorAll('[data-find]')) r.hidden = !r.dataset.find.includes(q);
    for (const g of page.querySelectorAll('.grp, .apps')) g.hidden = !g.querySelector('[data-find]:not([hidden])');
    for (const f of page.querySelectorAll('.found')) { const show = Boolean(f.querySelector('[data-find]:not([hidden])')); f.hidden = !show; any ||= show; for (const x of f.querySelectorAll('.stats, .stage, .hats, .about, .hint, .err, .out')) x.hidden = true; }
    page.querySelector('.none').hidden = any;
  } else {
    $('#title').textContent = now[3]; $('#subtitle').textContent = now[4]; $('#hero-ico').innerHTML = icon(now[2]);
    document.documentElement.style.setProperty('--band', now[5]);
    page.innerHTML = `<div class="view">${views[now[0]]()}</div>`;
  }
  for (const el of page.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  for (const el of page.querySelectorAll('input[type=range]')) fill(el);
  drawPreview();
}
/** The slider's track is coloured up to the thumb. */
function fill(el) { el.style.setProperty('--fill', (100 * (el.value - el.min) / (el.max - el.min)) + '%'); }
/** The copy of the folded island in the header: Pip's eyes, what it would say, the clock. */
function drawPreview() {
  const s = S.settings, top = (S.ai.sessions || [])[0];
  const p = $('#preview'); p.className = (s.island.mode === 'detach' ? 'detach ' : '') + (top?.state || '');
  $('#pv-text').textContent = top ? ({ working: t('Working'), asking: t('Needs you'), done: t('Done'), error: t('Error') }[top.state] || '') : '';
  tick();
}
function tick() {
  const c = S.settings.island.clock;
  $('#pv-clock').textContent = new Date().toLocaleTimeString(S.settings.lang === 'sw' ? 'sw-TZ' : undefined, { hour: 'numeric', minute: '2-digit', ...(c === '12' ? { hour12: true } : c === '24' ? { hour12: false } : {}) });
}
async function save(patch) { S.settings = await api.setSettings(patch); }
/** 'island.mode' + 'detach' → { island: { mode: 'detach' } } */
const at = (key, value) => key.split('.').reduceRight((v, k) => ({ [k]: v }), value);
/** Looks the town up right away and says what was found, so a typo is visible here and not as an empty card. */
async function checkWeather() {
  const out = $('#w-out'); out.textContent = '…'; out.className = 'out';
  await save({ weather: { place: $('#s-place').value.trim() } });
  const w = await api.weather();
  out.textContent = !S.settings.weather.place ? '' : w?.error ? t('Could not get the weather: {error}', { error: w.error }) : w ? `${w.place}: ${w.temp}${w.unit}` : t('That town was not found.');
  if (w?.error || !w) out.className = 'out bad';
}
function showError(id, text) { const el = $('#' + id); if (el) el.textContent = text || ''; }

// ---------- events ----------
page.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.toggle) {
    const on = !b.classList.contains('on');
    if (d.toggle === 'autostart') S.autostart = await api.setAutostart(on);
    else if (d.toggle.startsWith('tab.')) {
      const hidden = new Set(S.settings.hiddenTabs || []), id = d.toggle.slice(4); on ? hidden.delete(id) : hidden.add(id); await save({ hiddenTabs: [...hidden] });
    } else await save(at(d.toggle, on));
    return draw();
  }
  const sg = b.closest('[data-seg]');
  if (sg) {
    const key = sg.dataset.seg, raw = d.v, v = key === 'island.display' || key === 'guard.snoozeMin' ? Number(raw) : raw;
    await save(at(key, v)); if (key === 'lang') return location.reload(); return draw();
  }
  if (d.agent) {
    const r = await api.connectAgent(d.agent, !S.agents[d.agent]); S.agents = r.agents || S.agents; draw();
    if (!r.ok) showError('ag-error', t('Could not change that: {error}', { error: r.error })); return;
  }
  if (d.color) { await save({ mascot: { color: d.color } }); return draw(); }
  if (d.hat) { await save({ mascot: { hat: d.hat } }); return draw(); }
  if (d.link) return api.openLink(d.link);
  if (d.siteX !== undefined) { const sites = S.settings.guard.sites.filter((_, n) => n !== +d.siteX); await save({ guard: { sites } }); return draw(); }
  switch (b.id) {
    case 'acct-in': case 'acct-sync': {
      accountBusy = true; draw();
      const r = b.id === 'acct-in' ? await api.accountSignIn() : await api.accountSync(); accountBusy = false;
      if (r.ok) { S.account = r; const init = await api.init(); S.settings = init.settings; if (init.settings.lang !== document.documentElement.lang) return location.reload(); }
      draw(); if (!r.ok) showError('acct-error', r.error); return;
    }
    case 'mail-send': {
      mail.address = $('#mail-addr').value.trim(); mail.busy = true; draw();
      const r = await api.accountEmailCode(mail.address); mail.busy = false; if (r.ok) mail.stage = 'code';
      draw(); if (!r.ok) showError('acct-error', r.error); else $('#mail-code')?.focus(); return;
    }
    case 'mail-verify': {
      const code = $('#mail-code').value; mail.busy = true; draw();
      const r = await api.accountEmailVerify(mail.address, code); mail.busy = false;
      if (r.ok) { mail.stage = 'enter'; S.account = r; const init = await api.init(); S.settings = init.settings; if (init.settings.lang !== document.documentElement.lang) return location.reload(); }
      draw(); if (!r.ok) showError('acct-error', r.error); return;
    }
    case 'mail-back': mail.stage = 'enter'; return draw();
    case 'acct-out': S.account = await api.accountSignOut(); return draw();
    case 'lic-buy': return api.buy();
    case 'lic-check': S.license = await api.licenseCheck(); return draw();
    case 'lic-signin': current = 'connections'; return draw();
    case 'acct-del': {
      if (!confirmDelete) { confirmDelete = true; draw(); setTimeout(() => { confirmDelete = false; if (current === 'connections') draw(); }, 4000); return; }
      confirmDelete = false; const r = await api.accountDelete(); if (r.ok) S.account = r; draw(); if (!r.ok) showError('acct-error', r.error); return;
    }
    case 'w-go': return checkWeather();
    case 'show-welcome': return api.openWelcome();
    case 'restart': return api.restart();
    case 'quit': return api.quit();
    case 'reset':
      if (!confirmReset) { confirmReset = true; draw(); setTimeout(() => { confirmReset = false; if (current === 'general') draw(); }, 4000); return; }
      confirmReset = false; S.settings = await api.resetSettings(); return location.reload();
    case 'go-go': {
      if (S.google) { await api.googleLogout(); S.google = false; return draw(); }
      if ($('#go-id')) await save({ google: { clientId: $('#go-id').value.trim(), secret: $('#go-secret').value.trim() } });
      showError('acc-error', t('Finish the login in your browser…'));
      const r = await api.googleLogin(); S.google = r.ok; draw(); if (!r.ok) showError('acc-error', r.error); return;
    }
    case 'sp-go': {
      if (S.spotify) { await api.spotifyLogout(); S.spotify = false; return draw(); }
      await save({ spotifyClientId: $('#sp-id').value.trim() }); showError('acc-error', t('Finish the login in your browser…'));
      const r = await api.spotifyLogin(); S.spotify = r.ok; draw(); if (!r.ok) showError('acc-error', r.error);
    }
  }
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (!b) return; current = b.dataset.go; query = ''; $('#q').value = ''; draw(); page.scrollTop = 0; });
$('#q').addEventListener('input', e => { query = e.target.value.trim(); draw(); });
page.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 's-place') { e.preventDefault(); checkWeather(); }
  if (e.target.id === 'g-add') {
    const v = e.target.value.trim(); if (!v) return; e.preventDefault();
    await save({ guard: { sites: [...S.settings.guard.sites, v].slice(0, 40) } }); draw(); $('#g-add')?.focus();
  }
});
page.addEventListener('input', e => {
  const el = e.target; if (el.type !== 'range') return; fill(el);
  $('#' + el.id + '-n').textContent = el.value + '%';
  // live while dragging: the island follows the slider
  if (el.id === 'i-size') save({ island: { scale: el.value / 100 } });
  else if (el.id === 'i-alpha') save({ island: { opacity: 1 - el.value / 100 } });
  else if (el.id === 'i-bright') save({ island: { brightness: el.value / 100 } });
});
page.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'm-name') { await save({ mascot: { name: el.value.trim() || 'Pip' } }); draw(); }
  else if (el.id === 'm-custom') { await save({ mascot: { color: el.value } }); draw(); }
  else if (el.id === 's-place') checkWeather();
  else if (el.id === 's-cal') save({ calendarUrl: el.value.trim() });
});

// settings changed somewhere else (the island, or another device through the Pip account): show them, unless you are
// typing here right now
api.onChanged(async () => {
  const init = await api.init(), lang = S.settings.lang;
  Object.assign(S, { settings: init.settings, agents: init.agents, account: init.account, google: init.google, spotify: init.spotify, license: init.license });
  if (init.settings.lang !== lang) return location.reload();
  const a = document.activeElement; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'range') return;
  draw();
});

(async () => {
  S = await api.init(); S.hubError = await api.hubError(); t = window.makeT(S.strings, { mac: S.platform === 'darwin' }); document.documentElement.lang = S.settings.lang;
  if (sections().some(x => x[0] === location.hash.slice(1))) current = location.hash.slice(1); // opened on a section (the island's "sign in first")
  $('#q').placeholder = t('Search settings'); $('#search-ico').innerHTML = icon('search');
  draw(); setInterval(tick, 5000);
})();

api.onSettingsGo(section => { if (sections().some(x => x[0] === section)) { current = section; query = ''; $('#q').value = ''; draw(); } });
