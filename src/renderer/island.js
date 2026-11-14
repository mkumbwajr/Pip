'use strict';
// The island: one page, drawn from the state the main process sends. No framework: small render functions per tab.
// Every text the user sees goes through t(): English here, translated by src/locales/<language>.json.
const api = window.peep;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const island = $('#island'), shell = $('#shell'), pill = $('#pill'), page = $('#page'), tabs = $('#tabs'), pip = $('#pip'), bar = $('#bar'), tip = $('#tip'), menu = $('#menu'), volPop = $('#vol-pop');
let t = window.makeT({});

const LIVE = new Set(['home', 'ai', 'music', 'tray', 'clips', 'calendar']); // redrawn when data changes; the others hold what you are typing
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#e8e8ee'];
const AGENT = { claude: 'Claude Code', codex: 'Codex' };
// Lists of words are built by functions so they follow the chosen language.
const tabList = () => [['home', t('Home')], ['ai', t('Agents')], ['ask', t('Ask')], ['music', t('Music')], ['focus', t('Focus')], ['modes', t('Modes')], ['tray', t('Files')], ['note', t('Note')], ['clips', t('Copied')], ['calendar', t('Calendar')]];
const MODES = () => [['work', t('Work')], ['study', t('Study')], ['sleep', t('Sleep')], ['game', t('Game')]];
const SITE_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', reddit: 'Reddit', 'x.com': 'X', facebook: 'Facebook', netflix: 'Netflix' };
const stateName = s => ({ idle: t('Idle'), working: t('Working'), asking: t('Needs you'), done: t('Done'), error: t('Error') }[s] || s);
const verb = v => ({ Reading: t('Reading'), Writing: t('Writing'), Editing: t('Editing'), Running: t('Running'), Searching: t('Searching'), Fetching: t('Fetching'),
  'Searching the web': t('Searching the web'), Delegating: t('Delegating'), Using: t('Using'), Thinking: t('Thinking'), Failed: t('Failed'), 'Needs you': t('Needs you') }[v] || v);
const weatherName = c => (c === 0 ? t('Clear') : c <= 3 ? t('Cloudy') : c <= 48 ? t('Fog') : c <= 67 ? t('Rain') : c <= 77 ? t('Snow') : c <= 82 ? t('Showers') : t('Storm'));

const S = { open: false, tab: 'home', settings: null, ai: { sessions: [], top: 'idle', history: [], usage: null }, agents: {}, win: { media: null, volume: null, net: null }, tray: [], clips: [],
  weather: null, event: null, stats: null, lyrics: null, lyricsFor: '', share: null, focus: { left: 25 * 60, running: false, total: 25 * 60 },
  ask: { busy: false, text: '', error: '', windows: [], pick: '' }, spotify: { on: false, devices: [], error: '' },
  platform: '', hubError: '', dragging: false, art: null, pinned: false, hover: false, auto: false,
  mode: null, modePick: '', menu: false, vol: false, calLoaded: false, years: {} };

