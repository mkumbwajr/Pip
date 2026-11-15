'use strict';
// The welcome: seven short steps the first time Pip starts (and again from Settings → General).
// 1 hello · 2 Pip account (optional) · 3 where you live and your language · 4 connect an agent · 5 pick Home's layout ·
// 6 Pip's nickname · 7 done. Signing in to an account that already has preferences brings them back, so the steps
// they cover are skipped: only connecting the agents (which belongs to each device) is left.
// Every choice is saved the moment it is made, so closing the window halfway loses nothing.
const api = window.pipApp;
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#7c5cff', '#2f9bff', '#2fbf71', '#f5a524', '#ff5c8a', '#14a3a8'];
const ST = { hello: 1, account: 2, place: 3, agents: 4, home: 5, name: 6, done: 7 }, STEPS = 7;
let restored = false, busy = false;
let t = window.makeT({}), S = null, step = Math.max(1, Math.min(STEPS, Number(location.hash.slice(1)) || 1)), homeAt = 0;

const mascot = (cls = '') => `<span class="mascot ${cls}"><i></i><i></i></span>`;
const countries = () => [['TZ', 'Tanzania'], ['KE', 'Kenya'], ['UG', 'Uganda'], ['RW', 'Rwanda'], ['BI', 'Burundi'], ['CD', 'DR Congo'], ['other', t('Somewhere else')]];
const HOMES = () => [['clock', t('Clock'), t('A big clock, your next event and three cards.')], ['dials', t('Dials'), t('Usage, focus and the song as rings.')],
  ['colours', t('Colours'), t('Four bright cards you can tap.')], ['apps', t('All apps'), t('Every tool one click away.')]];

/** Small drawings of each Home layout, made of plain boxes (no screenshots). */
function homeArt(id) {
  const bar = '<div class="hp-bar"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  if (id === 'dials') return `<div class="hp"><div class="hp-strip"></div><div class="hp-dials"><div class="hp-l"><b>9:41</b><i></i><i class="s"></i></div><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span></div>${bar}</div>`;
  if (id === 'colours') return `<div class="hp"><div class="hp-strip"></div><div class="hp-cols"><span class="c1"></span><span class="c2"></span><span class="c3"></span><span class="c4"></span></div>${bar}</div>`;
  if (id === 'apps') return `<div class="hp"><div class="hp-strip"></div><div class="hp-apps"><div class="hp-l"><b>9:41</b><i class="s"></i></div><div class="hp-grid">${'<span></span>'.repeat(10)}</div></div>${bar}</div>`;
  return `<div class="hp"><div class="hp-strip"></div><div class="hp-clock"><div class="hp-l"><b class="big">9:41</b><i></i><i class="s"></i></div><div class="hp-tiles"><span class="t1"></span><span class="t2"></span><span class="t3"></span></div></div>${bar}</div>`;
}

