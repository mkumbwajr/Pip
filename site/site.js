// pip.bang.co.tz: the current version on the download buttons, and sections that ease in as they scroll into view.
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
  // on a Mac, and once there is a Mac build: the download buttons give the disk image
  if (j.mac && /Mac/.test(navigator.platform || navigator.userAgent)) for (const a of document.querySelectorAll('[data-download]')) { a.href = j.mac; a.textContent = a.textContent.replace('Windows', 'Mac'); }
}).catch(() => {});

// people who ask for less motion see the still image instead of the looping video
const vid = document.getElementById('open-video');
if (vid && matchMedia('(prefers-reduced-motion: reduce)').matches) { vid.removeAttribute('autoplay'); vid.pause(); }

// the labels under the video follow the tab on screen; a click jumps there
const tour = document.getElementById('tour');
if (vid && tour) {
  const marks = [...tour.querySelectorAll('[data-t]')];
  const sync = () => { const now = vid.currentTime; let on = null; for (const b of marks) if (+b.dataset.t <= now + 0.05) on = b; for (const b of marks) b.classList.toggle('on', b === on); };
  vid.addEventListener('timeupdate', sync);
  tour.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; vid.currentTime = +b.dataset.t + 0.05; if (vid.paused) vid.play().catch(() => {}); sync(); });
}