// ---------- small helpers ----------
const locale = () => (S.settings?.lang === 'sw' ? 'sw-TZ' : undefined);
const clock = (d = new Date()) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
const dateLabel = (d = new Date()) => [d.toLocaleDateString(locale(), { weekday: 'short' }), d.getDate(), d.toLocaleDateString(locale(), { month: 'short' })].join(' ').replace(/[.,]/g, '');
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const age = at => { const m = Math.floor((Date.now() - at) / 60000); return m < 1 ? t('just now') : m < 60 ? t('{n} min', { n: m }) : t('{n} h', { n: Math.floor(m / 60) }); };
const time = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ago = at => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : t('{n} h ago', { n: Math.round(m / 60) }); };
const size = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const typing = () => { const a = document.activeElement; return page.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range'; };
function chime(ok) {
  if (!S.settings?.sounds) return;
  try {
    const ctx = new AudioContext(), notes = ok ? [660, 880] : [330, 247];
    notes.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const at = ctx.currentTime + i * 0.14; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.12, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3); o.start(at); o.stop(at + 0.32); });
    setTimeout(() => ctx.close(), 900);
  } catch {}
}
/** Song and artist as people read them: some players send "Artist - Title" as the title with no artist. */
function songOf(m) { const x = !m.artist && String(m.title).match(/^(.+?)\s+[-–]\s+(.+)$/); return x ? { title: x[2], artist: x[1] } : { title: m.title, artist: m.artist }; }
const APPS = { spotify: 'Spotify', zunemusic: 'Media Player', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', vlc: 'VLC' };
const appName = id => { const s = String(id).toLowerCase(), k = Object.keys(APPS).find(k => s.includes(k)); return k ? APPS[k] : String(id).split(/[!\\]/).pop().replace(/\.exe$/i, ''); };
function mediaPosition() { const m = S.win.media; if (!m) return 0; return Math.min(m.durationMs || Infinity, m.positionMs + (m.playing ? Date.now() - S.win.at : 0)); }

// ---------- the pill ----------
function drawPill() {
  const top = S.ai.sessions[0], m = S.win.media;
  island.className = [S.ai.top, S.settings?.island.mode === 'detach' ? 'detach' : 'attach', S.open ? 'open' : '', S.pinned ? 'pinned' : ''].join(' ');
  const mood = S.ai.top !== 'idle' ? S.ai.top : (m?.playing ? 'music' : 'idle');
  pip.className = 'pip ' + mood + (S.settings?.mascot.hat !== 'none' ? ' hat-' + S.settings?.mascot.hat : '');
  // idle: only Pip and the clock. In use: what is happening. Open: the mascot's name as a title.
  let text = S.open ? (S.settings?.mascot.name || 'Peep') : '', side = clock();
  if (top && top.state === 'asking') text = t('{agent} needs you', { agent: AGENT[top.agent] });
  else if (top && top.state === 'working') text = top.activity ? `${verb(top.activity.verb)} ${top.activity.detail}`.trim() : t('Working');
  else if (top && top.state === 'done') text = t('{agent} is done', { agent: AGENT[top.agent] });
  else if (top && top.state === 'error') text = t('{agent} hit an error', { agent: AGENT[top.agent] });
  else if (S.focus.running) { text = t('Focus'); side = time(S.focus.left * 1000); }
  else if (m?.playing) text = m.artist ? `${m.title} · ${m.artist}` : m.title;
  if (top?.state === 'working' && top.startedAt) side = time(Date.now() - top.startedAt);
  $('#pill-text').textContent = text; $('#pill-side').textContent = S.open ? clock() : side;
  if (S.open) {
    $('#pill-date').textContent = dateLabel();
    const u = S.ai.usage?.fiveHour; // the five-hour window is the one that runs out during a working day
    $('#pill-chip').textContent = u ? `${u.pct}%${u.resetsAt > Date.now() ? ' · ' + hms(u.resetsAt - Date.now()) : ''}` : '';
    const w = S.ai.usage?.sevenDay; // both windows on hover; the chip itself shows the one that runs out first
    $('#pill-chip').title = u ? `${t('Claude usage')}: ${t('5 hours')} ${u.pct}%${w ? ` · ${t('Week')} ${w.pct}%` : ''}` : '';
  }
  island.dataset.tab = S.tab; document.documentElement.style.setProperty('--alpha', S.settings?.island.opacity ?? 1);
  island.classList.toggle('bare', !S.open && !text && S.settings?.island.mode !== 'detach'); // attached and idle: only Pip in the notch
  // the shell's width is set in pixels so the change between sizes can be animated
  shell.style.width = S.open ? '' : Math.max(84, Math.min(440, Math.ceil($('#pill-inner').getBoundingClientRect().width) + 2)) + 'px';
  const dot = tabs.querySelector('[data-tab=ai]'); if (dot) dot.classList.toggle('dot', S.ai.top === 'asking');
}

// ---------- pages ----------
const pages = {
  home() {
    const top = S.ai.sessions[0], m = S.win.media, f = S.focus, connected = S.agents.claude || S.agents.codex;
    const art = m && S.art?.key === m.title + '|' + m.artist ? S.art.data : '';
    const w = S.weather, e = S.event;
    const agent = top
      ? `<span class="dotst ${top.state}"></span><div class="grow"><span class="label">${esc(AGENT[top.agent])} · ${esc(stateName(top.state))}</span><div class="sub">${esc(top.activity ? `${verb(top.activity.verb)} ${top.activity.detail}` : top.project)}</div></div>${top.state === 'asking' ? `<button class="wbtn sm" data-tab-go="ai">${esc(t('Open'))}</button>` : ''}`
      : connected ? `<span class="dotst"></span><div class="grow"><span class="label">${esc(t('Agents'))}</span><div class="sub">${esc(t('No agent session yet.'))}</div></div>`
        : `<div class="grow"><span class="label">${esc(t('Agents'))}</span><div class="sub" title="${esc(t('Connect Claude Code or Codex to see what they are doing.'))}">${esc(t('Not connected'))}</div></div><button class="wbtn sm" data-connect>${esc(t('Connect'))}</button>`;
    return `<div class="hm"><div class="hm-left"><div class="hm-clock" id="hm-clock"></div>
        <div class="hm-sub">${w ? `${w.temp}${esc(w.unit)} · ${esc(weatherName(w.code))} · ${esc(w.place)}` : esc(t('Add your town in Settings for the weather.'))}</div>
        ${S.hubError ? `<div class="hm-err">${esc(S.hubError)}</div>` : ''}
        <div class="hm-next"><span class="label">${esc(t('Next'))}</span>${e ? `<b class="cut">${esc(e.title)}</b><span>${esc(new Date(e.start).toLocaleString(locale(), e.allDay ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</span>` : `<b>${esc(/^https:\/\//.test(S.settings.calendarUrl || '') ? t('Nothing planned') : t('No calendar linked.'))}</b>`}</div></div>
      <div class="hm-tiles"><div class="tile">${agent}</div>
        <div class="tile">${art ? `<img class="tile-art" alt="" src="data:image/jpeg;base64,${esc(art)}">` : `<span class="tile-art">${icon('music')}</span>`}<div class="grow"><b>${esc(m ? songOf(m).title : t('Nothing is playing.'))}</b>${m && songOf(m).artist ? `<div class="sub">${esc(songOf(m).artist)}</div>` : ''}</div>
          ${m ? `<button class="round" data-media="toggle" aria-label="${esc(t('Play or pause'))}">${m.playing ? '❚❚' : '▶'}</button>` : ''}</div>
        <div class="tile"><span class="tile-art">${icon('focus')}</span><div class="grow"><span class="label">${esc(t('Focus'))}</span><b class="num" id="hm-focus">${time(f.left * 1000)}</b></div><button class="wbtn sm" data-focus="toggle">${esc(f.running ? t('Pause') : t('Start'))}</button></div></div></div>`;
  },
  ai() {
    const cards = S.ai.sessions.map(s => `<div class="card">
        <div class="row"><span class="badge ${s.state}">${esc(stateName(s.state))}</span><b>${esc(AGENT[s.agent])}</b><span class="dim cut grow">${esc(s.project)}</span><span class="dim small">${esc(ago(s.updatedAt))}</span></div>
        ${s.prompt ? `<div class="cut dim small">“${esc(s.prompt)}”</div>` : ''}
        ${s.ask ? `<div class="row"><div class="grow"><div>${s.ask.kind === 'permission' ? esc(t('Wants to:')) + ' ' : ''}<b>${esc(verb(s.ask.verb))}</b></div><div class="mono cut">${esc(s.ask.detail)}</div></div>
          ${s.ask.canAnswer ? `<button class="btn primary" data-decide="allow" data-id="${esc(s.id)}">${esc(t('Allow'))}</button><button class="btn danger" data-decide="deny" data-id="${esc(s.id)}">${esc(t('Deny'))}</button>` : `<span class="dim small">${esc(t('Answer in the terminal'))}</span>`}</div>` : ''}
        ${s.state === 'working' ? `<ul class="feed">${s.feed.slice(-5).map(f => `<li class="cut mono${f.bad ? ' bad' : ''}">${esc(verb(f.verb))} ${esc(f.detail)}</li>`).join('')}</ul>` : ''}
        ${s.state !== 'working' && s.reply ? `<div class="said">${esc(s.reply)}</div>` : ''}
        ${s.canReply ? `<div class="row"><input type="text" class="grow" data-reply-for="${esc(s.id)}" placeholder="${esc(t('Answer {agent} from here…', { agent: AGENT[s.agent] }))}"><button class="btn primary" data-reply="${esc(s.id)}">${esc(t('Send'))}</button></div>` : ''}</div>`).join('');
    const history = S.ai.history.map(h => `<div class="item"><span class="badge ${h.state}">${esc(stateName(h.state))}</span><div class="grow"><div class="cut">${esc(h.prompt)}</div>
        <div class="dim small cut">${esc(AGENT[h.agent])} · ${esc(h.project)} · ${time(h.tookMs)}${h.edits.length ? ' · ' + esc(t('changed {files}', { files: h.edits.join(', ') })) : ''}</div></div><span class="dim small">${esc(ago(h.at))}</span></div>`).join('');
    return `<h2>${esc(t('Sessions'))}</h2>${cards || `<div class="card dim">${esc(t('Nothing running. Start Claude Code or Codex in a terminal.'))}</div>`}<h2>${esc(t('History'))}</h2>${history || `<div class="dim">${esc(t('Finished jobs appear here.'))}</div>`}`;
  },
  music() {
    const m = S.win.media, sp = S.spotify, on = S.settings.lyrics;
    if (S.platform !== 'win32') return `<div class="cl-empty">${esc(t('Music controls need Windows.'))}</div>`;
    if (!m) return `<div class="mu"><span class="mu-art">${icon('music')}</span><div class="mu-info"><span class="label">${esc(t('Playing'))}</span><h3>${esc(t('Nothing is playing.'))}</h3></div></div>`;
    const song = songOf(m), art = S.art?.key === m.title + '|' + m.artist ? S.art.data : '', year = S.years[song.title + '|' + song.artist];
    const meta = [m.album || year?.album, year?.year].filter(Boolean).join(' · '); // the player's album first; iTunes fills a missing one
    return `<div class="mu">${art ? `<img class="mu-art" alt="" src="data:image/jpeg;base64,${esc(art)}">` : `<span class="mu-art">${icon('music')}</span>`}
      <div class="mu-info"><span class="label">${esc(t('Playing'))}${m.app ? ' · ' + esc(appName(m.app)) : ''}</span>
        <div class="mu-head"><div class="grow"><h3 class="cut" title="${esc(song.title)}">${esc(song.title)}</h3><div class="mu-artist cut">${esc(song.artist || '')}</div></div>
          <div class="mu-ctl"><button class="mu-btn" data-media="prev" aria-label="${esc(t('Previous'))}">${icon('prev')}</button>
            <button class="mu-btn play" data-media="toggle" aria-label="${esc(t('Play or pause'))}">${icon(m.playing ? 'pause' : 'play')}</button>
            <button class="mu-btn" data-media="next" aria-label="${esc(t('Next'))}">${icon('next')}</button></div></div>
        <div class="mu-meta cut">${esc(meta)}</div>
        ${on ? '<div class="mu-lyric cut" id="ly-now"></div>' : ''}
        <input type="range" id="seek" min="0" max="${m.durationMs || 0}" value="0" ${m.canSeek && m.durationMs ? '' : 'disabled'} aria-label="${esc(t('Position'))}">
        <div class="mu-times"><span id="pos"></span><span>${m.durationMs ? time(m.durationMs) : ''}</span></div>
        <div class="mu-foot">${sp.on && sp.devices.length ? `<select id="device" aria-label="${esc(t('Play on'))}">${sp.devices.map(d => `<option value="${esc(d.id)}" ${d.active ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`
            : sp.on ? `<select id="device" disabled title="${esc(sp.error || t('Open Spotify on a device to see it here.'))}"><option>${esc(t('Play on'))}</option></select>` : ''}
          <button class="mu-chip ${on ? 'on' : ''}" data-lyrics>${icon('lyrics')}${esc(t('Lyrics'))}</button></div></div></div>`;
  },
  tray() {
    const sh = S.share;
    if (sh?.on) return `<div class="tr"><img class="tr-qr" alt="QR" src="${esc(sh.qr)}"><div class="tr-side"><p>${esc(t('Scan with your phone on the same Wi-Fi.'))}<br><span class="mono">${esc(sh.url)}</span><br>${esc(t('Stops by itself after an hour.'))}</p>
      <button class="wbtn wide" data-share="stop">${esc(t('Stop sharing'))}</button></div></div>`;
    const left = S.tray.length
      ? `<div class="tr-files" id="drop">${S.tray.map(f => `<div class="tr-file item" draggable="true" data-drag="${esc(f.path)}" data-open="${esc(f.path)}"><span class="grow cut">${esc(f.name)}</span><span class="dim">${size(f.size)}</span><button class="x" data-remove="${esc(f.path)}" aria-label="${esc(t('Remove'))}">✕</button></div>`).join('')}</div>`
      : `<div class="tr-drop" id="drop">${esc(t('Drop here'))}</div>`;
    return `<div class="tr">${left}<div class="tr-side"><h3>${esc(t('Drop files here'))}</h3><p>${esc(t('They wait here until you drag them out. Click to open.'))}</p>
      ${sh?.error ? `<p data-kind="error">${esc(sh.error)}</p>` : ''}<button class="wbtn wide" data-share="start">${icon('phone')}${esc(t('Get from your phone'))}</button></div></div>`;
  },
  clips() {
    if (!S.clips.length) return `<div class="cl-empty">${esc(t('Text you copy shows up here. It is kept in memory only.'))}</div>`;
    return S.clips.map((c, i) => `<button class="cl-row" data-clip="${i}"><span class="label">${esc(/^https?:\/\/\S+$/.test(c.text.trim()) ? t('Link') : t('Text'))}</span>
      <span class="cl-text">${esc(c.text.replace(/\s+/g, ' ').slice(0, 200))}</span><span class="label cl-age">${esc(age(c.at))}</span></button>`).join('')
      + `<button class="cl-clear" data-clips-clear>${esc(t('Clear history'))}</button>`;
  },
  note() {
    return `<div class="nt"><div class="nt-main"><div class="label">${esc(t('Note'))}</div><textarea id="note" placeholder="${esc(t('Click to type'))}">${esc(S.settings.note)}</textarea></div><div class="nt-side" id="note-side">${noteSide()}</div></div>`;
  },
  focus() {
    const f = S.focus, ticks = [];
    for (let m = 0; m <= 60; m++) ticks.push(`<i class="${m % 10 ? '' : 'major'}" data-left="${(m / 60) * 100}"></i>${m % 10 ? '' : `<span data-left="${(m / 60) * 100}">${m}</span>`}`);
    return `<div class="fz"><div class="fz-time" id="focus-left">${time(f.left * 1000)}</div><div class="fz-done" id="focus-done"></div>
      <button class="wbtn" data-focus="toggle">${esc(f.running ? t('Pause') : t('Start'))}</button>
      <div class="ruler${f.running ? ' busy' : ''}" id="ruler">${ticks.join('')}<i class="mark" id="ruler-mark"></i></div></div>`;
  },
  modes() {
    const pick = S.modePick || S.mode?.id || 'work', m = S.settings.modes[pick], live = S.mode?.id === pick;
    const sites = S.settings.guard.sites.slice(0, 3).map(s => SITE_NAMES[String(s).toLowerCase()] || String(s).replace(/^./, c => c.toUpperCase())).join(', ');
    const agent = S.agents.claude || !S.agents.codex ? 'Claude' : 'Codex';
    const row = (key, ico, text) => `<div class="md-row">${icon(ico)}<span>${esc(text)}</span><button class="sw ${m[key] ? 'on' : ''}" data-mswitch="${key}" aria-label="${esc(text)}"></button></div>`;
    return `<div class="md"><div class="md-list">${MODES().map(([id, name]) => `<button class="${id === pick ? 'on' : ''}" data-mode-pick="${id}">${icon(id)}${esc(name)}</button>`).join('')}</div>
      <div><div class="md-head"><span class="md-time" id="${live ? 'mode-left' : ''}" title="${esc(t('Scroll to change the time'))}">${time((live ? S.focus.left : m.min * 60) * 1000)}</span>
        <button class="wbtn sm" data-mode-go="${pick}">${esc(live ? t('Stop') : t('Start'))}</button></div>
        ${row('block', 'shield', t('Block {sites}', { sites }))}${row('only', 'bell', t('Only {agent} can reach you', { agent }))}${row('music', 'music', t('Keep my music on'))}</div></div>`;
  },
  calendar() {
    const now = new Date(), e = S.event, linked = /^https:\/\//.test(S.settings.calendarUrl || '');
    const when = e && new Date(e.start).toLocaleString(locale(), e.allDay ? { weekday: 'long', day: 'numeric', month: 'short' } : { weekday: 'long', hour: 'numeric', minute: '2-digit' });
    return `<div class="cal"><div class="cal-day"><div class="label">${esc(now.toLocaleDateString(locale(), { weekday: 'long' }))}</div><div class="cal-big">${now.getDate()}</div>
      <div class="cal-month">${esc(now.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }))}</div></div>
      <div class="cal-next"><div class="label">${esc(t('Next'))}</div>${!linked ? `<h3>${esc(t('No calendar linked.'))}</h3><div><button class="wbtn sm" data-settings>${esc(t('Settings'))}</button></div>`
        : e ? `<h3 class="cut">${esc(e.title)}</h3><p>${esc(when)}</p>` : `<h3>${esc(S.calLoaded ? t('Nothing planned') : '')}</h3>`}</div></div>`;
  },
  ask() {
    const a = S.ask;
    return `<h2>${esc(t('Ask about your screen'))}</h2><div class="dim small">${esc(t('{name} takes one screenshot and asks {agent} through your own login.', { name: S.settings.mascot.name, agent: AGENT[S.settings.buddyAgent] }))}</div>
      <div class="shots"><button class="shot ${a.pick ? '' : 'on'}" data-pick=""><span>${esc(t('Whole screen'))}</span></button>${a.windows.map(w => `<button class="shot ${a.pick === w.id ? 'on' : ''}" data-pick="${esc(w.id)}"><img alt="" src="${esc(w.thumb)}"><span class="cut">${esc(w.name)}</span></button>`).join('')}</div>
      <textarea id="question" rows="2" placeholder="${esc(t('What does this error mean?'))}"></textarea><br><br><button class="btn primary" id="ask-go" ${a.busy ? 'disabled' : ''}>${esc(a.busy ? t('Looking…') : t('Ask'))}</button>
      ${a.error ? `<div class="card" data-kind="error">${esc(a.error)}</div>` : ''}${a.text ? `<div class="card answer">${esc(a.text)}</div>` : ''}`;
  }
};

const FILL = new Set(['home', 'music', 'focus', 'modes', 'tray', 'note', 'calendar']); // pages laid out to the panel's full size, without scrolling
function draw(force) {
  drawPill();
  if (!S.open || S.dragging || (!force && (!LIVE.has(S.tab) || typing()))) return;
  page.classList.toggle('fill', FILL.has(S.tab));
  page.innerHTML = pages[S.tab]();
  for (const el of page.querySelectorAll('[data-w]')) el.style.width = el.dataset.w + '%';
  for (const el of page.querySelectorAll('[data-left]')) el.style.left = el.dataset.left + '%';
  for (const el of page.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  for (const el of page.querySelectorAll('[data-center]')) { el.style.justifyContent = 'center'; el.style.textAlign = 'center'; el.style.margin = '10px 0'; }
  for (const el of page.querySelectorAll('[data-kind=error]')) el.style.color = 'var(--error)';
  for (const el of page.querySelectorAll('[data-flat]')) el.style.margin = '0';
  if (S.tab === 'note') drawNoteSide();
  tick();
}
function drawTabs() {
  tabs.innerHTML = tabList().map(([id, name]) => `<button type="button" data-tab="${id}" data-tip="${esc(name)}" aria-label="${esc(name)}" class="${id === S.tab ? 'on' : ''}">${icon(id)}<b>${esc(name)}</b></button>`).join('');
  const gear = $('#bar-settings'), vol = $('#bar-vol');
  gear.innerHTML = icon('gear'); gear.dataset.tip = t('Settings'); gear.setAttribute('aria-label', t('Settings'));
  vol.innerHTML = icon('volume'); vol.dataset.tip = t('Volume'); vol.setAttribute('aria-label', t('Volume'));
  $('#vol-ico').innerHTML = icon('volume'); $('#pill-more').innerHTML = icon('dots'); $('#pill-more').setAttribute('aria-label', t('Menu'));
  drawPill();
}
function go(tab) {
  S.tab = tab; showMenu(false); drawTabs(); draw(true); hideTip();
  page.classList.remove('in'); void page.offsetWidth; page.classList.add('in'); // replay the short entrance of the page
  if (tab === 'home') refreshHome();
  if (tab === 'calendar') api.calendar().then(e => { S.event = e; S.calLoaded = true; draw(); });
  if (tab === 'ask') api.windows().then(list => { S.ask.windows = list || []; if (S.tab === 'ask' && !typing()) draw(true); });
  if (tab === 'music' && S.spotify.on) refreshDevices();
}
/** Opens the preview or folds back to the pill. The page is drawn before opening and left in place while closing,
    so the morph never shows an empty panel. */
function setOpen(open) {
  if (open === S.open) return;
  S.open = open;
  if (open) go(S.tab);
  else { S.pinned = false; S.auto = false; showMenu(false); showVolume(false); hideTip(); if (document.hasFocus()) { document.activeElement?.blur?.(); api.focus(false); } drawPill(); }
}
function openSettings() { api.openSettings(); setOpen(false); }

// ---------- the menu behind the dots, the volume pop-up and the tooltips over the bar ----------
function showMenu(on) {
  S.menu = on; menu.hidden = !on;
  if (on) menu.innerHTML = `<button data-menu="settings">${icon('gear')}${esc(t('Settings'))}</button>
    <button data-menu="pin">${icon('tray')}${esc(S.pinned ? t('Fold') : t('Keep open'))}</button><hr><button class="quit" data-menu="quit">${esc(t('Quit Peep'))}</button>`;
}
function showVolume(on) {
  const v = S.win.volume; S.vol = on && Boolean(v); volPop.hidden = !S.vol; $('#bar-vol').classList.toggle('on', S.vol);
  if (S.vol) { $('#qvol').value = v.level; $('#qvol-n').textContent = v.level; }
}
function hideTip() { tip.classList.remove('show'); }
bar.addEventListener('mouseover', e => {
  const b = e.target.closest('[data-tip]');
  if (!b || b.classList.contains('on')) return hideTip();
  const r = b.getBoundingClientRect(), base = bar.getBoundingClientRect();
  tip.textContent = b.dataset.tip; tip.style.left = (r.left + r.width / 2 - base.left) + 'px'; tip.classList.add('show');
});
bar.addEventListener('mouseleave', hideTip);

// ---------- hover: the island opens under the pointer and folds away when it leaves ----------
let openTimer = 0, closeTimer = 0;
let mouseSent = null;
function pointer(inside) {
  // clicks fall through to the app underneath unless the pointer is on the island. Only tell the main process when
  // that changes: switching click-through repaints the window on Windows, and doing it on every move made it flicker.
  if (inside !== mouseSent) { mouseSent = inside; api.mouse(inside); }
  if (inside === S.hover) return;
  S.hover = inside; clearTimeout(openTimer); clearTimeout(closeTimer);
  if (inside) { if (!S.open) openTimer = setTimeout(() => setOpen(true), 70); }
  else closeTimer = setTimeout(maybeClose, 280);
}
function maybeClose() { if (S.open && !S.hover && !S.pinned && !S.dragging && !S.menu && !typing() && !(S.auto && S.ai.top === 'asking')) setOpen(false); }

function second() {
  if (S.focus.running) {
    S.focus.left--;
    if (S.focus.left <= 0) {
      S.focus.running = false; S.focus.left = S.focus.total; chime(true);
      if (S.mode) stopMode(); else if (S.tab === 'focus') draw(true);
    }
  }
  drawPill(); tick();
}
/** The parts that move every second (clock, song progress, lyric line, timers), patched in place. */
function tick() {
  if (!S.open) return;
  const c = $('#clock'); if (c) c.textContent = clock();
  const hc = $('#hm-clock');
  if (hc) { const [hm, ...rest] = clock().split(/\s+/); hc.textContent = hm; if (rest.length) { const s = document.createElement('small'); s.textContent = rest.join(' '); hc.append(s); } }
  const hf = $('#hm-focus'); if (hf) hf.textContent = time(S.focus.left * 1000);
  const m = S.win.media;
  if (m && S.tab === 'music') {
    const pos = mediaPosition(), sk = $('#seek'), n = $('#pos');
    if (sk && !seeking) { sk.value = pos; sk.style.setProperty('--fill', (m.durationMs ? Math.min(100, 100 * pos / m.durationMs) : 0) + '%'); }
    if (n && !seeking) n.textContent = time(pos);
    const now = $('#ly-now');
    if (now) {
      const lines = S.lyrics || []; let i = -1; while (i + 1 < lines.length && lines[i + 1].t <= pos) i++;
      now.textContent = lines.length ? (lines[i]?.text || '♪') : (S.lyrics === null && S.lyricsFor ? '' : t('No lyrics for this song.'));
    }
  }
  const fl = $('#focus-left'), fd = $('#focus-done'), mark = $('#ruler-mark'), ml = $('#mode-left');
  if (fl) fl.textContent = time(S.focus.left * 1000);
  if (fd) fd.textContent = t('Done at {time}', { time: clock(new Date(Date.now() + S.focus.left * 1000)) });
  if (mark) mark.style.left = Math.min(100, S.focus.left / 36) + '%'; // 60 minutes = 3600 s = 100%
  if (ml) ml.textContent = time(S.focus.left * 1000);
}

// ---------- modes: a timer plus three switches; stopping puts the focus guard back the way it was ----------
async function startMode(id) {
  if (S.mode) await stopMode();
  const m = S.settings.modes[id], restore = { guardOn: Boolean(S.settings.guard.on) };
  S.mode = { id }; S.focus = { running: true, total: m.min * 60, left: m.min * 60 };
  await save({ modeRestore: restore, guard: { on: m.block ? true : restore.guardOn } });
  if (!m.music && S.win.media?.playing) api.media('toggle');
  draw(true);
}
async function stopMode() {
  const r = S.settings.modeRestore;
  S.mode = null; S.focus.running = false; S.focus.left = S.focus.total;
  if (r) await save({ modeRestore: null, guard: { on: r.guardOn } });
  if (S.tab === 'modes' || S.tab === 'focus') draw(true);
}
async function setModeMinutes(id, step) {
  if (S.mode?.id === id) return;
  const min = Math.max(5, Math.min(180, S.settings.modes[id].min + step));
  await save({ modes: { [id]: { min } } }); draw(true);
}

// ---------- note: lines that start with [ ] become tick circles on the right ----------
const TODO = /^\s*\[( |x|X)\]\s?(.*)$/;
function noteSide() {
  const items = (S.settings.note || '').split('\n').map((line, i) => ({ i, m: line.match(TODO) })).filter(x => x.m);
  if (!items.length) return esc(t('Start a line with [ ] and you get a check circle. Everything saves by itself.'));
  return items.map(({ i, m }) => `<button class="ck ${m[1] === ' ' ? '' : 'done'}" data-todo="${i}"><i></i><span class="cut">${esc(m[2] || ' ')}</span></button>`).join('');
}
function drawNoteSide() {
  const side = $('#note-side'); if (!side) return;
  side.innerHTML = noteSide(); side.classList.toggle('list', (S.settings.note || '').split('\n').some(l => TODO.test(l)));
}

// ---------- focus ruler: press and drag to choose 1 to 60 minutes ----------
function rulerAt(e) {
  const r = $('#ruler').getBoundingClientRect(), min = Math.max(1, Math.min(60, Math.round(60 * (e.clientX - r.left) / r.width)));
  if (min * 60 !== S.focus.total || S.focus.left !== S.focus.total) { S.focus = { running: false, total: min * 60, left: min * 60 }; tick(); }
}
page.addEventListener('pointerdown', e => {
  const ruler = e.target.closest('#ruler'); if (!ruler || S.focus.running) return;
  ruler.setPointerCapture(e.pointerId); rulerAt(e);
  const move = ev => rulerAt(ev), up = () => { ruler.removeEventListener('pointermove', move); ruler.removeEventListener('pointerup', up); };
  ruler.addEventListener('pointermove', move); ruler.addEventListener('pointerup', up);
});
page.addEventListener('wheel', e => { const el = e.target.closest('.md-time'); if (el) { e.preventDefault(); setModeMinutes(S.modePick || S.mode?.id || 'work', e.deltaY < 0 ? 5 : -5); } }, { passive: false });

async function refreshHome() { const [w, e] = await Promise.all([api.weather(), api.calendar()]); S.weather = w && !w.error ? w : null; S.event = e; draw(); }
async function refreshDevices() { const r = await api.spotifyDevices(); S.spotify = { on: r.ok || r.connected !== false, devices: r.devices || [], error: r.ok ? '' : r.error }; draw(); }
async function refreshLyrics() {
  const m = S.win.media, key = m ? m.title + '|' + m.artist : '';
  if (key === S.lyricsFor) return; S.lyricsFor = key; S.lyrics = null;
  if (m && S.settings.lyrics) { const lines = await api.lyrics({ title: m.title, artist: m.artist, durationSec: Math.round((m.durationMs || 0) / 1000) }); if (S.lyricsFor === key) S.lyrics = lines || []; }
}
async function refreshSongInfo() {
  const m = S.win.media; if (!m || !S.settings.songInfo) return;
  const song = songOf(m), key = song.title + '|' + song.artist; if (key in S.years) return;
  S.years[key] = null; // asked once per song
  const info = await api.songInfo(song); if (info) { S.years[key] = info; if (S.tab === 'music') draw(); }
}
function applyMascot() { document.documentElement.style.setProperty('--pip', S.settings.mascot.color); }
async function save(patch) { S.settings = await api.setSettings(patch); applyMascot(); drawPill(); }
async function sendReply(id) {
  const box = page.querySelector(`[data-reply-for="${CSS.escape(id)}"]`), text = box?.value.trim(); if (!text) return;
  box.value = ''; box.blur(); await api.reply(id, text);
}

// ---------- events ----------
// a click on the strip pins the island open; another click (or Esc) lets it fold away again
pill.addEventListener('click', e => {
  if (e.target.closest('#pill-more')) { e.stopPropagation(); showVolume(false); return showMenu(!S.menu); }
  if (S.open && S.pinned) setOpen(false); else { S.pinned = true; if (S.open) drawPill(); else setOpen(true); }
});
pill.addEventListener('keydown', e => { if (e.target === pill && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pill.click(); } });
bar.addEventListener('click', e => {
  if (e.target.closest('[data-settings]')) return openSettings();
  if (e.target.closest('#bar-vol')) { showMenu(false); return showVolume(!S.vol); }
  const b = e.target.closest('[data-tab]'); if (b) { showVolume(false); go(b.dataset.tab); }
});
$('#qvol').addEventListener('input', e => { $('#qvol-n').textContent = e.target.value; api.setVolume(e.target.value); });
menu.addEventListener('click', e => {
  const b = e.target.closest('[data-menu]'); if (!b) return;
  showMenu(false);
  if (b.dataset.menu === 'settings') openSettings();
  else if (b.dataset.menu === 'pin') { if (S.pinned) setOpen(false); else { S.pinned = true; drawPill(); } }
  else if (b.dataset.menu === 'quit') api.quit();
});
document.addEventListener('click', e => {
  if (S.menu && !e.target.closest('#menu, #pill-more')) showMenu(false);
  if (S.vol && !e.target.closest('#vol-pop, #bar-vol')) showVolume(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (S.menu || S.vol) { showMenu(false); showVolume(false); } else setOpen(false); }
  else if (e.key === 'Enter' && e.target.dataset?.replyFor) sendReply(e.target.dataset.replyFor);
});
document.addEventListener('mousemove', e => pointer(Boolean(e.target.closest && e.target.closest('#shell'))));
document.addEventListener('mouseleave', () => pointer(false));
page.addEventListener('focusout', () => setTimeout(maybeClose, 300));

page.addEventListener('click', async e => {
  const b = e.target.closest('button, .item'); if (!b) return;
  const d = b.dataset;
  if (d.settings !== undefined) openSettings();
  else if (d.lyrics !== undefined) { await save({ lyrics: !S.settings.lyrics }); S.lyricsFor = ''; refreshLyrics(); draw(true); }
  else if (d.decide) await api.decide(d.id, d.decide);
  else if (d.reply) sendReply(d.reply);
  else if (d.media) {
    api.media(d.media);
    // show the change at once; the helper confirms the real state a moment later
    const m = S.win.media; if (m && d.media === 'toggle') { m.positionMs = mediaPosition(); S.win.at = Date.now(); m.playing = !m.playing; draw(true); }
  }
  else if (d.device) { await api.spotifyTransfer(d.device); setTimeout(refreshDevices, 1200); }
  else if (d.remove) { e.stopPropagation(); S.tray = await api.trayRemove(d.remove); draw(); }
  else if (d.open) api.trayOpen(d.open);
  else if (d.clip !== undefined) { await api.copyClip(S.clips[+d.clip].text); b.querySelector('.cl-text').textContent = t('Copied!'); }
  else if (d.clipsClear !== undefined) { S.clips = await api.clearClips(); draw(true); }
  else if (d.share === 'start') { S.share = await api.shareStart(); draw(); }
  else if (d.share === 'stop') { await api.shareStop(); S.share = null; draw(); }
  else if (d.focus === 'toggle') { S.focus.running = !S.focus.running; draw(true); }
  else if (d.tabGo) go(d.tabGo);
  else if (d.connect !== undefined) { const r = await api.connectAgent('claude', true); if (r?.agents) S.agents = r.agents; if (!r?.ok) openSettings(); else draw(true); }
  else if (d.modePick) { S.modePick = d.modePick; draw(true); }
  else if (d.modeGo) { if (S.mode?.id === d.modeGo) await stopMode(); else await startMode(d.modeGo); }
  else if (d.mswitch) {
    const id = S.modePick || S.mode?.id || 'work', on = !S.settings.modes[id][d.mswitch];
    await save({ modes: { [id]: { [d.mswitch]: on } } });
    if (S.mode?.id === id && d.mswitch === 'block') await save({ guard: { on: on || Boolean(S.settings.modeRestore?.guardOn) } }); // a running mode follows its switch at once
    draw(true);
  }
  else if (d.todo !== undefined) {
    const lines = S.settings.note.split('\n'), i = +d.todo;
    lines[i] = lines[i].replace(/\[( |x|X)\]/, m => (m === '[ ]' ? '[x]' : '[ ]'));
    await save({ note: lines.join('\n') }); const box = $('#note'); if (box) box.value = S.settings.note; drawNoteSide();
  }
  else if (d.pick !== undefined) { const q = $('#question').value; S.ask.pick = d.pick; draw(true); $('#question').value = q; }
  else if (b.id === 'ask-go') {
    const question = $('#question').value; Object.assign(S.ask, { busy: true, text: '', error: '' }); draw(true); $('#question').value = question;
    const r = await api.ask(question, S.ask.pick || null); Object.assign(S.ask, { busy: false, text: r?.ok ? r.text : '', error: r?.ok ? '' : (r?.error || t('No answer.')) });
    if (S.tab === 'ask') { draw(true); $('#question').value = question; }
  }
});
let seeking = false; // while the seek bar is held, the second-by-second update leaves it alone
page.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'seek') { seeking = true; $('#pos').textContent = time(+el.value); el.style.setProperty('--fill', (100 * el.value / (el.max || 1)) + '%'); return; }
  if (el.id === 'volume') { S.dragging = true; $('#vol-n').textContent = el.value; api.setVolume(el.value); }
  else if (el.id === 'note') { S.settings.note = el.value; drawNoteSide(); clearTimeout(page._note); page._note = setTimeout(() => save({ note: el.value }), 500); }
});
page.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'seek') { const m = S.win.media; api.seek(+el.value); if (m) { m.positionMs = +el.value; S.win.at = Date.now(); } seeking = false; return; }
  if (el.id === 'device') { await api.spotifyTransfer(el.value); setTimeout(refreshDevices, 1200); return; }
  if (el.id === 'volume') S.dragging = false;
  else if (el.dataset.radio) api.setRadio(el.dataset.radio, el.checked);
});
// a file in the tray can be dragged out into any other app; Electron's own drag carries the real file
let draggingOut = false;
page.addEventListener('dragstart', e => {
  const f = e.target.closest?.('[data-drag]'); if (!f) return;
  e.preventDefault(); draggingOut = true; api.dragOut(f.dataset.drag); setTimeout(() => { draggingOut = false; }, 800);
});
// files dropped anywhere on the island go to the files tab
island.addEventListener('dragover', e => { e.preventDefault(); if (draggingOut) return; if (!S.open) setOpen(true); if (S.tab !== 'tray') go('tray'); $('#drop')?.classList.add('over'); });
island.addEventListener('dragleave', () => $('#drop')?.classList.remove('over'));
island.addEventListener('drop', async e => {
  e.preventDefault(); $('#drop')?.classList.remove('over'); if (draggingOut) return;
  const paths = [...e.dataTransfer.files].map(f => api.pathFor(f)).filter(Boolean);
  if (paths.length) { S.tray = await api.trayAdd(paths); draw(); }
});

api.onAi(snap => {
  const was = S.ai.top; S.ai = snap;
  if (snap.top === 'asking' && was !== 'asking') { chime(true); if (!S.open) { S.tab = 'ai'; S.auto = true; setOpen(true); } } // a question opens the island by itself
  else if (was === 'asking' && snap.top !== 'asking' && S.auto) { S.auto = false; setTimeout(maybeClose, 900); }
  draw();
});
api.onFinish(entry => chime(entry.state === 'done'));
api.onWin(state => { S.win = state; refreshLyrics(); refreshSongInfo(); draw(); });
api.onArt(art => { S.art = art; if (S.tab === 'music') draw(); });
// Pip looks at the pointer: the eyes shift a few pixels towards it, less when it is close
api.onCursor(p => {
  const r = pip.getBoundingClientRect(), dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, pull = Math.min(1, d / 140);
  pip.style.setProperty('--ex', (dx / d * (S.open ? 1.6 : 3.2) * pull).toFixed(2) + 'px'); pip.style.setProperty('--ey', (dy / d * (S.open ? 1.2 : 2.4) * pull).toFixed(2) + 'px');
});
api.onTray(list => { S.tray = list; draw(); });
api.onClips(list => { S.clips = list; draw(); });
api.onToggle(open => { if (open === true || !S.open) { S.pinned = true; setOpen(true); drawPill(); } else setOpen(false); });
// something was changed in the settings window: take the new settings (a new language needs a fresh page)
api.onChanged(async () => {
  const init = await api.init(), lang = S.settings.lang;
  Object.assign(S, { settings: init.settings, agents: init.agents }); S.spotify.on = init.spotify;
  if (init.settings.lang !== lang) return location.reload();
  applyMascot(); S.lyricsFor = ''; refreshLyrics(); if (S.open && S.tab === 'home') refreshHome(); else draw();
});

(async () => {
  const init = await api.init();
  t = window.makeT(init.strings); document.documentElement.lang = init.settings.lang;
  Object.assign(S, { settings: init.settings, ai: init.ai, agents: init.agents, win: init.win, tray: init.tray, clips: init.clips, platform: init.platform, art: init.art });
  S.spotify.on = init.spotify; S.hubError = await api.hubError();
  // Peep was closed while a mode was running: put the focus guard back the way it was before the mode
  if (S.settings.modeRestore) await save({ modeRestore: null, guard: { on: Boolean(S.settings.modeRestore.guardOn) } });
  applyMascot(); drawTabs(); drawPill(); setInterval(second, 1000);
})();
