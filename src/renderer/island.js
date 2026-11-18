'use strict';
// The island: one page, drawn from the state the main process sends. No framework: small render functions per tab.
// Every text the user sees goes through t(): English here, translated by src/locales/<language>.json.
const api = window.pipApp;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const island = $('#island'), shell = $('#shell'), pill = $('#pill'), page = $('#page'), tabs = $('#tabs'), pip = $('#pip'), bar = $('#bar'), tip = $('#tip'), menu = $('#menu'), volPop = $('#vol-pop');
let t = window.makeT({});

const FREE = new Set(['ai']); // after the trial without a license: the agents' tab (and the folded island) keep working
const LIVE = new Set(['home', 'ai', 'music', 'tray', 'clips', 'calendar', 'mail']); // redrawn when data changes; the others hold what you are typing
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#e8e8ee'];
const AGENT = { claude: 'Claude Code', codex: 'Codex' };
// Lists of words are built by functions so they follow the chosen language.
const tabList = () => [['home', t('Home')], ['pip', 'Pip'], ['ai', t('Agents')], ['music', t('Music')], ['focus', t('Focus')], ['modes', t('Modes')], ['tray', t('Files')], ['note', t('Note')], ['clips', t('Copied')], ['calendar', t('Calendar')], ['mail', t('Mail')]];
const MODES = () => [['work', t('Work')], ['study', t('Study')], ['sleep', t('Sleep')], ['game', t('Game')]];
const SITE_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', reddit: 'Reddit', 'x.com': 'X', facebook: 'Facebook', netflix: 'Netflix' };
const stateName = s => ({ idle: t('Idle'), working: t('Working'), asking: t('Needs you'), done: t('Done'), error: t('Error') }[s] || s);
const verb = v => ({ Reading: t('Reading'), Writing: t('Writing'), Editing: t('Editing'), Running: t('Running'), Searching: t('Searching'), Fetching: t('Fetching'),
  'Searching the web': t('Searching the web'), Delegating: t('Delegating'), Using: t('Using'), Thinking: t('Thinking'), Failed: t('Failed'), 'Needs you': t('Needs you') }[v] || v);
const weatherName = c => (c === 0 ? t('Clear') : c <= 3 ? t('Cloudy') : c <= 48 ? t('Fog') : c <= 67 ? t('Rain') : c <= 77 ? t('Snow') : c <= 82 ? t('Showers') : t('Storm'));

const S = { open: false, tab: 'home', settings: null, ai: { sessions: [], top: 'idle', history: [], usage: null }, agents: {}, win: { media: null, volume: null, net: null }, tray: [], clips: [],
  weather: null, event: null, stats: null, lyrics: null, lyricsFor: '', lyricsAt: 0, share: null, focus: { left: 25 * 60, running: false, total: 25 * 60 },
  ask: { busy: false, text: '', error: '', windows: [], pick: '' }, spotify: { on: false, devices: [], error: '' },
  sendPrompt: { text: '', busy: false, target: '', error: '' },
  platform: '', hubError: '', dragging: false, art: null, pinned: false, hover: false, auto: false, awakeUntil: 0, cursorAt: Date.now(), alert: null, alertTimer: 0, mood: '', emotion: '', pillDrawn: false, restTimer: 0, wakeTimer: 0, sleepTimer: 0,
  mode: null, modePick: '', menu: false, vol: false, calLoaded: false, years: {},
  google: false, cal: { view: 'day', events: null, error: '' }, mail: { count: null, error: '', at: 0 }, menuView: 'main', update: null,
  chat: { log: [], busy: false, screen: false }, recv: null };

