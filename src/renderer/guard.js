'use strict';
// A short pause before a distracting window: one slow breath, then you choose.
(async () => {
  const t = window.makeT(await window.peep.strings());
  const what = new URLSearchParams(location.search).get('what') || '';
  const title = document.getElementById('title'), back = document.getElementById('back'), on = document.getElementById('on');
  document.getElementById('what').textContent = t('You were about to open “{what}”.', { what });
  title.textContent = t('Breathe in'); back.textContent = t('Go back'); on.textContent = t('Open it anyway');
  setTimeout(() => { title.textContent = t('Breathe out'); }, 4000);
  setTimeout(() => { title.textContent = t('Still want to?'); document.getElementById('buttons').hidden = false; }, 8000);
  back.onclick = () => window.peep.guardChoice(true);
  on.onclick = () => window.peep.guardChoice(false);
})();
