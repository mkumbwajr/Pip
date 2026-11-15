'use strict';
// Pip's phone page for sending files across networks. The link is /send#<box>.<key>: the key never leaves this phone
// (browsers do not send what follows #). Files and names are sealed with AES-256-GCM here before upload, and files
// from the computer are opened here after download. Format: 12-byte IV, ciphertext, 16-byte tag.
(() => {
  const $ = id => document.getElementById(id);
  const [box, keyText] = location.hash.slice(1).split('.');
  const b64u = { dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)),
    enc: u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
  const size = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  if (!box || !keyText || !window.crypto?.subtle) { $('list').innerHTML = '<p class="bad">Link hii haijakamilika. Scan QR code tena kwenye Pip.</p>'; $('files').disabled = true; return; }
  const keyP = crypto.subtle.importKey('raw', b64u.dec(keyText), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const seal = async bytes => { const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyP, bytes)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; };
  const open = async bytes => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await keyP, bytes.slice(12)));
  const nameOf = async text => { try { return new TextDecoder().decode(await open(b64u.dec(text))); } catch { return 'file'; } };
  const api = p => `/api/relay/${encodeURIComponent(box)}${p}`;

  // files from the computer
  let shown = '';
  async function list() {
    try {
      const r = await fetch(api('/out'), { cache: 'no-store' });
      if (r.status === 404) { $('list').innerHTML = '<p class="bad">Link hii imeisha muda. Anzisha kushiriki tena kwenye Pip.</p>'; return false; }
      const files = (await r.json()).files.filter(f => f.done), key = files.map(f => f.n).join();
      if (key === shown && key) return true; shown = key; // the same list: leave it (and its ✓ marks) alone
      if (!files.length) { $('list').innerHTML = '<p class="empty">Hakuna kitu bado. Weka mafaili kwenye tray ya Pip.</p>'; return true; }
      const rows = await Promise.all(files.map(async f => ({ ...f, plain: await nameOf(f.name) })));
      $('list').innerHTML = ''; for (const f of rows) {
        const b = document.createElement('button'); b.className = 'row'; b.innerHTML = '<span class="name"></span><span class="get">Pakua</span>';
        b.querySelector('.name').textContent = f.plain; const s = document.createElement('small'); s.textContent = size(f.size - 28); b.querySelector('.name').append(s);
        b.onclick = () => download(f, b); $('list').append(b);
      }
    } catch { $('list').innerHTML = '<p class="bad">Imeshindwa kufikia server. Angalia internet.</p>'; }
    return true;
  }
  async function download(f, row) {
    const tag = row.querySelector('.get'); tag.textContent = '…';
    try {
      const data = await open(new Uint8Array(await (await fetch(api('/out/' + f.n), { cache: 'no-store' })).arrayBuffer()));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = f.plain; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000); tag.textContent = '✓';
    } catch { tag.textContent = '!'; }
  }

  // files to the computer
  $('files').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'row'; row.innerHTML = '<span class="name"><small>Inafunga…</small><div class="bar"><i></i></div></span>';
      row.querySelector('.name').prepend(document.createTextNode(file.name)); $('up').append(row);
      const note = row.querySelector('small'), bar = row.querySelector('.bar i');
      if (file.size > 200 * 1024 * 1024) { note.textContent = 'Kubwa mno (zaidi ya 200 MB)'; note.className = 'bad'; continue; }
      try {
        const body = await seal(new Uint8Array(await file.arrayBuffer())), name = b64u.enc(await seal(new TextEncoder().encode(file.name)));
        await new Promise((resolve, reject) => {
          const x = new XMLHttpRequest(); x.open('PUT', api('/in')); x.setRequestHeader('X-Name', name); x.setRequestHeader('Content-Type', 'application/octet-stream');
          x.upload.onprogress = ev => { if (ev.lengthComputable) { const p = Math.round(100 * ev.loaded / ev.total); bar.style.width = p + '%'; note.textContent = p + '% · ' + size(ev.loaded) + ' / ' + size(ev.total); } };
          x.onload = () => (x.status === 200 ? resolve() : reject(new Error(String(x.status)))); x.onerror = () => reject(new Error('network'));
          x.send(body);
        });
        bar.style.width = '100%'; note.textContent = 'Imefika kwenye kompyuta ✓'; note.className = 'ok';
      } catch (err) { note.textContent = err.message === '413' ? 'Box imejaa au faili ni kubwa mno' : 'Imeshindwa kutuma. Jaribu tena.'; note.className = 'bad'; }
    }
  });

  list().then(alive => { if (alive) setInterval(list, 5000); });
})();