// ---------- small helpers ----------
const locale = () => (S.settings?.lang === 'sw' ? 'sw-TZ' : undefined);
const clockFmt = () => { const c = S.settings?.island.clock; return c === '12' ? { hour12: true } : c === '24' ? { hour12: false } : {}; }; // Settings: the language's own, 12 or 24 hours
const clock = (d = new Date()) => d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', ...clockFmt() });
const dateLabel = (d = new Date()) => [d.toLocaleDateString(locale(), { weekday: 'short' }), d.getDate(), d.toLocaleDateString(locale(), { month: 'short' })].join(' ').replace(/[.,]/g, '');
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const age = at => { const m = Math.floor((Date.now() - at) / 60000); return m < 1 ? t('just now') : m < 60 ? t('{n} min', { n: m }) : t('{n} h', { n: Math.floor(m / 60) }); };
const time = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ago = at => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : t('{n} h ago', { n: Math.round(m / 60) }); };
const size = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const typing = () => { const a = document.activeElement; return page.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range'; };
// ---------- sounds: one small synthesised sound per animation (no audio files) ----------
// Alerts (asking, done, error, timers, payments, files) follow "sounds". The quiet ones for the island's own movement
// (wake, rest, open, fold, music, phone) also need "motionSounds", so they can be switched off on their own.
let audio = null;
const ALERTS = new Set(['asking', 'done', 'error', 'working', 'focus', 'sparkle', 'message', 'ring']);
// each sound: notes as [frequency Hz, start s, length s, volume, wave, glide-to Hz]
const SFX = {
  wake: [[520, 0, .09, .05, 'sine', 780], [880, .08, .12, .04, 'sine']],          // eyes pop open: a small rising "boop"
  rest: [[440, 0, .45, .03, 'sine', 300]],                                         // a soft sigh down to sleep
  open: [[300, 0, .14, .035, 'triangle', 620]],                                    // the island grows
  fold: [[560, 0, .14, .03, 'triangle', 280]],                                     // and shrinks back
  working: [[990, 0, .05, .035, 'square'], [1320, .06, .05, .025, 'square']],      // an agent starts: a busy little tick
  asking: [[660, 0, .16, .11, 'sine'], [880, .15, .24, .11, 'sine', 990]],          // "hey?" going up like a question
  done: [[523, 0, .14, .1, 'sine'], [659, .11, .14, .1, 'sine'], [784, .22, .32, .11, 'sine']], // a happy three-note smile
  error: [[330, 0, .2, .1, 'triangle'], [247, .16, .34, .1, 'triangle', 220]],      // two notes down
  music: [[392, 0, .08, .04, 'sine'], [523, .1, .1, .04, 'sine']],                  // a song starts: Pip bops
  phoneOn: [[740, 0, .07, .05, 'sine'], [988, .08, .07, .05, 'sine'], [1318, .16, .14, .045, 'sine']], // phone connected
  phoneOff: [[988, 0, .08, .045, 'sine'], [659, .09, .16, .04, 'sine']],
  focus: [[784, 0, .5, .09, 'sine'], [1175, .02, .6, .04, 'sine']],                 // a timer ends: a bell
  message: [[880, 0, .07, .06, 'sine'], [1175, .07, .14, .06, 'sine']],             // a message pops in: "ding-ding"
  ring: [[1047, 0, .06, .05, 'sine'], [1319, .06, .06, .05, 'sine'], [1047, .12, .06, .05, 'sine'], [1319, .18, .08, .05, 'sine']], // a call: a soft trill (the iPhone rings too)
  sparkle: [[1047, 0, .08, .06, 'sine'], [1319, .07, .08, .06, 'sine'], [1568, .14, .08, .06, 'sine'], [2093, .21, .3, .05, 'sine']], // confetti
};
function sfx(name) {
  const st = S.settings; if (!st?.sounds || !SFX[name] || (!ALERTS.has(name) && st.motionSounds === false)) return;
  try {
    audio = audio || new AudioContext(); if (audio.state === 'suspended') audio.resume();
    const now = audio.currentTime + .01;
    for (const [f, at, len, vol, wave, to] of SFX[name]) {
      const o = audio.createOscillator(), g = audio.createGain(); o.type = wave; o.frequency.setValueAtTime(f, now + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, now + at + len);
      g.gain.setValueAtTime(.0001, now + at); g.gain.exponentialRampToValueAtTime(vol, now + at + .012); g.gain.exponentialRampToValueAtTime(.0001, now + at + len);
      o.connect(g); g.connect(audio.destination); o.start(now + at); o.stop(now + at + len + .02);
    }
  } catch {}
}
/** Song and artist as people read them: some players send "Artist - Title" as the title with no artist. */
function songOf(m) { const x = !m.artist && String(m.title).match(/^(.+?)\s+[-–]\s+(.+)$/); return x ? { title: x[2], artist: x[1] } : { title: m.title, artist: m.artist }; }
const APPS = { spotify: 'Spotify', zunemusic: 'Media Player', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', vlc: 'VLC' };
const appName = id => { const s = String(id).toLowerCase(), k = Object.keys(APPS).find(k => s.includes(k)); return k ? APPS[k] : String(id).split(/[!\\]/).pop().replace(/\.exe$/i, ''); };
const sameDay = (ms, d) => { const x = new Date(ms); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
const richText = s => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
let lyrUserAt = 0; // when you last scrolled the lyrics yourself: they stop following the song for a moment
function mediaPosition() { const m = S.win.media; if (!m) return 0; return Math.min(m.durationMs || Infinity, m.positionMs + (m.playing ? Date.now() - S.win.at : 0)); }

const REST_AFTER = 5 * 60000; // Pip rests once the pointer has been still this long (and there is no task)
const SLEEP_AFTER = REST_AFTER + 30 * 60000; // and falls properly asleep after another 30 minutes of that
// mood (what Pip is doing) + resting/sleeping (how long it's been idle) -> which of the owner's emotion
// drawings to show. "confused" and "sad" are drawn but have no trigger yet - free for a later mood.
const EMOTION = { idle: 'default', working: 'curious', asking: 'worried', done: 'smiling', error: 'angry', music: 'happy' };
function emotionFor(mood, resting, sleeping, waking) {
  if (waking) return 'winks'; // a blink on the way back up, whatever woke it
  if (sleeping) return 'sleeping';
  if (resting) return 'tired';
  return EMOTION[mood] || 'default';
}
// ---------- the pill ----------
function drawPill() {
  const top = S.ai.sessions[0], m = S.win.media;
  island.className = [S.ai.top, S.settings?.island.mode === 'detach' ? 'detach' : 'attach', S.open ? 'open' : '', S.pinned ? 'pinned' : ''].join(' ');
  const phone = S.win.phones?.on && !m?.playing ? S.win.phones : null; // a phone playing through this PC (Windows)
  const mood = S.ai.top !== 'idle' ? S.ai.top : (m?.playing || phone ? 'music' : 'idle');
  // nothing to do and the pointer has not moved for 5 minutes: Pip rests (tired, slow breathing); 30 minutes
  // further on it falls properly asleep. Either way it wakes with a blink as soon as the pointer moves again.
  const idleFor = Date.now() - S.cursorAt;
  const resting = mood === 'idle' && !S.open && !S.hover && !S.alert && idleFor >= REST_AFTER && Date.now() >= S.awakeUntil;
  const sleeping = resting && idleFor >= SLEEP_AFTER;
  if (resting && !pip.classList.contains('resting') && S.pillDrawn) sfx('rest');
  if (!resting && pip.classList.contains('resting')) { sfx('wake'); pip.classList.add('waking'); clearTimeout(S.wakeTimer); S.wakeTimer = setTimeout(() => { pip.classList.remove('waking'); }, 700); }
  if (mood !== S.mood && S.pillDrawn && ['working', 'music'].includes(mood)) sfx(mood); // done, asking and error ring from their own events
  S.mood = mood; S.pillDrawn = true;
  const waking = pip.classList.contains('waking');
  // folded and truly idle: just the glowing eyes, as before. Open, or anything worth a mood, shows the mascot face.
  const emotion = emotionFor(mood, resting, sleeping, waking), plain = emotion === 'default' && !S.open;
  pip.className = 'pip ' + mood + (resting ? ' resting' : '') + (sleeping ? ' sleeping' : '') + (waking ? ' waking' : '') + (plain ? ' plain' : '') + (S.settings?.mascot.hat !== 'none' ? ' hat-' + S.settings?.mascot.hat : '');
  const faceKey = plain ? '' : emotion; // the key includes plain so opening/folding redraws the face even if the mood itself didn't change
  if (faceKey !== S.emotion) { S.emotion = faceKey; if (!plain) $('#pip-face').innerHTML = moodSvg(emotion); }
  // idle: only Pip and the clock. In use: what is happening. Open: the mascot's name as a title.
  let text = S.open ? (S.settings?.mascot.name || 'Pip') : '', side = clock(), note = '';
  const pillAsk = !S.open && top?.state === 'asking' && top.ask?.canAnswer ? top : null; // a permission: answer it right in the pill
  // past this length, the detail moves into the note below instead of squeezing (or ellipsis-ing) into the pill
  // row - the pill row's width never changes for it; the island grows taller instead (see the height block below)
  const NOTE_MAX = 44;
  if (pillAsk) {
    const detail = top.ask.detail || verb(top.ask.verb);
    if (detail.length > NOTE_MAX) { text = t('Allow?'); note = detail; } else text = `${t('Allow')}: ${detail}?`;
  }
  else if (top && top.state === 'asking') text = t('{agent} needs you', { agent: AGENT[top.agent] });
  else if (top && top.state === 'working') text = top.activity ? `${verb(top.activity.verb)} ${top.activity.detail}`.trim() : t('Working');
  else if (top && top.state === 'done') { // Pip relays what the agent actually said, not just that it finished
    const label = t('{agent} is done', { agent: AGENT[top.agent] });
    if (top.reply && top.reply.length > NOTE_MAX) { text = label; note = top.reply; } else text = top.reply || label;
  }
  else if (top && top.state === 'error') text = t('{agent} hit an error', { agent: AGENT[top.agent] });
  else if (S.recv) { text = t('Receiving {name}', { name: S.recv.name }); side = S.recv.pct + '%'; }
  else if (S.alert && !S.open) {
    const kind = S.alert.kind === 'call' ? t('Calling…') : S.alert.kind === 'meeting' ? t('Meeting soon') : t('Message');
    if (S.alert.from && S.alert.from.length > NOTE_MAX) { text = kind; note = S.alert.from; } else { text = S.alert.from; side = kind; }
  }
  else if (S.focus.running) { text = t('Focus'); side = time(S.focus.left * 1000); }
  else if (m?.playing) { text = m.artist && !S.notch ? `${m.title} · ${m.artist}` : m.title; side = ''; } // beside a notch: the title only, to stay compact; no clock while playing
  else if (phone) { text = t('Playing from {phone}', { phone: phone.name || t('Phone') }); side = ''; }
  if (top && (top.state === 'working' || top.state === 'asking' || top.state === 'done')) side = ''; // a task is running or just finished: the strip shows only that
  if (note) side = ''; // the note takes over the row below; the side slot (clock, kind word, ...) would be redundant
  $('#pill-text').textContent = text;
  island.classList.toggle('asking-pill', Boolean(pillAsk)); $('#pill-ask').hidden = !pillAsk;
  if (pillAsk) for (const b of $('#pill-ask').children) b.dataset.id = pillAsk.id; $('#pill-side').textContent = S.open ? clock() : side;
  if (S.open) {
    $('#pill-date').textContent = dateLabel(); drawNet();
    const u = S.ai.usage?.fiveHour; // the five-hour window is the one that runs out during a working day
    $('#pill-chip').textContent = u ? `${u.pct}%${u.resetsAt > Date.now() ? ' · ' + hms(u.resetsAt - Date.now()) : ''}` : '';
    const w = S.ai.usage?.sevenDay; // both windows on hover; the chip itself shows the one that runs out first
    $('#pill-chip').title = u ? `${t('Claude usage')}: ${t('5 hours')} ${u.pct}%${w ? ` · ${t('Week')} ${w.pct}%` : ''}` : '';
  }
  island.classList.toggle('alert-msg', (S.alert?.kind === 'message' || S.alert?.kind === 'meeting') && !S.open); island.classList.toggle('alert-call', S.alert?.kind === 'call' && !S.open);
  island.classList.toggle('notched', Boolean(S.notch)); // set again because className was rebuilt above
  island.classList.toggle('has-update', Boolean(S.update?.newer));
  island.dataset.tab = S.tab; document.documentElement.style.setProperty('--alpha', S.settings?.island.opacity ?? 1);
  document.documentElement.style.setProperty('--bright', S.settings?.island.brightness ?? 0.1);
  island.classList.toggle('bare', !S.open && !text && S.settings?.island.mode !== 'detach'); // attached and idle: only Pip in the notch
  // the shell's width and height are set in pixels so the change between sizes can be animated. The pill row's
  // width never grows for long text (a MacBook's camera notch leaves no room to spare beside it); instead the
  // island grows taller to fit the note below, the same way it already grows to reveal the open panel.
  const noteEl = $('#pill-note');
  noteEl.hidden = S.open || !note;
  let width;
  if (S.notch && !S.open) {
    // the window is centred on the screen, so the gap is too: both sides as wide as the wider one, eyes at the far left
    const inner = $('#pill-inner'), right = [...inner.children].filter(el => el.id !== 'pip' && el.id !== 'pill-gap' && el.offsetParent).reduce((w, el) => w + Math.max(el.scrollWidth, el.getBoundingClientRect().width) + 10, 0); // full width, not the squeezed one
    const side = Math.max(56, Math.min(150, Math.ceil(right) + 18)); // longer text ends in "…" rather than widening the pill row itself
    island.style.setProperty('--side', side + 'px'); width = S.notch.width + 2 * side;
  } else width = S.open ? null : Math.max(84, Math.min(440, Math.ceil($('#pill-inner').getBoundingClientRect().width) + 2));
  const NOTE_WIDTH = 300; // a comfortable reading width for the note - well clear of a notch, which only spans the pill row above it
  if (note && !S.open) width = Math.max(width, NOTE_WIDTH + 32);
  if (!S.open) { shell.style.width = width + 'px'; noteEl.textContent = note; shell.style.height = ((S.notch ? S.notch.height || 37 : 36) + (note ? noteEl.scrollHeight + 2 : 0)) + 'px'; }
  else { shell.style.width = ''; shell.style.height = ''; }
  const dot = tabs.querySelector('[data-tab=ai]'); if (dot) dot.classList.toggle('dot', S.ai.top === 'asking');
}

// ---------- pages ----------
const pages = {
  home() {
    const style = S.settings.homeStyle; if (style && style !== 'clock' && homes[style]) return homes[style]();
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
      <div class="hm-tiles"><div class="tile t-agent ${top ? top.state : ''}">${agent}</div>
        <div class="tile t-music">${art ? `<img class="tile-art" alt="" src="data:image/jpeg;base64,${esc(art)}">` : `<span class="tile-art">${icon('music')}</span>`}<div class="grow"><b>${esc(m ? songOf(m).title : t('Nothing is playing.'))}</b>${m && songOf(m).artist ? `<div class="sub">${esc(songOf(m).artist)}</div>` : ''}</div>
          ${m ? `<button class="round" data-media="toggle" aria-label="${esc(t('Play or pause'))}">${m.playing ? '❚❚' : '▶'}</button>` : ''}</div>
        <div class="tile t-focus${f.running ? ' run' : ''}"><span class="tile-art">${icon('focus')}</span><div class="grow"><span class="label">${esc(t('Focus'))}</span><b class="num" id="hm-focus">${time(f.left * 1000)}</b></div><button class="wbtn sm" data-focus="toggle">${esc(f.running ? t('Pause') : t('Start'))}</button></div></div></div>`;
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
    // not tied to a session: Pip has no way to know which terminal belongs to which agent, so this types into
    // whichever window you last had focused before opening the island - meant for a prompt at any time, not only
    // the brief moment canReply is true (that one goes through the hook and is the more reliable of the two).
    const sp = S.sendPrompt;
    const sendBox = `<div class="card send-term">
        <div class="row"><input type="text" class="grow" id="send-term" placeholder="${esc(t('Type a prompt, Pip sends it to your terminal…'))}" value="${esc(sp.text)}"><button class="btn primary" data-send-term ${sp.busy ? 'disabled' : ''}>${esc(sp.busy ? t('Sending…') : t('Send'))}</button></div>
        <p class="dim small">${esc(sp.error ? sp.error : sp.target ? t('Sent to {window}.', { window: sp.target }) : t('Goes to whichever window you had open before this - click into your terminal first.'))}</p></div>`;
    return `<h2>${esc(t('Sessions'))}</h2>${sendBox}${cards || `<div class="card dim">${esc(t('Nothing running. Start Claude Code or Codex in a terminal.'))}</div>`}<h2>${esc(t('History'))}</h2>${history || `<div class="dim">${esc(t('Finished jobs appear here.'))}</div>`}`;
  },
  music() {
    const m = S.win.media, sp = S.spotify, on = S.settings.lyrics;
    if (S.platform !== 'win32' && S.platform !== 'darwin') return `<div class="cl-empty">${esc(t('Music controls need Windows or a Mac.'))}</div>`; // the Mac reads Spotify and Music (mac-helper.js)
    const ph = S.win.phones;
    // a paired phone playing through this PC: Windows passes on the sound but not the song's name, so say which phone
    if (ph?.on && !m?.playing) return `<div class="mu"><span class="mu-art ph-art">${icon('phone')}<span class="eq"><i></i><i></i><i></i><i></i></span></span>
      <div class="mu-info"><span class="label">${esc(t('Playing from your phone'))}</span><h3 class="cut" title="${esc(ph.name)}">${esc(ph.name || t('Phone'))}</h3>
        <div class="mu-meta">${esc(t('The sound plays on this PC. Change songs on the phone.'))}</div>
        <div class="mu-foot">${ph.outputs?.list?.length ? `<label class="ph-out"><span>${esc(t('Plays on'))}</span><select id="output" aria-label="${esc(t('Plays on'))}">${ph.outputs.list.map(o => `<option value="${esc(o.id)}" ${o.id === ph.outputs.current ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}<button class="mu-chip" data-phone="">${icon('power')}${esc(t('Disconnect'))}</button></div></div></div>`;
    const phones = S.platform === 'win32' && ph ? (ph.list.length
      ? `<div class="ph-list"><span class="label">${esc(t('Play from your phone'))}</span>${ph.list.map(d => `<button class="mu-chip" data-phone="${esc(d.id)}">${icon('phone')}<span class="cut">${esc(d.name)}</span></button>`).join('')}</div>`
      : `<div class="mu-meta ph-hint">${esc(t('Pair your phone in Bluetooth settings to play its music here.'))}</div>`) : '';
    if (!m) return `<div class="mu"><span class="mu-art">${icon('music')}</span><div class="mu-info"><span class="label">${esc(t('Playing'))}</span><h3>${esc(t('Nothing is playing.'))}</h3>${phones}</div></div>`;
    const song = songOf(m), art = S.art?.key === m.title + '|' + m.artist ? S.art.data : '', year = S.years[song.title + '|' + song.artist];
    const controls = `<button class="mu-btn" data-media="prev" aria-label="${esc(t('Previous'))}">${icon('prev')}</button>
            <button class="mu-btn play" data-media="toggle" aria-label="${esc(t('Play or pause'))}">${icon(m.playing ? 'pause' : 'play')}</button>
            <button class="mu-btn" data-media="next" aria-label="${esc(t('Next'))}">${icon('next')}</button>`;
    void controls;
    if (on && S.lyrics?.length) return `<div class="mu lyr">${art ? `<img class="mu-art" alt="" src="data:image/jpeg;base64,${esc(art)}">` : `<span class="mu-art">${icon('music')}</span>`}
      <div class="lyr-side"><div class="lyr-list" id="lyr" title="${esc(t('Click a line to jump there'))}">${S.lyrics.map((l, i) => `<p data-seek-ms="${l.t}" data-n="${i}">${esc(l.text || '♪')}</p>`).join('')}</div>
        <div class="lyr-foot"><span class="lyr-t" id="pos"></span><div class="lyr-bar"><i id="lyr-fill"></i></div><span class="lyr-t">${m.durationMs ? time(m.durationMs) : ''}</span><button class="mu-chip on" data-lyrics>${icon('lyrics')}${esc(t('Lyrics'))}</button></div></div></div>`;
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
    if (sh?.on) return `<div class="tr"><div class="tr-qr"><img alt="QR" src="${esc(sh.qr)}"></div><div class="tr-side"><p>${esc(sh.anyNetwork ? t('Scan with your phone. Works on any network, encrypted end to end.') : t('Scan with your phone on the same Wi-Fi.'))} ${esc(t('Stops by itself after an hour.'))}${sh.anyNetwork ? '' : `<br><span class="mono">${esc(sh.url.replace(/^http:\/\//, '').replace(/\/[^/]+\/$/, ''))}</span>`}</p>
      ${sh.firewall === false ? `<button class="wbtn wide" data-share="firewall">${esc(t('Allow phones on this Wi-Fi'))}</button><p class="tr-hint">${esc(t('Windows Firewall is blocking phones. You approve this once.'))}</p>`
        : `<button class="wbtn wide" data-share="stop">${esc(t('Stop sharing'))}</button><p class="tr-hint">${esc(t('Page not loading? The phone must be on this Wi-Fi, not mobile data or a guest network.'))}</p>`}</div></div>`;
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
    const c = S.cal, now = new Date(), linked = /^https:\/\//.test(S.settings.calendarUrl || '');
    const head = c.view === 'day' ? t('Today') : now.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
    const seg = `<div class="seg2"><button class="${c.view === 'day' ? 'on' : ''}" data-cal-view="day">${esc(t('Day'))}</button><button class="${c.view === 'month' ? 'on' : ''}" data-cal-view="month">${esc(t('Month'))}</button></div>`;
    const signIn = S.google ? '' : `<div class="cal-foot"><button class="gbtn" data-google-in>${googleG()}${esc(t('Sign in with Google'))}</button><button class="linkbtn" data-settings>${esc(t('Other calendar'))}</button></div>`;
    let events = S.google ? c.events : (S.event ? [S.event] : (linked ? [] : null)); // the iCal link gives only the next event
    const today = (events || []).filter(e => sameDay(e.start, now) || (e.start < now && e.end > now));
    const next = today.find(e => (e.end || e.start) > Date.now()) || (!S.google && S.event && S.event.start > Date.now() ? S.event : null);
    const title = c.error ? c.error : events === null ? (S.google ? '' : t('No calendar linked.')) : next ? next.title : t('Nothing planned');
    const sub = next ? (next.allDay ? t('All day') : `${clock(new Date(next.start))}${next.end ? ' – ' + clock(new Date(next.end)) : ''}${sameDay(next.start, now) ? '' : ' · ' + new Date(next.start).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}`) : '';
    if (c.view === 'month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), lead = (first.getDay() + 6) % 7; // weeks start on Monday
      const busy = new Set((events || []).map(e => new Date(e.start).getDate()));
      const names = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: 'narrow' }));
      const cells = [...Array(lead)].map(() => '<span></span>').concat([...Array(days)].map((_, i) => `<span class="${i + 1 === now.getDate() ? 'today' : ''} ${busy.has(i + 1) ? 'busy' : ''}">${i + 1}</span>`));
      return `<div class="cal2"><div class="cal-top"><span class="label">${esc(head)}</span>${seg}</div>
        <div class="month"><div class="month-names">${names.map(n => `<span>${esc(n)}</span>`).join('')}</div><div class="month-days">${cells.join('')}</div></div>${signIn}</div>`;
    }
    const H0 = 8, H1 = 20, pct = ms => { const d = new Date(ms); return Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60) - H0) / (H1 - H0) * 100)); };
    const blocks = today.filter(e => !e.allDay).map(e => `<i class="ev" data-left="${pct(e.start)}" data-w="${Math.max(1.2, pct(e.end || e.start + 1800e3) - pct(e.start))}" title="${esc(e.title)}"></i>`).join('');
    const ticks = []; for (let h = H0; h <= H1; h++) ticks.push(`<i class="${(h - H0) % 4 ? '' : 'major'}" data-left="${(h - H0) / (H1 - H0) * 100}"></i>${(h - H0) % 4 ? '' : `<span data-left="${(h - H0) / (H1 - H0) * 100}">${String(h).padStart(2, '0')}:00</span>`}`);
    return `<div class="cal2"><div class="cal-top"><span class="label">${esc(head)}</span>${seg}</div>
      <h3 class="cal-title cut">${esc(title)}</h3><div class="cal-sub">${esc(sub)}</div>
      <div class="timeline">${blocks}${ticks.join('')}<i class="now" id="cal-now" data-left="${pct(Date.now())}"></i></div>${signIn}</div>`;
  },
  mail() {
    const m = S.mail;
    if (!S.google) return `<div class="ml"><span class="ml-ico">${icon('mail')}</span><p>${esc(t('{name} only sees how many. Not who, and not what.', { name: 'Pip' }))}</p><button class="gbtn" data-google-in>${googleG()}${esc(t('Sign in with Google'))}</button></div>`;
    return `<div class="ml"><div class="ml-count">${m.count === null ? '–' : m.count}</div><p>${esc(m.error || (m.count === 1 ? t('unread email in your inbox') : t('unread emails in your inbox')))}</p>
      <button class="gbtn" data-inbox>${icon('mail')}${esc(t('Open Gmail'))}</button><p class="ml-note">${esc(t('{name} only sees how many. Not who, and not what.', { name: 'Pip' }))}</p></div>`;
  },
  pip() {
    const c = S.chat, name = S.settings.mascot.name || 'Pip', connected = S.agents.claude || S.agents.codex;
    const quick = [['explain', t('Explain what I copied')], ['spell', t('Check my spelling')], ['translate', t('Translate to English')], ['sw', t('Translate to Swahili')]];
    const log = c.log.length ? c.log.map(m => `<div class="msg ${m.role === 'pip' ? 'bot' : 'me'}${m.error ? ' bad' : ''}">${m.role === 'pip' ? '<span class="pa-pip sm"><i></i><i></i></span>' : ''}<div class="bubble">${m.screen ? `<span class="label">${esc(t('With my screen'))}</span>` : ''}${richText(m.text)}</div></div>`).join('')
        + (c.busy ? '<div class="msg bot"><span class="pa-pip sm"><i></i><i></i></span><div class="bubble typing"><i></i><i></i><i></i></div></div>' : '')
      : `<div class="pa-hello"><span class="pa-pip"><i></i><i></i></span><div><b>${esc(t('Hi, I am {name}.', { name }))}</b><span>${esc(t('Ask me anything. {agent} answers, through your own login, right here.', { agent: AGENT[S.settings.buddyAgent] || 'Claude Code' }))}</span></div></div>
        <div class="pa-quick">${quick.map(([id, label]) => `<button class="chip" data-quick="${id}">${esc(label)}</button>`).join('')}</div>
        ${connected ? '' : `<p class="pa-note">${esc(t('No agent connected yet.'))} <button class="linkbtn" data-connect>${esc(t('Connect Claude Code'))}</button></p>`}`;
    return `<div class="pc"><div class="pc-log${c.log.length ? '' : ' empty'}" id="pc-log">${log}</div>
      <div class="pc-in"><button class="pc-icon${c.screen ? ' on' : ''}" data-chat-screen title="${esc(t('Include my screen'))}" aria-label="${esc(t('Include my screen'))}">${icon('ask')}</button>
        <textarea id="pa-q" rows="1" placeholder="${esc(t('Ask Pip anything…'))}"></textarea>
        ${c.log.length ? `<button class="pc-icon" data-chat-new title="${esc(t('New chat'))}" aria-label="${esc(t('New chat'))}">${icon('plus')}</button>` : ''}
        <button class="pc-send" data-chat-send ${c.busy ? 'disabled' : ''} aria-label="${esc(t('Send'))}">${icon('send')}</button></div></div>`;
  },
  ask() {
    const a = S.ask;
    return `<h2>${esc(t('Ask about your screen'))}</h2><div class="dim small">${esc(t('{name} takes one screenshot and asks {agent} through your own login.', { name: S.settings.mascot.name, agent: AGENT[S.settings.buddyAgent] }))}</div>
      <div class="shots" id="shots"><button class="shot ${a.pick ? '' : 'on'}" data-pick=""><span class="shot-img whole">${icon('apps')}</span><span class="shot-name">${esc(t('Whole screen'))}</span></button>${a.windows.map(w => `<button class="shot ${a.pick === w.id ? 'on' : ''}" data-pick="${esc(w.id)}" title="${esc(w.name)}"><img class="shot-img" alt="" src="${esc(w.thumb)}"><span class="shot-name">${esc(w.name)}</span></button>`).join('')}</div>
      <textarea id="question" rows="2" placeholder="${esc(t('What does this error mean?'))}"></textarea><br><br><button class="btn primary" id="ask-go" ${a.busy ? 'disabled' : ''}>${esc(a.busy ? t('Looking…') : t('Ask'))}</button>
      ${a.error ? `<div class="card" data-kind="error">${esc(a.error)}</div>` : ''}${a.text ? `<div class="card answer">${esc(a.text)}</div>` : ''}`;
  }
};

// ---------- Home's other layouts (picked in the welcome or in Settings) ----------
const R = 34, CIRC = 2 * Math.PI * R;
/** A round dial: a faint ring with an arc for 0..1, the value in the middle. */
const dial = (id, frac, value, label, color) => `<div class="dial"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${R}" class="dial-track"/>
  <circle cx="42" cy="42" r="${R}" class="dial-arc ${color}" id="${id}" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1)}" transform="rotate(-90 42 42)"/></svg>
  <b id="${id}-n">${esc(value)}</b><span class="label">${esc(label)}</span></div>`;
function homeBits() {
  const top = S.ai.sessions[0], m = S.win.media, f = S.focus, u = S.ai.usage?.fiveHour, w = S.weather, e = S.event;
  return { top, m, f, u, w, e, song: m ? songOf(m) : null, art: m && S.art?.key === m.title + '|' + m.artist ? S.art.data : '' };
}
const homes = {
  dials() {
    const { top, m, f, u, w } = homeBits();
    return `<div class="hd"><div class="hd-left"><div class="hm-clock sm" id="hm-clock"></div><div class="hm-sub">${esc(dateLabel())}${w ? ` · ${w.temp}${esc(w.unit)} ${esc(weatherName(w.code))}` : ''}</div>
        <div class="hd-agent"><span class="dotst ${top ? top.state : ''}"></span>${esc(top ? `${AGENT[top.agent]} · ${stateName(top.state)}` : t('No agent session yet.'))}</div></div>
      <div class="hd-dials">${dial('d-use', u ? u.pct / 100 : 0, u ? u.pct + '%' : '–', t('Usage'), 'a-use')}
        ${dial('d-focus', f.total ? f.left / f.total : 0, time(f.left * 1000), t('Focus'), 'a-focus')}
        ${dial('d-song', m?.durationMs ? mediaPosition() / m.durationMs : 0, m ? time(mediaPosition()) : '–', t('Music'), 'a-song')}</div></div>`;
  },
  colours() {
    const { top, f, e, song, art } = homeBits();
    return `<div class="hc"><button class="hc-tile c-agent" data-tab-go="ai"><span class="label">${esc(t('Agents'))}</span><b>${esc(top ? stateName(top.state) : t('Idle'))}</b><small class="cut">${esc(top ? (top.activity ? `${verb(top.activity.verb)} ${top.activity.detail}` : top.project) : t('Nothing running.'))}</small></button>
      <button class="hc-tile c-music" data-tab-go="music">${art ? `<img alt="" src="data:image/jpeg;base64,${esc(art)}">` : ''}<span class="label">${esc(t('Music'))}</span><b class="cut">${esc(song ? song.title : t('Nothing is playing.'))}</b><small class="cut">${esc(song?.artist || '')}</small></button>
      <button class="hc-tile c-focus" data-tab-go="focus"><span class="label">${esc(t('Focus'))}</span><b class="num" id="hm-focus">${time(f.left * 1000)}</b><small>${esc(f.running ? t('Running') : t('Ready'))}</small></button>
      <button class="hc-tile c-cal" data-tab-go="calendar"><span class="label">${esc(t('Next'))}</span><b class="cut">${esc(e ? e.title : t('Nothing planned'))}</b><small>${e ? esc(new Date(e.start).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', ...clockFmt() })) : ''}</small></button></div>`;
  },
  apps() {
    const hidden = new Set(S.settings.hiddenTabs || []);
    return `<div class="ha"><div class="ha-left"><div class="hm-clock sm" id="hm-clock"></div><div class="hm-sub">${esc(dateLabel())}</div></div>
      <div class="ha-grid">${tabList().filter(([id]) => id !== 'home' && !hidden.has(id)).map(([id, name]) => `<button data-tab-go="${id}"><span>${icon(id)}</span><b>${esc(name)}</b></button>`).join('')}</div></div>`;
  }
};

// ---------- donating: any amount, through EvPay. Opened from Settings' Support tab (api.onBuy) ----------
S.buy = { phone: '', order: '', method: '', operator: '', error: '', busy: false, amount: 5000, custom: '', status: '' };
const OPERATOR_NAMES = { Mpesa: 'M-Pesa', TigoPesa: 'Mixx by Yas', AirtelMoney: 'Airtel Money', HaloPesa: 'HaloPesa' };
const DONATE_PRESETS = [2000, 5000, 10000];
const donateAmount = () => { const c = Math.round(Number(S.buy.custom)); return c > 0 ? c : S.buy.amount; };
// the donate page's own Pip icon: excited while picking/typing an amount, thinking while a payment is pending,
// all smiles once it's paid (which also bursts confetti, in pollOrder)
function buyMood() {
  const b = S.buy, L = S.license || {};
  if (b.status === 'paid') return 'smiling';
  if (b.error) return 'angry';
  if (b.order) return 'curious';
  if (!L.signedIn) return 'default';
  return 'happy';
}
function buyPage() {
  const L = S.license || {}, b = S.buy, price = n => 'TSh ' + Number(n).toLocaleString('en'), amt = donateAmount();
  let right;
  if (b.status === 'paid') right = `<div class="by-ok">${icon('check')}<b>${esc(t('Thank you! Your donation means a lot.'))}</b></div>`;
  else if (!L.signedIn) right = `<p class="by-note">${esc(t('Sign in to your Pip account first, so we know whose donation this is.'))}</p>
      <button class="wbtn wide" data-buy-signin>${esc(t('Sign in first'))}</button>`;
  else if (b.order) right = `<div class="by-wait"><span class="by-spin"></span><b>${esc(b.method === 'card' ? t('Finish paying on the page that opened in your browser.') : t('Approve the payment on your phone ({network}).', { network: OPERATOR_NAMES[b.operator] || b.operator }))}</b></div>
      <p class="by-note">${esc(t('We will record it as soon as it goes through.'))}</p><button class="wbtn ghost sm" data-buy-cancel>${esc(t('Cancel'))}</button>`;
  else right = `<div class="by-amts">${DONATE_PRESETS.map(a => `<button type="button" class="by-amt ${!b.custom && b.amount === a ? 'on' : ''}" data-donate-amt="${a}">${esc(price(a))}</button>`).join('')}
      <input type="number" id="by-custom" min="0" step="500" placeholder="${esc(t('Other amount (TSh)'))}" value="${esc(b.custom)}"></div>
      <label class="by-lab" for="by-phone">${esc(t('Pay with mobile money'))}</label>
      <div class="by-row"><input id="by-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX" value="${esc(b.phone)}"><button class="wbtn" data-pay-mobile ${b.busy ? 'disabled' : ''}>${esc(b.busy ? t('Sending…') : t('Donate {price}', { price: price(amt) }))}</button></div>
      <p class="by-note">M-Pesa · Mixx by Yas · Airtel Money · HaloPesa</p>
      <div class="by-or"><span>${esc(t('or'))}</span></div>
      <button class="by-card" data-pay-card ${b.busy ? 'disabled' : ''}>${icon('card')}<b>${esc(t('Donate by card'))}</b><span>Visa · Mastercard</span>${icon('external')}</button>`;
  return `<div class="by"><div class="by-l"><span class="by-pip"><span class="face">${moodSvg(buyMood())}</span></span><h3>${esc(t('Support Pip'))}</h3>
      <p>${esc(t('Any amount helps keep Pip going.'))}</p></div>
    <div class="by-r">${right}${b.error ? `<p class="by-err">${esc(b.error)}</p>` : ''}</div></div>`;
}
// while a donation is pending: ask every four seconds, for up to ten minutes
async function pollOrder(ref) {
  for (let i = 0; i < 150 && S.buy.order === ref; i++) {
    await new Promise(r => setTimeout(r, 4000));
    if (S.buy.order !== ref) return;
    const r = await api.donateOrder(ref);
    if (!r?.ok) continue;
    if (r.status === 'paid') { S.buy = { ...S.buy, order: '', status: 'paid', error: '' }; if (!typing()) draw(true); confetti(); return; }
    if (r.status === 'failed' || r.status === 'refunded') { S.buy = { ...S.buy, order: '', error: t('The payment did not go through. Try again.') }; if (!typing()) draw(true); return; }
  }
  if (S.buy.order === ref) { S.buy = { ...S.buy, order: '', error: t('No answer from the payment yet. If you paid, it will still be recorded shortly.') }; draw(true); }
}
async function startPay(kind) {
  if (kind === 'mobile') S.buy.phone = $('#by-phone')?.value.trim() || '';
  S.buy = { ...S.buy, busy: true, error: '', status: '' }; draw(true);
  const amount = donateAmount();
  const r = kind === 'mobile' ? await api.donateMobile(S.buy.phone, '', amount) : await api.donateCard(amount);
  S.buy.busy = false;
  if (!r?.ok) { S.buy.error = r?.error || t('The payment could not be started.'); return draw(true); }
  S.buy = { ...S.buy, order: r.order, method: kind, operator: r.operator || '' }; draw(true); pollOrder(r.order);
}

const FILL = new Set(['buy', 'home', 'pip', 'music', 'mail', 'focus', 'modes', 'tray', 'note', 'calendar']); // pages laid out to the panel's full size, without scrolling
let lastHtml = '';
function draw(force) {
  drawPill();
  if (!S.open || S.dragging || (!force && (!LIVE.has(S.tab) || typing()))) return;
  page.classList.toggle('fill', FILL.has(S.tab));
  const html = S.tab === 'buy' || (S.license?.locked && !FREE.has(S.tab)) ? buyPage() : pages[S.tab]();
  if (html === lastHtml && page.childElementCount) { tick(); return; } // same page as on screen: rebuilding it only made it flicker
  lastHtml = html; page.innerHTML = html;
  for (const el of page.querySelectorAll('[data-w]')) el.style.width = el.dataset.w + '%';
  for (const el of page.querySelectorAll('[data-left]')) el.style.left = el.dataset.left + '%';
  for (const el of page.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  for (const el of page.querySelectorAll('[data-center]')) { el.style.justifyContent = 'center'; el.style.textAlign = 'center'; el.style.margin = '10px 0'; }
  for (const el of page.querySelectorAll('[data-kind=error]')) el.style.color = 'var(--error)';
  for (const el of page.querySelectorAll('[data-flat]')) el.style.margin = '0';
  if (S.tab === 'note') drawNoteSide();
  if (S.tab === 'pip') { const lg = $('#pc-log'); if (lg) lg.scrollTop = lg.scrollHeight; growChat(); }
  if (S.tab === 'ask') shotFades();
  tick();
}
function drawTabs() {
  const hidden = new Set(S.settings?.hiddenTabs || []);
  tabs.innerHTML = tabList().filter(([id]) => id === 'home' || !hidden.has(id)).map(([id, name]) => `<button type="button" data-tab="${id}" data-tip="${esc(name)}" aria-label="${esc(name)}" class="${id === S.tab ? 'on' : ''}${S.license?.locked && !FREE.has(id) ? ' locked' : ''}">${icon(id)}<b>${esc(name)}</b></button>`).join('');
  const gear = $('#bar-bright'), vol = $('#bar-vol');
  gear.innerHTML = icon('sun'); gear.dataset.tip = t('Background brightness'); gear.setAttribute('aria-label', t('Background brightness')); $('#bright-ico').innerHTML = icon('sun');
  vol.innerHTML = icon('volume'); vol.dataset.tip = t('Volume'); vol.setAttribute('aria-label', t('Volume'));
  $('#vol-ico').innerHTML = icon('volume'); $('#pill-ask .pa-allow').textContent = t('Allow'); $('#pill-ask .pa-deny').textContent = t('Deny'); $('#pill-more').innerHTML = icon('dots'); $('#pill-more').setAttribute('aria-label', t('Menu'));
  drawPill();
}
function go(tab) {
  lastHtml = '';
  S.tab = tab; showMenu(false); drawTabs(); draw(true); hideTip();
  page.classList.remove('in'); void page.offsetWidth; page.classList.add('in'); // the short entrance, only when the tab changes
  clearTimeout(go.t); go.t = setTimeout(() => page.classList.remove('in'), 450); // gone before any redraw, which would replay it
  if (tab === 'home') refreshHome();
  if (tab === 'calendar') refreshCalendar();
  if (tab === 'mail') refreshMail();
  if (tab === 'ask') api.windows().then(list => { S.ask.windows = list || []; if (S.tab === 'ask' && !typing()) draw(true); });
  if (tab === 'music' && S.spotify.on) refreshDevices();
}
/** Opens the preview or folds back to the pill. The page is drawn before opening and left in place while closing,
    so the morph never shows an empty panel. */
function setOpen(open, tab) {
  if (open === S.open) return;
  S.open = open; sfx(open ? 'open' : 'fold');
  // Home every time it opens, unless something asked for a tab, a donation is still waiting on the browser, or it
  // folded away on the lyrics while the song plays on
  if (open) go(tab || (S.buy.order ? 'buy' : S.license?.locked ? 'ai' : S.backToLyrics && S.settings?.lyrics && S.win.media?.playing ? 'music' : 'home'));
  else { S.backToLyrics = S.tab === 'music' && Boolean(S.settings?.lyrics); S.pinned = false; S.auto = false; showMenu(false); showVolume(false); showBright(false); hideTip(); if (document.hasFocus()) { document.activeElement?.blur?.(); api.focus(false); } drawPill(); }
}
function openSettings() { api.openSettings(); setOpen(false); }

// ---------- the menu behind the dots, the volume pop-up and the tooltips over the bar ----------
function showMenu(on, view = 'main') {
  S.menu = on; S.menuView = view; menu.hidden = !on; if (!on) return;
  const v = S.win.volume, back = title => `<div class="mn-head"><button class="mn-back" data-menu="main" aria-label="${esc(t('Back'))}">${icon('back')}</button><b>${esc(title)}</b></div>`;
  const tile = (id, ico, name, cls = '') => `<button class="mn-tile ${cls}" data-menu="${id}">${icon(ico)}<span>${esc(name)}</span></button>`;
  if (view === 'apps') menu.innerHTML = back(t('All apps')) + `<div class="mn-grid four mn-scroll">${tabList().map(([id, name]) => `<button class="mn-tile" data-menu-tab="${id}">${icon(id)}<span>${esc(name)}</span></button>`).join('')}</div>`;
  else if (view === 'customize') {
    const hidden = new Set(S.settings.hiddenTabs || []);
    menu.innerHTML = back(t('Customize')) + `<div class="mn-list mn-scroll">${tabList().filter(([id]) => id !== 'home').map(([id, name]) => `<div class="mn-row">${icon(id)}<span>${esc(name)}</span><button class="sw ${hidden.has(id) ? '' : 'on'}" data-hide="${id}" aria-label="${esc(name)}"></button></div>`).join('')}</div>`;
  }
  else if (view === 'updates') {
    const u = S.update;
    menu.innerHTML = back(t('Updates')) + `<div class="mn-upd">${!u ? esc(t('Checking…')) : !u.ok ? esc(t('Could not check: {error}', { error: u.error })) : u.newer
      ? `<b>${esc(u.latest === u.current ? t('A new Pip is ready') : t('Pip {version} is out', { version: u.latest }))}</b><button class="wbtn sm" data-release="${esc(u.url)}">${esc(t('Download'))}</button>` : esc(t('You have the newest Pip ({version}).', { version: u.current }))}</div>`;
  }
  else menu.innerHTML = (v ? `<div class="mn-vol">${icon('volume')}<input type="range" id="mvol" min="0" max="100" value="${v.level}" aria-label="${esc(t('Volume'))}"></div>` : '')
    + `<div class="mn-grid">${tile('apps', 'apps', t('All apps'))}${tile('customize', 'pencil', t('Customize'))}${tile('settings', 'gear', t('Settings'))}${tile('updates', 'refresh', t('Updates'), S.update?.newer ? 'new' : '')}${tile('fold', 'up', t('Fold in'))}${tile('quit', 'power', t('Quit'), 'quit')}</div>`;
  const mv = $('#mvol'); if (mv) mv.style.setProperty('--fill', mv.value + '%');
  menuFades();
}
/** Lists in the menu fade at the top or bottom only while there is more to scroll that way. */
function menuFades() {
  for (const el of menu.querySelectorAll('.mn-scroll')) { el.classList.toggle('fade-t', el.scrollTop > 2); el.classList.toggle('fade-b', el.scrollHeight - el.clientHeight - el.scrollTop > 2); }
}
menu.addEventListener('scroll', menuFades, true);
function showBright(on) {
  S.bright = on; $('#bright-pop').hidden = !on; $('#bar-bright').classList.toggle('on', on);
  if (on) { const v = Math.round((S.settings.island.brightness ?? 0.1) * 100); $('#qbright').value = v; $('#qbright-n').textContent = v + '%'; }
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
  // centred over the button, but kept inside the bar: the end buttons (brightness, volume) cut it off otherwise
  tip.textContent = b.dataset.tip; const half = tip.offsetWidth / 2, edge = 8;
  tip.style.left = Math.max(edge + half, Math.min(base.width - edge - half, r.left + r.width / 2 - base.left)) + 'px'; tip.classList.add('show');
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
  drawPill();
  if (inside) { if (!S.open && S.settings?.island.openOn !== 'click') openTimer = setTimeout(() => setOpen(true), 70); } // 'click': only a click opens it
  else closeTimer = setTimeout(maybeClose, 280);
}
function maybeClose() { if (S.open && !S.hover && !S.pinned && !S.dragging && !S.menu && !typing() && !(S.auto && S.ai.top === 'asking')) setOpen(false); }

function second() {
  if (S.focus.running) {
    S.focus.left--;
    if (S.focus.left <= 0) {
      S.focus.running = false; S.focus.left = S.focus.total; sfx('focus');
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
  const df = $('#d-focus'); if (df) { df.setAttribute('stroke-dashoffset', (CIRC * (1 - (S.focus.total ? S.focus.left / S.focus.total : 0))).toFixed(1)); $('#d-focus-n').textContent = time(S.focus.left * 1000); }
  const ds = $('#d-song'), mm = S.win.media; if (ds && mm?.durationMs) { const p = mediaPosition(); ds.setAttribute('stroke-dashoffset', (CIRC * (1 - p / mm.durationMs)).toFixed(1)); $('#d-song-n').textContent = time(p); }
  const m = S.win.media;
  if (m && S.tab === 'music') {
    const pos = mediaPosition(), sk = $('#seek'), n = $('#pos');
    if (sk && !seeking) { sk.value = pos; sk.style.setProperty('--fill', (m.durationMs ? Math.min(100, 100 * pos / m.durationMs) : 0) + '%'); }
    if (n && !seeking) n.textContent = time(pos);
    const lines = S.lyrics || [], at = pos + 250; // a quarter second early, so the line is there as it is sung
    let i = -1; while (i + 1 < lines.length && lines[i + 1].t <= at) i++;
    const now = $('#ly-now');
    if (now) now.textContent = lines.length ? (lines[i]?.text || '♪') : (S.lyrics === null && S.lyricsFor ? t('Looking for lyrics…') : t('No lyrics for this song.'));
    const box = $('#lyr');
    if (box && box.dataset.i !== String(i)) {
      const first = box.dataset.i === undefined; box.dataset.i = i;
      box.querySelector('p.now')?.classList.remove('now');
      const p = box.children[i]; if (p) p.classList.add('now');
      if (Date.now() - lyrUserAt > 3500) { const el = p || box.children[0]; if (el) box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: first ? 'auto' : 'smooth' }); }
    }
    const lf = $('#lyr-fill'); if (lf && m.durationMs) lf.style.width = Math.min(100, 100 * pos / m.durationMs) + '%';
  }
  const fl = $('#focus-left'), fd = $('#focus-done'), mark = $('#ruler-mark'), ml = $('#mode-left');
  if (fl) fl.textContent = time(S.focus.left * 1000);
  if (fd) fd.textContent = t('Done at {time}', { time: clock(new Date(Date.now() + S.focus.left * 1000)) });
  if (mark) mark.style.left = Math.min(100, S.focus.left / 36) + '%'; // 60 minutes = 3600 s = 100%
  if (ml) ml.textContent = time(S.focus.left * 1000);
  const cn = $('#cal-now'); if (cn) { const d = new Date(); cn.style.left = Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60) - 8) / 12 * 100)) + '%'; }
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

async function refreshCalendar() {
  if (!S.google) { S.event = await api.calendar(); S.calLoaded = true; S.cal.error = ''; return draw(); }
  const now = new Date(), from = S.cal.view === 'day' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = S.cal.view === 'day' ? new Date(from.getTime() + 86400e3) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const r = await api.googleEvents(from.getTime(), to.getTime()); S.cal.events = r.ok ? r.events : []; S.cal.error = r.ok ? '' : r.error; draw();
}
async function refreshMail() {
  if (!S.google || Date.now() - S.mail.at < 60e3) return draw(); // at most once a minute
  const r = await api.googleUnread(); S.mail = { count: r.ok ? r.count : S.mail.count, error: r.ok ? '' : r.error, at: Date.now() }; draw();
}
async function signInGoogle() {
  S.cal.error = t('Finish the login in your browser…'); draw(true);
  const r = await api.googleLogin(); S.cal.error = '';
  if (r.ok) { S.google = true; S.mail.at = 0; if (S.tab === 'mail') refreshMail(); else refreshCalendar(); }
  else if (r.needsClient) openSettings();
  else { S.cal.error = r.error; S.mail.error = r.error; draw(true); }
}
/** The screenshot strip fades out at an edge only while there is more to scroll that way. */
function shotFades() {
  const el = $('#shots'); if (!el) return;
  const more = el.scrollWidth - el.clientWidth - el.scrollLeft;
  el.classList.toggle('fade-l', el.scrollLeft > 2); el.classList.toggle('fade-r', more > 2);
}
page.addEventListener('scroll', e => { if (e.target.id === 'shots') shotFades(); }, true);
page.addEventListener('wheel', e => { const el = e.target.closest?.('#shots'); if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollLeft += e.deltaY; } }, { passive: false });

// ---------- music: the glow takes the artwork's main colour ----------
/** The most vivid common colour of a picture: a 24 x 24 copy, pixels weighted by how colourful they are. */
function artColor(b64) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 24; const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 24, 24); const px = g.getImageData(0, 0, 24, 24).data;
        let r = 0, gr = 0, b = 0, w = 0;
        for (let i = 0; i < px.length; i += 4) {
          const R = px[i], G = px[i + 1], B = px[i + 2], max = Math.max(R, G, B), min = Math.min(R, G, B);
          const k = ((max - min) / 255) ** 2 * (max > 30 ? 1 : 0) + 0.02; // greys and near-black count for little
          r += R * k; gr += G * k; b += B * k; w += k;
        }
        const col = [r / w, gr / w, b / w], top = Math.max(...col) || 1, lift = Math.min(2.2, 220 / top); // bright enough to glow
        resolve(`rgb(${col.map(v => Math.round(Math.min(255, v * lift))).join(',')})`);
      } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = 'data:image/jpeg;base64,' + b64;
  });
}
async function applyArtColor() {
  const m = S.win.media, art = m && S.art?.key === m.title + '|' + m.artist ? S.art.data : '';
  const col = art && S.settings?.island.artGlow !== false ? await artColor(art) : '';
  if (col) island.style.setProperty('--art', col); else island.style.removeProperty('--art');
}
// Wi-Fi and Bluetooth after the date: lit when on, dim when off; a click switches the radio
let netKey = '';
function drawNet() {
  const n = S.settings?.island.radios === false ? null : S.win.net, box = $('#pill-net'), key = JSON.stringify(n || null); if (key === netKey) return; netKey = key;
  const b = (kind, ico, on, tip) => `<button type="button" class="net ${on ? 'on' : ''}" data-radio-kind="${kind}" data-on="${on ? 1 : 0}" title="${esc(tip)}" aria-label="${esc(tip)}">${icon(ico)}</button>`;
  box.innerHTML = (n?.wifi ? b('WiFi', 'wifi', n.wifi.on, n.wifi.on ? (n.wifi.ssid ? 'Wi-Fi · ' + n.wifi.ssid : 'Wi-Fi') : t('Wi-Fi is off')) : '')
    + (n?.bt ? b('Bluetooth', 'bt', n.bt.on, n.bt.on ? 'Bluetooth' : t('Bluetooth is off')) : '');
}
async function refreshHome() { const [w, e] = await Promise.all([api.weather(), api.calendar()]); S.weather = w && !w.error ? w : null; S.event = e; draw(); }
async function refreshDevices() { const r = await api.spotifyDevices(); S.spotify = { on: r.ok || r.connected !== false, devices: r.devices || [], error: r.ok ? '' : r.error }; draw(); }
async function refreshLyrics() {
  const m = S.win.media, key = m ? m.title + '|' + m.artist : '';
  if (key === S.lyricsFor && !(S.lyrics === null && key && Date.now() - S.lyricsAt > 60e3)) return; // a failed lookup is tried again after a minute
  S.lyricsFor = key; S.lyrics = null; S.lyricsAt = Date.now();
  if (m && S.settings.lyrics) {
    const lines = await api.lyrics({ title: m.title, artist: m.artist, durationSec: Math.round((m.durationMs || 0) / 1000) });
    if (S.lyricsFor !== key) return;
    S.lyrics = Array.isArray(lines) ? lines : null; // null: lrclib could not be reached
    if (S.lyrics?.length && !(S.art?.key === key && S.art.data && S.art.data.length > 3000)) api.fillArt(key); // a song with lyrics is a real song: find its cover
    if (S.tab === 'music' && !typing()) draw(true); // show them as soon as they arrive, not at the next update
  }
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
// typed any time, not tied to a session: see the comment above sendBox in pages.ai()
async function sendToTerminal() {
  const text = S.sendPrompt.text.trim(); if (!text || S.sendPrompt.busy) return;
  S.sendPrompt = { ...S.sendPrompt, busy: true, error: '', target: '' }; draw(true);
  const r = await api.sendPrompt(text);
  S.sendPrompt = { text: r?.ok ? '' : text, busy: false, target: r?.target || '', error: r?.ok ? '' : (r?.error || t('Could not send that.')) };
  draw(true);
}

// ---------- Pip's chat: the agent you already use answers here, through its own program and your login ----------
function growChat() { const q = $('#pa-q'); if (!q) return; q.style.height = 'auto'; q.style.height = Math.min(96, q.scrollHeight) + 'px'; }
function redrawChat() {
  const q = $('#pa-q'), text = q?.value || '', focused = document.activeElement === q;
  draw(true); const n = $('#pa-q'); if (n) { n.value = text; growChat(); if (focused) n.focus(); }
}
async function sendChat() {
  const q = $('#pa-q'), text = q?.value.trim(); if (!text || S.chat.busy) return;
  const screen = S.chat.screen;
  S.chat.log.push({ role: 'me', text, screen }); S.chat.busy = true; S.chat.screen = false; q.value = ''; redrawChat();
  const r = screen ? await api.ask(text, null) : await api.chat(S.chat.log.filter(m => !m.error).slice(-12).map(m => ({ role: m.role, text: m.text })));
  S.chat.busy = false;
  S.chat.log.push(r?.ok ? { role: 'pip', text: r.text } : { role: 'pip', text: r?.error || t('No answer.'), error: true });
  if (S.tab === 'pip') redrawChat();
}

// ---------- a file coming in from the phone: progress in the pill, confetti when it lands ----------
function drawRecv() {
  const bar = $('#recv'); bar.hidden = !S.recv; if (S.recv) $('#recv-fill').style.width = S.recv.pct + '%';
  drawPill();
}
function confetti() {
  sfx('sparkle');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('#confetti'), g = c.getContext('2d'), W = c.width = innerWidth, H = c.height = innerHeight;
  const r = shell.getBoundingClientRect(), ox = r.left + r.width / 2, oy = r.top + Math.min(r.height, 36) / 2;
  const cols = [getComputedStyle(document.documentElement).getPropertyValue('--pip').trim() || '#7c5cff', '#ffd23f', '#2fbf71', '#ff5c8a', '#2f9bff', '#ffffff'];
  const bits = [...Array(90)].map(() => { const a = Math.PI * (-0.2 + Math.random() * 1.4), v = 3 + Math.random() * 6; // a wide burst, sideways and down (the window ends at the top of the screen)
    return { x: ox, y: oy, vx: Math.cos(a) * v * 1.3, vy: Math.sin(a) * v * 0.55, s: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.floor(Math.random() * cols.length)] }; });
  c.hidden = false; const t0 = performance.now();
  (function frame(now) {
    const k = (now - t0) / 2200; g.clearRect(0, 0, W, H);
    for (const b of bits) { b.x += b.vx; b.y += b.vy; b.vy += 0.09; b.vx *= 0.975; b.r += b.vr; g.save(); g.globalAlpha = Math.max(0, 1 - k); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); g.restore(); }
    if (k < 1) requestAnimationFrame(frame); else { g.clearRect(0, 0, W, H); c.hidden = true; }
  })(t0);
}

