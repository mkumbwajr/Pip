// peep.bang.co.tz: the current version on the download buttons, and sections that ease in as they scroll into view.
document.documentElement.classList.add('js');

const reveal = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveal.forEach(el => io.observe(el));
} else reveal.forEach(el => el.classList.add('in'));

fetch('/latest.json', { cache: 'no-store' }).then(r => r.json()).then(j => {
  if (!j.version) return;
  const v = document.getElementById('ver'); if (v) v.textContent = j.version;
  const v2 = document.getElementById('ver2'); if (v2) v2.textContent = 'Toleo ' + j.version + ' · Windows 10 na 11 · Bure';
  if (j.url) for (const a of document.querySelectorAll('[data-download]')) a.href = j.url;
}).catch(() => {});
