// Light or dark: the visitor's own choice if they made one on this device, else their system setting. Loaded in
// <head> before the page draws, so it never flashes the wrong colours. The sun/moon button in the top bar switches.
(() => {
  const root = document.documentElement, KEY = 'pip-theme';
  let saved = null; try { saved = localStorage.getItem(KEY); } catch {}
  const system = () => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const apply = mode => { root.dataset.theme = mode; root.style.colorScheme = mode; };
  apply(saved === 'light' || saved === 'dark' ? saved : system());
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { let s = null; try { s = localStorage.getItem(KEY); } catch {} if (!s) apply(system()); });
  addEventListener('DOMContentLoaded', () => {
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      const label = () => b.setAttribute('aria-label', root.dataset.theme === 'dark' ? 'Badilisha kwenda mwanga' : 'Badilisha kwenda giza');
      label();
      b.addEventListener('click', () => { const next = root.dataset.theme === 'dark' ? 'light' : 'dark'; apply(next); try { localStorage.setItem(KEY, next); } catch {} label(); });
    }
  });
})();