// ---------- events ----------
// a click on the strip pins the island open; another click (or Esc) lets it fold away again
pill.addEventListener('click', e => {
  const pd = e.target.closest('[data-pill-decide]');
  if (pd) { e.stopPropagation(); api.decide(pd.dataset.id, pd.dataset.pillDecide); return; }
  if (e.target.closest('#pill-more')) { e.stopPropagation(); showVolume(false); return showMenu(!S.menu); }
  const r = e.target.closest('[data-radio-kind]');
  if (r) { // show the change at once; the helper reports the real state a moment later
    e.stopPropagation(); const on = r.dataset.on !== '1', n = S.win.net, k = r.dataset.radioKind === 'WiFi' ? 'wifi' : 'bt';
    api.setRadio(r.dataset.radioKind, on); if (n?.[k]) { n[k].on = on; drawNet(); } return;
  }
  if (S.settings?.island.openOn === 'click' && !S.open) return setOpen(true); // opened by a click: it still folds away when the pointer leaves
  if (S.open && S.pinned) setOpen(false); else { S.pinned = true; if (S.open) drawPill(); else setOpen(true); }
});
pill.addEventListener('keydown', e => { if (e.target === pill && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pill.click(); } });
bar.addEventListener('click', e => {
  if (e.target.closest('[data-settings]')) return openSettings();
  if (e.target.closest('#bar-vol')) { showMenu(false); showBright(false); return showVolume(!S.vol); }
  if (e.target.closest('#bar-bright')) { showMenu(false); showVolume(false); return showBright(!S.bright); }
  const b = e.target.closest('[data-tab]'); if (b) { showVolume(false); go(b.dataset.tab); }
});
// brightness: shown at once while dragging, saved a moment after the last move
$('#qbright').addEventListener('input', e => {
  const v = +e.target.value; $('#qbright-n').textContent = v + '%'; S.settings.island.brightness = v / 100;
  document.documentElement.style.setProperty('--bright', v / 100);
  clearTimeout(showBright.t); showBright.t = setTimeout(() => save({ island: { brightness: v / 100 } }), 300);
});
$('#qvol').addEventListener('input', e => { $('#qvol-n').textContent = e.target.value; api.setVolume(e.target.value); });
menu.addEventListener('click', async e => {
  const b = e.target.closest('[data-menu], [data-menu-tab], [data-hide], [data-release]'); if (!b) return;
  e.stopPropagation(); const d = b.dataset;
  if (d.menuTab) { showMenu(false); go(d.menuTab); }
  else if (d.hide) {
    const hidden = new Set(S.settings.hiddenTabs || []); hidden.has(d.hide) ? hidden.delete(d.hide) : hidden.add(d.hide);
    await save({ hiddenTabs: [...hidden] }); drawTabs(); showMenu(true, 'customize');
  }
  else if (d.release) api.openRelease(d.release);
  else if (d.menu === 'main' || d.menu === 'apps' || d.menu === 'customize') showMenu(true, d.menu);
  else if (d.menu === 'updates') { S.update = null; showMenu(true, 'updates'); S.update = await api.checkUpdate(); if (S.menu && S.menuView === 'updates') showMenu(true, 'updates'); }
  else if (d.menu === 'settings') { showMenu(false); openSettings(); }
  else if (d.menu === 'fold') { showMenu(false); setOpen(false); }
  else if (d.menu === 'quit') api.quit();
});
menu.addEventListener('input', e => { if (e.target.id === 'mvol') { e.target.style.setProperty('--fill', e.target.value + '%'); api.setVolume(e.target.value); } });
document.addEventListener('click', e => {
  if (S.menu && !e.target.closest('#menu, #pill-more')) showMenu(false);
  if (S.vol && !e.target.closest('#vol-pop, #bar-vol')) showVolume(false);
  if (S.bright && !e.target.closest('#bright-pop, #bar-bright')) showBright(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (S.menu || S.vol || S.bright) { showMenu(false); showVolume(false); showBright(false); } else setOpen(false); }
  else if (e.key === 'Enter' && e.target.dataset?.replyFor) sendReply(e.target.dataset.replyFor);
  else if (e.key === 'Enter' && e.target.id === 'send-term') sendToTerminal();
});
document.addEventListener('mousemove', e => pointer(Boolean(e.target.closest && e.target.closest('#shell'))));
document.addEventListener('mouseleave', () => pointer(false));
page.addEventListener('focusout', () => setTimeout(maybeClose, 300));