const views = {
  1() {
    return `<div class="hello">${mascot('huge')}<h1>${esc(t('Hi, I am {name}.', { name: S.settings.mascot.name || 'Pip' }))}</h1>
      <p>${esc(t('I sit at the top of your screen and show you what your AI agents are doing, right now.'))}</p></div>`;
  },
  2() {
    const a = S.account || {};
    if (a.signedIn) return `<div class="acct">${mascot('big happy')}<h2>${esc(restored ? t('Welcome back!') : t('Signed in'))}</h2>
      <p class="lead">${esc(restored ? t('Your preferences are back on this device.') : t('Your preferences are saved to your Pip account.'))}</p>
      <div class="who">${icon('check')}<span>${esc(a.email)}</span></div></div>`;
    return `<div class="acct"><span class="cloud">${icon('link')}</span><h2>${esc(t('Keep Pip on every device'))}</h2>
      <p class="lead">${esc(t('Sign in to save your preferences, note, town and calendar link, and get them back on any PC or Mac with Pip.'))}</p>
      <button type="button" class="gbtn" id="acct-go" ${busy ? 'disabled' : ''}>${googleG()}<span>${esc(busy ? t('Finish the login in your browser…') : t('Continue with Google'))}</span></button>
      <p class="err" id="err"></p>
      <p class="safe">${icon('shield')}${esc(t('Optional. Pip works fully without an account. Google only tells Pip who you are.'))}</p></div>`;
  },
  3() {
    const s = S.settings;
    return `<h2>${esc(t('Where do you live?'))}</h2><p class="lead">${esc(t('So Pip speaks your language and knows your weather.'))}</p>
      <label class="field"><span>${esc(t('Country'))}</span><select id="country">${countries().map(([v, n]) => `<option value="${v}" ${v === (s.country || 'TZ') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label class="field"><span>${esc(t('Language'))}</span><select id="lang">${S.languages.map(l => `<option value="${esc(l.code)}" ${l.code === s.lang ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <label class="field"><span>${esc(t('Your town (for the weather)'))}</span><input type="text" id="town" value="${esc(s.weather.place)}" placeholder="Dar es Salaam"></label>`;
  },
  4() {
    const card = (id, name) => `<div class="agent ${S.agents[id] ? 'on' : ''}"><span class="logo">${icon(id === 'claude' ? 'ai' : 'apps')}</span><div class="grow"><b>${name}</b><span>${esc(S.agents[id] ? t('Connected') : t('Not connected'))}</span></div>
      <button type="button" class="${S.agents[id] ? 'ghost' : 'primary'}" data-agent="${id}">${esc(S.agents[id] ? t('Disconnect') : t('Connect'))}</button></div>`;
    return `<h2>${esc(t('Which AI do you use?'))}</h2><p class="lead">${esc(t('Pip follows them while they work. You can change this later in Settings.'))}</p>
      ${card('claude', 'Claude Code')}${card('codex', 'Codex')}<p class="err" id="err"></p>
      <p class="safe">${icon('shield')}${esc(t('Only the status is read, on your own PC.'))}</p>`;
  },
  5() {
    const list = HOMES(), [id, name, sub] = list[homeAt], chosen = (S.settings.homeStyle || 'clock') === id;
    return `<h2>${esc(t('Pick your Home'))}</h2><p class="lead">${esc(t('What you see first when the island opens.'))}</p>
      <div class="carousel"><button type="button" class="arrow" data-home-step="-1" aria-label="${esc(t('Back'))}">${icon('back')}</button>
        <div class="slide ${chosen ? 'on' : ''}" data-home-pick="${id}">${homeArt(id)}<div class="slide-text"><b>${esc(name)}</b><span>${esc(sub)}</span></div>${chosen ? `<span class="tick">${icon('check')}</span>` : ''}</div>
        <button type="button" class="arrow next" data-home-step="1" aria-label="${esc(t('Next'))}">${icon('back')}</button></div>
      <div class="hdots">${list.map((x, n) => `<button type="button" class="${n === homeAt ? 'on' : ''}" data-home-at="${n}" aria-label="${esc(x[1])}"></button>`).join('')}</div>`;
  },
  6() {
    const s = S.settings;
    return `<div class="name-step">${mascot('big')}<h2>${esc(t('Give him a nickname'))}</h2>
      <input type="text" id="nick" maxlength="20" value="${esc(s.mascot.name)}" aria-label="${esc(t('Give him a nickname'))}">
      <div class="swatches">${COLORS.map(c => `<button type="button" data-color="${c}" class="${c === s.mascot.color ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div></div>`;
  },
  7() {
    const keys = S.settings.shortcut.split('+').map(k => `<kbd>${esc(k.replace('Control', 'Ctrl'))}</kbd>`).join('');
    const card = (ico, title, sub) => `<div class="tip"><span class="logo">${ico}</span><div><b>${title}</b><span>${esc(sub)}</span></div></div>`;
    return `<div class="done">${mascot('big happy')}<h2>${esc(t('All set!'))}</h2><p class="lead">${esc(t('{name} is waiting at the top of your screen.', { name: S.settings.mascot.name || 'Pip' }))}</p></div>
      ${card(icon('keyboard'), `<span class="kbd">${keys}</span>`, t('Opens and folds the island from anywhere.'))}
      ${card(icon('bell'), esc(t('Tells you when your AI is done')), t('And asks you before an agent does something big.'))}
      ${card('<b class="dots">•••</b>', esc(t('Settings live behind the dots')), t('In the strip at the top of the open island.'))}`;
  }
};

function draw() {
  document.documentElement.style.setProperty('--pip', S.settings.mascot.color);
  $('#count').textContent = t('Setup {n}/{total}', { n: step, total: STEPS });
  $('#dots').innerHTML = Array.from({ length: STEPS }, (_, n) => `<i class="${n + 1 <= step ? 'on' : ''}"></i>`).join('');
  const box = $('#step'); box.innerHTML = `<div class="in">${views[step]()}</div>`;
  for (const el of box.querySelectorAll('[data-color]')) el.style.background = el.dataset.color;
  $('#back').textContent = t('Back'); $('#back').hidden = step === 1 || step === STEPS;
  $('#skip').textContent = t('Skip for now'); $('#skip').hidden = !(step === ST.agents || (step === ST.account && !S.account?.signedIn));
  $('#next').textContent = step === ST.hello ? t('Let’s start') : step === STEPS ? t('Open Pip') : step === ST.home ? t('Use this one') : t('Next');
  $('#next').hidden = step === ST.account && !S.account?.signedIn; // there: Continue with Google, or Skip
  document.body.dataset.step = step;
  $('#acct-go')?.addEventListener('click', signIn);
}
async function signIn() {
  busy = true; draw();
  const r = await api.accountSignIn(); busy = false;
  if (!r.ok) { draw(); $('#err').textContent = r.error; return; }
  S.account = r; restored = r.how === 'restored';
  if (restored) { const init = await api.init(); S.settings = init.settings; if (init.settings.lang !== document.documentElement.lang) { sessionStorage.setItem('restored', '1'); location.hash = String(ST.account); return location.reload(); } }
  draw();
}
async function save(patch) { S.settings = await api.setSettings(patch); }
function go(n) { step = Math.max(1, Math.min(STEPS, n)); location.hash = String(step); draw(); }

$('#next').addEventListener('click', async () => {
  if (step === ST.place) await save({ country: $('#country').value, weather: { place: $('#town').value.trim() } });
  if (step === ST.home) await save({ homeStyle: HOMES()[homeAt][0] });
  if (step === ST.name) await save({ mascot: { name: $('#nick').value.trim() || 'Pip' } });
  if (step === STEPS) return api.welcomeDone();
  if (step === ST.account && restored) return go(ST.agents); // language, town and the rest came back with the account
  if (step === ST.agents && restored) return go(STEPS);
  go(step + 1);
});
$('#back').addEventListener('click', () => go(step - 1));
$('#skip').addEventListener('click', () => go(step + 1));
$('#step').addEventListener('click', async e => {
  const b = e.target.closest('[data-agent], [data-color], [data-home-step], [data-home-at], [data-home-pick]'); if (!b) return;
  const d = b.dataset;
  if (d.agent) {
    const r = await api.connectAgent(d.agent, !S.agents[d.agent]); S.agents = r.agents || S.agents; draw();
    if (!r.ok) $('#err').textContent = t('Could not change that: {error}', { error: r.error });
  } else if (d.color) { await save({ mascot: { color: d.color } }); const nick = $('#nick').value; draw(); $('#nick').value = nick; }
  else if (d.homeStep) { homeAt = (homeAt + Number(d.homeStep) + 4) % 4; draw(); }
  else if (d.homeAt) { homeAt = Number(d.homeAt); draw(); }
  else if (d.homePick) { await save({ homeStyle: d.homePick }); draw(); }
});
$('#step').addEventListener('change', async e => {
  if (e.target.id === 'lang') { await save({ lang: e.target.value }); location.reload(); } // the page comes back on this step, in the new language
  if (e.target.id === 'country') { // a suggestion only: Kiswahili for East Africa, English elsewhere; the language box stays yours
    const sw = ['TZ', 'KE', 'UG', 'RW', 'BI', 'CD'].includes(e.target.value), want = sw ? 'sw' : 'en';
    await save({ country: e.target.value }); if (S.settings.lang !== want && S.languages.some(l => l.code === want)) { await save({ lang: want }); location.reload(); }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' && step === ST.home) { homeAt = (homeAt + 1) % 4; draw(); }
  if (e.key === 'ArrowLeft' && step === ST.home) { homeAt = (homeAt + 3) % 4; draw(); }
  if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') $('#next').click();
});

(async () => {
  S = await api.init(); t = window.makeT(S.strings, { mac: S.platform === 'darwin' }); document.documentElement.lang = S.settings.lang;
  try { restored = sessionStorage.getItem('restored') === '1'; } catch {} // came back in the account's language
  homeAt = Math.max(0, HOMES().findIndex(h => h[0] === (S.settings.homeStyle || 'clock')));
  draw();
})();
