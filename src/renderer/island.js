'use strict';
// The island: one page, drawn from the state the main process sends. No framework: small render functions per tab.
// Every text the user sees goes through t(): English here, translated by src/locales/<language>.json.
const api = window.peep;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const island = $('#island'), pill = $('#pill'), panel = $('#panel'), page = $('#page'), tabs = $('#tabs'), pip = $('#pip');
let t = window.makeT({});

const LIVE = new Set(['home', 'ai', 'music', 'tray', 'clips']); // redrawn when data changes; the others hold what you are typing
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#e8e8ee'];
const AGENT = { claude: 'Claude Code', codex: 'Codex' };
// Lists of words are built by functions so they follow the chosen language.
const tabList = () => [['home', t('Home')], ['ai', t('Agents')], ['music', t('Music')], ['tray', t('Files')], ['clips', t('Copied')], ['note', t('Note')], ['focus', t('Focus')], ['ask', t('Ask')], ['settings', t('Settings')]];
const stateName = s => ({ idle: t('Idle'), working: t('Working'), asking: t('Needs you'), done: t('Done'), error: t('Error') }[s] || s);
const verb = v => ({ Reading: t('Reading'), Writing: t('Writing'), Editing: t('Editing'), Running: t('Running'), Searching: t('Searching'), Fetching: t('Fetching'),
  'Searching the web': t('Searching the web'), Delegating: t('Delegating'), Using: t('Using'), Thinking: t('Thinking'), Failed: t('Failed'), 'Needs you': t('Needs you') }[v] || v);
const hatName = h => ({ none: t('No hat'), cap: t('Cap'), crown: t('Crown'), bow: t('Bow') }[h]);
const weatherName = c => (c === 0 ? t('Clear') : c <= 3 ? t('Cloudy') : c <= 48 ? t('Fog') : c <= 67 ? t('Rain') : c <= 77 ? t('Snow') : c <= 82 ? t('Showers') : t('Storm'));

const S = { open: false, tab: 'home', settings: null, ai: { sessions: [], top: 'idle', history: [], usage: null }, agents: {}, win: { media: null, volume: null, net: null }, tray: [], clips: [],
  weather: null, event: null, stats: null, lyrics: null, lyricsFor: '', share: null, focus: { left: 25 * 60, running: false, total: 25 * 60 },
  ask: { busy: false, text: '', error: '', windows: [], pick: '' }, spotify: { on: false, devices: [], error: '' },
  platform: '', version: '', displays: 1, autostart: false, hubError: '', dragging: false, languages: [], node: true };

// ---------- small helpers ----------
const locale = () => (S.settings?.lang === 'sw' ? 'sw-TZ' : undefined);
const clock = () => new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const time = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ago = at => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : t('{n} h ago', { n: Math.round(m / 60) }); };
const size = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const until = at => { const m = Math.max(0, Math.round((at - Date.now()) / 60000)); return m < 60 ? t('{n} min', { n: m }) : t('{n} h', { n: Math.round(m / 60) }); };
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
function mediaPosition() { const m = S.win.media; if (!m) return 0; return Math.min(m.durationMs || Infinity, m.positionMs + (m.playing ? Date.now() - S.win.at : 0)); }

// ---------- the pill ----------
function drawPill() {
  const top = S.ai.sessions[0], m = S.win.media;
  island.className = S.ai.top + (S.open ? ' open' : '');
  const mood = S.ai.top !== 'idle' ? S.ai.top : (m?.playing ? 'music' : 'idle');
  pip.className = 'pip ' + mood + (S.settings?.mascot.hat !== 'none' ? ' hat-' + S.settings?.mascot.hat : '');
  let text = S.settings?.mascot.name || 'Peep', side = clock();
  if (top && top.state === 'asking') text = t('{agent} needs you', { agent: AGENT[top.agent] });
  else if (top && top.state === 'working') text = top.activity ? `${verb(top.activity.verb)} ${top.activity.detail}`.trim() : t('Working');
  else if (top && top.state === 'done') text = t('{agent} is done', { agent: AGENT[top.agent] });
  else if (top && top.state === 'error') text = t('{agent} hit an error', { agent: AGENT[top.agent] });
  else if (S.focus.running) { text = t('Focus'); side = time(S.focus.left * 1000); }
  else if (m?.playing) text = m.artist ? `${m.title} · ${m.artist}` : m.title;
  if (top?.state === 'working' && top.startedAt) side = time(Date.now() - top.startedAt);
  $('#pill-text').textContent = text; $('#pill-side').textContent = side;
  const dot = tabs.querySelector('[data-tab=ai]'); if (dot) dot.classList.toggle('dot', S.ai.top === 'asking');
}