page.addEventListener('click', async e => {
  const b = e.target.closest('button, .item'); if (!b) return;
  const d = b.dataset;
  if (d.settings !== undefined) openSettings();
  else if (d.phone !== undefined) { b.disabled = true; b.classList.add('busy'); await api.phone(d.phone); }
  else if (d.lyrics !== undefined) { await save({ lyrics: !S.settings.lyrics }); S.lyricsFor = ''; refreshLyrics(); draw(true); }
  else if (d.decide) await api.decide(d.id, d.decide);
  else if (d.reply) sendReply(d.reply);
  else if (d.sendTerm !== undefined) sendToTerminal();
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
  else if (d.share === 'firewall') { const r = await api.shareFirewall(); if (S.share) S.share.firewall = r.ok; draw(true); }
  else if (d.focus === 'toggle') { S.focus.running = !S.focus.running; draw(true); }
  else if (d.tabGo) go(d.tabGo);
  else if (d.chatSend !== undefined) sendChat();
  else if (d.chatScreen !== undefined) { S.chat.screen = !S.chat.screen; redrawChat(); }
  else if (d.chatNew !== undefined) { S.chat.log = []; redrawChat(); }
  else if (d.quick) {
    const clip = await api.lastClip(), box = $('#pa-q');
    const ask = { explain: t('Explain this simply:'), spell: t('Check the spelling and grammar of this and show the corrected text:'), translate: t('Translate this into English:'), sw: t('Translate this into Tanzanian Swahili:') }[d.quick];
    box.value = clip ? `${ask}\n\n${clip}` : ask + ' '; box.focus(); growChat();
  }
  else if (d.calView) { S.cal.view = d.calView; S.cal.events = null; draw(true); refreshCalendar(); }
  else if (d.googleIn !== undefined) signInGoogle();
  else if (d.payMobile !== undefined) startPay('mobile');
  else if (d.payCard !== undefined) startPay('card');
  else if (d.buySignin !== undefined) api.openSettings('connections');
  else if (d.buyCancel !== undefined) { S.buy = { ...S.buy, order: '', error: '' }; draw(true); }
  else if (d.donateAmt) { S.buy = { ...S.buy, amount: Number(d.donateAmt), custom: '' }; draw(true); }
  else if (d.inbox !== undefined) api.openInbox();
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
page.addEventListener('keydown', e => { if (e.target.id === 'pa-q' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
// a lyric line you click: the song jumps to it
page.addEventListener('click', e => {
  const p = e.target.closest?.('[data-seek-ms]'); if (!p) return;
  const ms = +p.dataset.seekMs, m = S.win.media; api.seek(ms); if (m) { m.positionMs = ms; S.win.at = Date.now(); } lyrUserAt = 0; tick();
});
for (const ev of ['wheel', 'pointerdown']) page.addEventListener(ev, e => { if (e.target.closest?.('#lyr')) lyrUserAt = Date.now(); }, { passive: true });
page.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'seek') { seeking = true; $('#pos').textContent = time(+el.value); el.style.setProperty('--fill', (100 * el.value / (el.max || 1)) + '%'); return; }
  if (el.id === 'pa-q') { growChat(); return; }
  if (el.id === 'volume') { S.dragging = true; $('#vol-n').textContent = el.value; api.setVolume(el.value); }
  else if (el.id === 'note') { S.settings.note = el.value; drawNoteSide(); clearTimeout(page._note); page._note = setTimeout(() => save({ note: el.value }), 500); }
  else if (el.id === 'by-custom') S.buy.custom = el.value;
  else if (el.id === 'send-term') S.sendPrompt.text = el.value;
});
page.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'seek') { const m = S.win.media; api.seek(+el.value); if (m) { m.positionMs = +el.value; S.win.at = Date.now(); } seeking = false; return; }
  if (el.id === 'output') { api.setOutput(el.value); return; } // where a phone's music comes out (the default speaker)
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
island.addEventListener('dragover', e => { e.preventDefault(); if (draggingOut) return; if (!S.open) setOpen(true, 'tray'); else if (S.tab !== 'tray') go('tray'); $('#drop')?.classList.add('over'); });
island.addEventListener('dragleave', () => $('#drop')?.classList.remove('over'));
island.addEventListener('drop', async e => {
  e.preventDefault(); $('#drop')?.classList.remove('over'); if (draggingOut) return;
  const paths = [...e.dataTransfer.files].map(f => api.pathFor(f)).filter(Boolean);
  if (paths.length) { S.tray = await api.trayAdd(paths); draw(); }
});

api.onAi(snap => {
  const was = S.ai.top; S.ai = snap;
  // a permission waits in the folded pill with Allow / Deny; a question that needs typing opens the island by itself
  if (snap.top === 'asking' && was !== 'asking') { sfx('asking'); if (!S.open && !snap.sessions[0]?.ask?.canAnswer) { S.auto = true; setOpen(true, 'ai'); } }
  else if (was === 'asking' && snap.top !== 'asking' && S.auto) { S.auto = false; setTimeout(maybeClose, 900); }
  draw();
});
api.onFinish(entry => { sfx(entry.state === 'done' ? 'done' : 'error'); if (entry.state === 'done') confetti(); });
api.onWin(state => { const was = S.win.media?.title, phoneWas = S.win.phones?.on; S.win = state;
  if (state.phones && phoneWas !== undefined && Boolean(state.phones.on) !== Boolean(phoneWas)) sfx(state.phones.on ? 'phoneOn' : 'phoneOff'); if (state.media?.title !== was) applyArtColor(); refreshLyrics(); refreshSongInfo(); draw(); });
// the license changed (checked, bought, signed in or out): the tabs lock or unlock
// an iPhone message (shown 7 s) or call (shown while it rings) on a Mac: the pill grows to show who, like a live activity
api.onAlert(a => {
  clearTimeout(S.alertTimer);
  if (a.kind === 'call-end') { if (S.alert?.kind === 'call') S.alert = null; return drawPill(); }
  if ((a.kind === 'message' || a.kind === 'meeting') && S.alert?.kind === 'call') return; // a ringing call stays in front
  if (a.kind !== S.alert?.kind || a.from !== S.alert?.from) sfx(a.kind === 'call' ? 'ring' : 'message');
  S.alert = a; drawPill();
  if (a.kind === 'message' || a.kind === 'meeting') S.alertTimer = setTimeout(() => { S.alert = null; S.awakeUntil = Date.now() + 3000; drawPill(); }, a.kind === 'meeting' ? 10000 : 7000);
});
api.onLicense(v => { S.license = v; drawTabs(); if (S.open && !typing()) draw(true); });
api.onBuy(() => (S.open ? go('buy') : setOpen(true, 'buy')));
api.onArt(art => { S.art = art; applyArtColor(); if (S.tab === 'music') draw(); });
// a newer Pip was found by the periodic check: a dot on the ••• menu and on Updates, until it is installed
api.onUpdate(u => { S.update = u; island.classList.toggle('has-update', Boolean(u?.newer)); if (S.menu && S.menuView !== 'updates') showMenu(true, S.menuView); });
// Pip looks at the pointer: the eyes shift a few pixels towards it, less when it is close
api.onCursor(p => {
  // the pointer moved (main sends it only when it moves): wake now, and look again once it has been still for a minute
  S.cursorAt = Date.now(); if (pip.classList.contains('resting')) drawPill();
  clearTimeout(S.restTimer); clearTimeout(S.sleepTimer);
  S.restTimer = setTimeout(drawPill, REST_AFTER + 100); S.sleepTimer = setTimeout(drawPill, SLEEP_AFTER + 100);
  const r = pip.getBoundingClientRect(), dx = p.x - (r.left + r.width / 2), dy = p.y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, pull = Math.min(1, d / 140);
  pip.style.setProperty('--ex', (dx / d * (S.open ? 1.6 : 3.2) * pull).toFixed(2) + 'px'); pip.style.setProperty('--ey', (dy / d * (S.open ? 1.2 : 2.4) * pull).toFixed(2) + 'px');
});
api.onTray(list => { S.tray = list; draw(); });
api.onShareProgress(p => {
  if (p.done) { S.recv = null; drawRecv(); confetti(); return; }
  if (p.failed) { S.recv = null; return drawRecv(); }
  S.recv = { name: p.name, pct: p.total ? Math.min(99, Math.round(100 * p.got / p.total)) : 0 }; drawRecv();
});
api.onClips(list => { S.clips = list; draw(); });
api.onToggle(open => { if (open === true || !S.open) { S.pinned = true; setOpen(true); drawPill(); } else setOpen(false); });
// something was changed in the settings window: take the new settings (a new language needs a fresh page)
api.onChanged(async () => {
  const init = await api.init(), lang = S.settings.lang;
  Object.assign(S, { settings: init.settings, agents: init.agents }); S.spotify.on = init.spotify; S.google = init.google; drawTabs();
  if (init.settings.lang !== lang) return location.reload();
  applyMascot(); applyArtColor(); netKey = ''; S.lyricsFor = ''; refreshLyrics(); lastHtml = ''; if (S.open && S.tab === 'home') refreshHome(); else draw(true);
});

(async () => {
  const init = await api.init();
  t = window.makeT(init.strings, { mac: init.platform === 'darwin' }); document.documentElement.lang = init.settings.lang;
  Object.assign(S, { settings: init.settings, ai: init.ai, agents: init.agents, win: init.win, tray: init.tray, clips: init.clips, platform: init.platform, art: init.art, notch: init.notch || null, license: init.license || null });
  document.documentElement.classList.toggle('mac', init.platform === 'darwin'); // a few placements differ on the Mac
  if (S.notch) { document.documentElement.style.setProperty('--notch-w', S.notch.width + 'px'); document.documentElement.style.setProperty('--notch-h', S.notch.height + 'px'); }
  S.spotify.on = init.spotify; S.google = init.google; S.hubError = await api.hubError();
  // Pip was closed while a mode was running: put the focus guard back the way it was before the mode
  if (S.settings.modeRestore) await save({ modeRestore: null, guard: { on: Boolean(S.settings.modeRestore.guardOn) } });
  applyMascot(); applyArtColor(); drawTabs(); drawPill(); setInterval(second, 1000);
})();

page.addEventListener('keydown', e => { if (e.target.id === 'by-phone' && e.key === 'Enter' && !S.buy.busy) { e.preventDefault(); startPay('mobile'); } });
