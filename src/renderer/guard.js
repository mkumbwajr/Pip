'use strict';
// A short pause before a distracting window: one slow breath, then you choose. Esc means "go back".
const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', reddit: 'Reddit', 'x.com': 'X', facebook: 'Facebook', netflix: 'Netflix', twitter: 'X' };
(async () => {
  const init = await window.peep.init(), t = window.makeT(init.strings);
  document.documentElement.lang = init.settings.lang;
  document.documentElement.style.setProperty('--pip', init.settings.mascot.color);
  const raw = new URLSearchParams(location.search).get('what') || '';
  const what = NAMES[raw.toLowerCase()] || raw.replace(/^./, c => c.toUpperCase());
  const $ = id => document.getElementById(id), title = $('title');
  const say = text => { title.classList.add('swap'); setTimeout(() => { title.textContent = text; title.classList.remove('swap'); }, 300); };
  $('label').textContent = t('Focus guard');
  const p = $('what'); p.textContent = t('You were about to open “{what}”.', { what });
  title.textContent = t('Breathe in'); $('back').textContent = t('Go back'); $('on').textContent = t('Open it anyway');
  setTimeout(() => say(t('Breathe out')), 4000);
  setTimeout(() => { say(t('Still want to?')); document.body.classList.add('done'); $('back').focus(); }, 8000);
  $('back').onclick = () => window.peep.guardChoice(true);
  $('on').onclick = () => window.peep.guardChoice(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.peep.guardChoice(true); });
})();