// ---------- pages ----------
const usageBar = (label, u) => (u ? `<span>${label} ${u.pct}%</span><div class="bar grow"><i data-w="${u.pct}" class="${u.pct >= 85 ? 'hot' : ''}"></i></div>${u.resetsAt > Date.now() ? `<span>${esc(t('resets in {time}', { time: until(u.resetsAt) }))}</span>` : ''}` : '');
const pages = {
  home() {
    const top = S.ai.sessions[0], m = S.win.media, now = new Date(), u = S.ai.usage, net = S.win.net;
    const agentLine = top ? `<span class="badge ${top.state}">${esc(stateName(top.state))}</span> <b>${esc(AGENT[top.agent])}</b> <span class="dim">${esc(top.project)}</span>` : `<span class="dim">${esc(t('No agent session yet.'))}</span>`;
    return `${S.hubError ? `<div class="card" data-kind="error">${esc(S.hubError)}</div>` : ''}
      ${S.agents.claude || S.agents.codex ? '' : `<div class="card row"><div class="grow">${esc(t('Connect Claude Code or Codex to see what they are doing.'))}</div><button class="btn primary" data-go="settings">${esc(t('Connect'))}</button></div>`}
      <div class="card"><div class="row">${agentLine}</div>${top?.activity ? `<div class="cut mono dim">${esc(verb(top.activity.verb))} ${esc(top.activity.detail)}</div>` : ''}</div>
      ${u ? `<div class="card"><h2>${esc(t('Claude usage'))}</h2><div class="row small dim">${usageBar(esc(t('5 hours')), u.fiveHour)}</div><div class="row small dim">${usageBar(esc(t('Week')), u.sevenDay)}</div></div>` : ''}
      <div class="grid">
        <div class="card"><div class="big" id="clock">${clock()}</div><div class="dim">${esc(now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }))}</div></div>
        <div class="card">${S.weather ? `<div class="big">${S.weather.temp}${esc(S.weather.unit)}</div><div class="dim">${esc(weatherName(S.weather.code))} · ${esc(S.weather.place)}</div>` : `<div class="dim">${esc(t('Add your town in Settings for the weather.'))}</div>`}</div>
        <div class="card"><h2>${esc(t('Next'))}</h2>${S.event ? `<div class="cut">${esc(S.event.title)}</div><div class="dim small">${esc(new Date(S.event.start).toLocaleString(locale(), S.event.allDay ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</div>` : `<div class="dim">${esc(t('No calendar linked.'))}</div>`}</div>
        <div class="card"><h2>${esc(t('Playing'))}</h2>${m ? `<div class="cut">${esc(m.title)}</div><div class="dim small cut">${esc(m.artist)}</div>` : `<div class="dim">${esc(t('Nothing is playing.'))}</div>`}</div>
      </div>
      ${net ? `<div class="card row">${net.wifi ? `<label class="check" data-flat><input type="checkbox" data-radio="WiFi" ${net.wifi.on ? 'checked' : ''}>Wi-Fi${net.wifi.ssid ? ` <span class="dim small cut">${esc(net.wifi.ssid)}</span>` : ''}</label>` : ''}<span class="grow"></span>${net.bt ? `<label class="check" data-flat><input type="checkbox" data-radio="Bluetooth" ${net.bt.on ? 'checked' : ''}>Bluetooth</label>` : ''}</div>` : ''}
      ${S.stats ? `<div class="card row small dim"><span>CPU ${S.stats.cpu}%</span><div class="bar grow"><i data-w="${S.stats.cpu}"></i></div><span>${esc(t('Memory'))} ${S.stats.mem}%</span><div class="bar grow"><i data-w="${S.stats.mem}"></i></div></div>` : ''}`;
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
    const m = S.win.media, v = S.win.volume, sp = S.spotify;
    if (S.platform !== 'win32') return `<div class="card dim">${esc(t('Music controls need Windows.'))}</div>`;
    return `${m ? `<div class="card"><div class="cut"><b>${esc(m.title)}</b></div><div class="dim cut">${esc(m.artist)}${m.album ? ' · ' + esc(m.album) : ''}</div>
        <div class="lyric" id="lyric"></div><div class="bar"><i id="progress"></i></div><div class="row small dim"><span id="pos"></span><span class="grow"></span><span>${m.durationMs ? time(m.durationMs) : ''}</span></div></div>` : `<div class="card dim">${esc(t('Nothing is playing.'))}</div>`}
      <div class="row" data-center><button class="btn icon" data-media="prev" aria-label="${esc(t('Previous'))}">⏮</button><button class="btn icon primary" data-media="toggle" aria-label="${esc(t('Play or pause'))}">${m?.playing ? '⏸' : '▶'}</button><button class="btn icon" data-media="next" aria-label="${esc(t('Next'))}">⏭</button></div>
      ${v ? `<h2>${esc(t('Volume'))}</h2><div class="row"><input type="range" id="volume" min="0" max="100" value="${v.level}"><span class="dim" id="vol-n">${v.level}</span></div>` : ''}
      ${sp.on ? `<h2>${esc(t('Play on'))}</h2>${sp.devices.map(d => `<div class="item" data-device="${esc(d.id)}"><span class="grow cut">${esc(d.name)}</span>${d.active ? `<span class="badge done">${esc(t('Playing'))}</span>` : ''}</div>`).join('') || `<div class="dim">${esc(sp.error || t('Open Spotify on a device to see it here.'))}</div>`}` : ''}`;
  },
  tray() {
    const files = S.tray.map(f => `<div class="item" data-open="${esc(f.path)}"><span class="grow cut">${esc(f.name)}</span><span class="dim small">${size(f.size)}</span><button class="x" data-remove="${esc(f.path)}" aria-label="${esc(t('Remove'))}">✕</button></div>`).join('');
    const sh = S.share;
    return `<div class="drop" id="drop">${esc(t('Drop files here to keep them close'))}</div>${files}
      <h2>${esc(t('Phone'))}</h2>${sh?.on ? `<div class="card row"><img class="qr" alt="QR" src="${esc(sh.qr)}"><div class="grow"><div>${esc(t('Scan with your phone on the same Wi-Fi.'))}</div><div class="mono dim small">${esc(sh.url)}</div><div class="dim small">${esc(t('Stops by itself after an hour.'))}</div><br><button class="btn" data-share="stop">${esc(t('Stop sharing'))}</button></div></div>`
        : `<div class="card row"><div class="grow">${esc(t('Send these files to your phone, or files from your phone to this PC, over your own Wi-Fi.'))}${sh?.error ? `<div class="small" data-kind="error">${esc(sh.error)}</div>` : ''}</div><button class="btn primary" data-share="start">${esc(t('Share'))}</button></div>`}`;
  },
  clips() { return `<h2>${esc(t('Recently copied'))}</h2>${S.clips.map((c, i) => `<div class="item" data-clip="${i}"><span class="grow cut mono">${esc(c.slice(0, 200))}</span></div>`).join('') || `<div class="dim">${esc(t('Text you copy shows up here. It is kept in memory only.'))}</div>`}`; },
  note() { return `<h2>${esc(t('Quick note'))}</h2><textarea id="note" rows="17" placeholder="${esc(t('Type anything. It saves by itself.'))}">${esc(S.settings.note)}</textarea>`; },
  focus() {
    const f = S.focus;
    return `<div class="card" data-center><div class="big" id="focus-left">${time(f.left * 1000)}</div><div class="bar"><i id="focus-bar"></i></div><br>
      <div class="row" data-center><button class="btn primary" data-focus="toggle">${esc(f.running ? t('Pause') : t('Start'))}</button><button class="btn" data-focus="reset">${esc(t('Reset'))}</button></div></div>
      <div class="row" data-center>${[15, 25, 50].map(n => `<button class="btn" data-focus-min="${n}">${esc(t('{n} min', { n }))}</button>`).join('')}</div>`;
  },
  ask() {
    const a = S.ask;
    return `<h2>${esc(t('Ask about your screen'))}</h2><div class="dim small">${esc(t('{name} takes one screenshot and asks {agent} through your own login.', { name: S.settings.mascot.name, agent: AGENT[S.settings.buddyAgent] }))}</div>
      <div class="shots"><button class="shot ${a.pick ? '' : 'on'}" data-pick=""><span>${esc(t('Whole screen'))}</span></button>${a.windows.map(w => `<button class="shot ${a.pick === w.id ? 'on' : ''}" data-pick="${esc(w.id)}"><img alt="" src="${esc(w.thumb)}"><span class="cut">${esc(w.name)}</span></button>`).join('')}</div>
      <textarea id="question" rows="2" placeholder="${esc(t('What does this error mean?'))}"></textarea><br><br><button class="btn primary" id="ask-go" ${a.busy ? 'disabled' : ''}>${esc(a.busy ? t('Looking…') : t('Ask'))}</button>
      ${a.error ? `<div class="card" data-kind="error">${esc(a.error)}</div>` : ''}${a.text ? `<div class="card answer">${esc(a.text)}</div>` : ''}`;
  },
  settings() {
    const s = S.settings, check = (id, on, label) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
    return `<h2>${esc(t('Agents'))}</h2>${check('ag-claude', S.agents.claude, esc(t('Follow Claude Code')) + ` <span class="dim small">(~/.claude/settings.json)</span>`)}${check('ag-codex', S.agents.codex, esc(t('Follow Codex')) + ` <span class="dim small">(~/.codex/hooks.json)</span>`)}
      ${check('s-agentlang', s.agentLanguage, esc(t('Agents answer me in this language')))}
      ${S.node ? '' : `<div class="dim small">${esc(t('Answering from here and the usage bars need Node.js on this PC.'))}</div>`}<div class="small" id="ag-error" data-kind="error"></div>
      <h2>${esc(t('Language'))}</h2><select id="s-lang">${S.languages.map(l => `<option value="${esc(l.code)}" ${l.code === s.lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <h2>${esc(s.mascot.name)}</h2><label class="field"><span>${esc(t('Name'))}</span><input type="text" id="m-name" maxlength="20" value="${esc(s.mascot.name)}"></label>
      <div class="row"><div class="swatches" id="m-colors">${COLORS.map(c => `<button data-color="${c}" class="${c === s.mascot.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div>
        <select id="m-hat" data-narrow>${['none', 'cap', 'crown', 'bow'].map(h => `<option value="${h}" ${h === s.mascot.hat ? 'selected' : ''}>${esc(hatName(h))}</option>`).join('')}</select></div>
      <h2>${esc(t('General'))}</h2>${check('s-sounds', s.sounds, esc(t('Chime when an agent finishes')))}${check('s-lyrics', s.lyrics, esc(t('Show song lyrics (asks lrclib.net for the song)')))}${check('s-auto', S.autostart, esc(t('Start with Windows')))}
      <label class="field"><span>${esc(t('Ask about your screen with'))}</span><select id="s-buddy"><option value="claude" ${s.buddyAgent === 'claude' ? 'selected' : ''}>Claude Code</option><option value="codex" ${s.buddyAgent === 'codex' ? 'selected' : ''}>Codex</option></select></label>
      <label class="field"><span>${esc(t('Town for the weather'))}</span><input type="text" id="s-place" value="${esc(s.weather.place)}"></label>
      <label class="field"><span>${esc(t('Calendar link (private iCal address, https)'))}</span><input type="url" id="s-cal" value="${esc(s.calendarUrl)}"></label>
      ${S.displays > 1 ? `<label class="field"><span>${esc(t('Screen'))}</span><select id="s-display">${Array.from({ length: S.displays }, (_, i) => `<option value="${i}" ${i === s.island.display ? 'selected' : ''}>${esc(t('Screen {n}', { n: i + 1 }))}</option>`).join('')}</select></label>` : ''}
      <h2>Spotify</h2><div class="dim small">${esc(t('Only for choosing which device plays. Needs your own free client ID from developer.spotify.com, with this redirect address:'))} <span class="mono">http://127.0.0.1:48612/callback</span></div>
      <div class="row" data-gap><input type="text" class="grow" id="sp-id" placeholder="Client ID" value="${esc(s.spotifyClientId)}"><button class="btn ${S.spotify.on ? '' : 'primary'}" id="sp-go">${esc(S.spotify.on ? t('Disconnect') : t('Connect'))}</button></div><div class="small" id="sp-error" data-kind="error"></div>
      <h2>${esc(t('Focus guard'))}</h2>${check('g-on', s.guard.on, esc(t('Pause me before these open')))}
      <label class="field"><span>${esc(t('Words to watch for in window titles, separated by commas'))}</span><input type="text" id="g-sites" value="${esc(s.guard.sites.join(', '))}"></label>
      <div class="dim small">Peep ${esc(S.version)} · MIT · ${esc(s.shortcut)}</div>`;
  }
};

function draw(force) {
  drawPill();
  if (!S.open || S.dragging || (!force && (!LIVE.has(S.tab) || typing()))) return;
  page.innerHTML = pages[S.tab]();
  for (const el of page.querySelectorAll('[data-w]')) el.style.width = el.dataset.w + '%';
  for (const el of page.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  for (const el of page.querySelectorAll('[data-center]')) { el.style.justifyContent = 'center'; el.style.textAlign = 'center'; el.style.margin = '10px 0'; }
  for (const el of page.querySelectorAll('[data-kind=error]')) el.style.color = 'var(--error)';
  for (const el of page.querySelectorAll('[data-narrow]')) el.style.width = '120px';
  for (const el of page.querySelectorAll('[data-flat]')) el.style.margin = '0';
  for (const el of page.querySelectorAll('[data-gap]')) el.style.margin = '8px 0';
  tick();
}
function drawTabs() { tabs.innerHTML = tabList().map(([id, name]) => `<button type="button" data-tab="${id}" class="${id === S.tab ? 'on' : ''}">${esc(name)}</button>`).join(''); }
function go(tab) {
  S.tab = tab; drawTabs(); draw(true);
  if (tab === 'home') refreshHome();
  if (tab === 'ask') api.windows().then(list => { S.ask.windows = list || []; if (S.tab === 'ask' && !typing()) draw(true); });
  if (tab === 'music' && S.spotify.on) refreshDevices();
}
function setOpen(open) {
  S.open = open; panel.hidden = !open; api.focus(open);
  if (open) go(S.tab); else { drawPill(); api.mouse(false); }
}

function second() {
  if (S.focus.running) { S.focus.left--; if (S.focus.left <= 0) { S.focus.running = false; S.focus.left = S.focus.total; chime(true); if (S.tab === 'focus') draw(true); } }
  drawPill(); tick();
}
/** The parts that move every second (clock, song progress, lyric line, focus timer), patched in place. */
function tick() {
  if (!S.open) return;
  const c = $('#clock'); if (c) c.textContent = clock();
  const m = S.win.media;
  if (m && S.tab === 'music') {
    const pos = mediaPosition(), p = $('#progress'), n = $('#pos'), l = $('#lyric');
    if (p) p.style.width = (m.durationMs ? Math.min(100, 100 * pos / m.durationMs) : 0) + '%';
    if (n) n.textContent = time(pos);
    if (l) { let cur = null; for (const line of S.lyrics || []) { if (line.t <= pos) cur = line; else break; } l.textContent = cur?.text || ''; }
  }
  const fl = $('#focus-left'), fb = $('#focus-bar');
  if (fl) fl.textContent = time(S.focus.left * 1000); if (fb) fb.style.width = (100 * (1 - S.focus.left / S.focus.total)) + '%';
}
async function refreshHome() { const [w, e, st] = await Promise.all([api.weather(), api.calendar(), api.stats()]); S.weather = w; S.event = e; S.stats = st; draw(); }
async function refreshDevices() { const r = await api.spotifyDevices(); S.spotify = { on: r.ok || r.connected !== false, devices: r.devices || [], error: r.ok ? '' : r.error }; draw(); }
async function refreshLyrics() {
  const m = S.win.media, key = m ? m.title + '|' + m.artist : '';
  if (key === S.lyricsFor) return; S.lyricsFor = key; S.lyrics = null;
  if (m && S.settings.lyrics) S.lyrics = await api.lyrics({ title: m.title, artist: m.artist, durationSec: Math.round((m.durationMs || 0) / 1000) });
}
function applyMascot() { document.documentElement.style.setProperty('--pip', S.settings.mascot.color); }
async function save(patch) { S.settings = await api.setSettings(patch); applyMascot(); drawPill(); }
async function sendReply(id) {
  const box = page.querySelector(`[data-reply-for="${CSS.escape(id)}"]`), text = box?.value.trim(); if (!text) return;
  box.value = ''; box.blur(); await api.reply(id, text);
}

// ---------- events ----------
pill.addEventListener('click', () => setOpen(!S.open));
tabs.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') setOpen(false);
  else if (e.key === 'Enter' && e.target.dataset?.replyFor) sendReply(e.target.dataset.replyFor);
});
// clicks fall through to the app underneath unless the pointer is on the island
document.addEventListener('mousemove', e => api.mouse(Boolean(e.target.closest && e.target.closest('#island'))));
document.addEventListener('mouseleave', () => { if (!S.dragging) api.mouse(false); });

page.addEventListener('click', async e => {
  const b = e.target.closest('button, .item'); if (!b) return;
  const d = b.dataset;
  if (d.go) go(d.go);
  else if (d.decide) await api.decide(d.id, d.decide);
  else if (d.reply) sendReply(d.reply);
  else if (d.media) api.media(d.media);
  else if (d.device) { await api.spotifyTransfer(d.device); setTimeout(refreshDevices, 1200); }
  else if (d.remove) { e.stopPropagation(); S.tray = await api.trayRemove(d.remove); draw(); }
  else if (d.open) api.trayOpen(d.open);
  else if (d.clip !== undefined) { await api.copyClip(S.clips[+d.clip]); b.querySelector('span').textContent = t('Copied!'); }
  else if (d.share === 'start') { S.share = await api.shareStart(); draw(); }
  else if (d.share === 'stop') { await api.shareStop(); S.share = null; draw(); }
  else if (d.focus === 'toggle') { S.focus.running = !S.focus.running; draw(true); }
  else if (d.focus === 'reset') { S.focus.running = false; S.focus.left = S.focus.total; draw(true); }
  else if (d.focusMin) { S.focus = { running: false, total: d.focusMin * 60, left: d.focusMin * 60 }; draw(true); }
  else if (d.color) { await save({ mascot: { color: d.color } }); draw(true); }
  else if (d.pick !== undefined) { const q = $('#question').value; S.ask.pick = d.pick; draw(true); $('#question').value = q; }
  else if (b.id === 'sp-go') {
    if (S.spotify.on) { await api.spotifyLogout(); S.spotify = { on: false, devices: [], error: '' }; draw(true); return; }
    await save({ spotifyClientId: $('#sp-id').value.trim() }); $('#sp-error').textContent = t('Finish the login in your browser…');
    const r = await api.spotifyLogin(); S.spotify.on = r.ok; if (S.tab === 'settings') { draw(true); if (!r.ok) $('#sp-error').textContent = r.error; }
  }
  else if (b.id === 'ask-go') {
    const question = $('#question').value; Object.assign(S.ask, { busy: true, text: '', error: '' }); draw(true); $('#question').value = question;
    const r = await api.ask(question, S.ask.pick || null); Object.assign(S.ask, { busy: false, text: r?.ok ? r.text : '', error: r?.ok ? '' : (r?.error || t('No answer.')) });
    if (S.tab === 'ask') { draw(true); $('#question').value = question; }
  }
});
page.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'volume') { S.dragging = true; $('#vol-n').textContent = el.value; api.setVolume(el.value); }
  else if (el.id === 'note') { clearTimeout(page._note); page._note = setTimeout(() => save({ note: el.value }), 500); }
});
page.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'volume') S.dragging = false;
  else if (el.dataset.radio) api.setRadio(el.dataset.radio, el.checked);
  else if (el.id === 'ag-claude' || el.id === 'ag-codex') {
    const r = await api.connectAgent(el.id.slice(3), el.checked); S.agents = r.agents || S.agents;
    draw(true); if (!r.ok) $('#ag-error').textContent = t('Could not change that: {error}', { error: r.error });
  }
  else if (el.id === 's-lang') { await save({ lang: el.value }); location.reload(); }
  else if (el.id === 's-agentlang') save({ agentLanguage: el.checked });
  else if (el.id === 'm-name') { await save({ mascot: { name: el.value.trim() || 'Pip' } }); }
  else if (el.id === 'm-hat') save({ mascot: { hat: el.value } });
  else if (el.id === 's-sounds') save({ sounds: el.checked });
  else if (el.id === 's-lyrics') save({ lyrics: el.checked });
  else if (el.id === 's-auto') S.autostart = await api.setAutostart(el.checked);
  else if (el.id === 's-buddy') save({ buddyAgent: el.value });
  else if (el.id === 's-place') save({ weather: { place: el.value.trim() } });
  else if (el.id === 's-cal') save({ calendarUrl: el.value.trim() });
  else if (el.id === 's-display') save({ island: { display: +el.value } });
  else if (el.id === 'g-on') save({ guard: { on: el.checked } });
  else if (el.id === 'g-sites') save({ guard: { sites: el.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 40) } });
});
// files dropped anywhere on the island go to the files tab
island.addEventListener('dragover', e => { e.preventDefault(); if (!S.open) setOpen(true); if (S.tab !== 'tray') go('tray'); $('#drop')?.classList.add('over'); });
island.addEventListener('dragleave', () => $('#drop')?.classList.remove('over'));
island.addEventListener('drop', async e => {
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map(f => api.pathFor(f)).filter(Boolean);
  if (paths.length) { S.tray = await api.trayAdd(paths); draw(); }
});

api.onAi(snap => { const was = S.ai.top; S.ai = snap; if (snap.top === 'asking' && was !== 'asking') chime(true); draw(); });
api.onFinish(entry => chime(entry.state === 'done'));
api.onWin(state => { S.win = state; refreshLyrics(); draw(); });
api.onTray(list => { S.tray = list; draw(); });
api.onClips(list => { S.clips = list; draw(); });
api.onToggle(open => setOpen(open === true ? true : !S.open));
api.onPage(tab => { S.tab = tab; setOpen(true); });

(async () => {
  const init = await api.init();
  t = window.makeT(init.strings); document.documentElement.lang = init.settings.lang;
  Object.assign(S, { settings: init.settings, ai: init.ai, agents: init.agents, win: init.win, tray: init.tray, clips: init.clips, platform: init.platform, version: init.version,
    displays: init.displays, autostart: init.autostart, languages: init.languages, node: init.node });
  S.spotify.on = init.spotify; S.hubError = await api.hubError();
  applyMascot(); drawTabs(); drawPill(); setInterval(second, 1000);
  if (!init.settings.firstRunDone) { await save({ firstRunDone: true }); S.tab = 'settings'; setOpen(true); }
})();
