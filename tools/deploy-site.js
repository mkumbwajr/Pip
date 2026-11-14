'use strict';
// Publishes peep.bang.co.tz on the existing Vultr server (aaPanel Nginx, shared with other sites):
//   node tools/deploy-site.js            upload the site, Pip's icon, the newest installer and latest.json
//   node tools/deploy-site.js --site     only the pages, styles, scripts and screenshots (not the installer)
//   node tools/deploy-site.js --nginx    only update the Nginx file for the site
//   node tools/deploy-site.js --cert     (or --cert-only, without uploading the site) the first time, once peep.bang.co.tz points at the server: get the HTTPS
//                                        certificate (Let's Encrypt, webroot, renewed by the server's certbot timer)
// It only touches Peep's own things: /srv/peep, /srv/peep-acme and one Nginx file for peep.bang.co.tz. Nginx's
// config is tested before every reload, and a failing test puts the previous Peep file back.
// SSH key: ~/.ssh/peep_vultr. No packages are installed and the firewall is not changed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const HOST = process.env.PEEP_HOST || '139.84.250.155', DOMAIN = 'peep.bang.co.tz', EMAIL = 'info@bang.co.tz';
const VHOST = `/www/server/panel/vhost/nginx/${DOMAIN}.conf`;
const NGINX = '/www/server/nginx/sbin/nginx -c /www/server/nginx/conf/nginx.conf';
const root = path.join(__dirname, '..'), version = require('../package.json').version;
const key = path.join(os.homedir(), '.ssh', 'peep_vultr');
const installer = path.join(root, 'dist', `Peep-Setup-${version}.exe`);
const ssh = ['-i', key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes'];
const sh = script => { const r = spawnSync('ssh', [...ssh, 'root@' + HOST, script], { stdio: 'inherit' }); if (r.status !== 0) { console.error('server step failed'); process.exit(1); } };
const copy = (from, to, recursive) => { const r = spawnSync('scp', [...ssh, ...(recursive ? ['-r'] : []), from, `root@${HOST}:${to}`], { stdio: 'inherit' }); if (r.status !== 0) { console.error('upload failed'); process.exit(1); } };

// Puts a Nginx file in place, tests the whole config, reloads; on a failed test the previous file comes back.
const installVhost = file => {
  copy(file, VHOST + '.new');
  sh(`set -e; [ -f ${VHOST} ] && cp ${VHOST} ${VHOST}.prev || true; mv ${VHOST}.new ${VHOST}
    if ${NGINX} -t; then ${NGINX} -s reload; else echo "nginx test failed: putting the previous file back"; if [ -f ${VHOST}.prev ]; then mv ${VHOST}.prev ${VHOST}; else rm -f ${VHOST}; fi; exit 1; fi`);
};

if (process.argv.includes('--nginx')) { // only the Nginx file for peep.bang.co.tz (tested, rolled back if the test fails)
  installVhost(path.join(root, 'site', 'nginx-peep.conf')); console.log('nginx updated'); process.exit(0);
}
if (process.argv.includes('--cert') || process.argv.includes('--cert-only')) {
  // 1. an HTTP-only site so Let's Encrypt can check the domain, 2. the certificate, 3. the full site
  const http = path.join(os.tmpdir(), 'peep-http.conf'), full = fs.readFileSync(path.join(root, 'site', 'nginx-peep.conf'), 'utf8');
  fs.writeFileSync(http, full.slice(0, full.indexOf('server {', full.indexOf('server {') + 1)));
  sh('mkdir -p /srv/peep /srv/peep-acme');
  installVhost(http);
  sh(`certbot certonly --webroot -w /srv/peep-acme -d ${DOMAIN} --key-type ecdsa --non-interactive --agree-tos -m ${EMAIL}`);
  installVhost(path.join(root, 'site', 'nginx-peep.conf'));
  console.log('certificate in place for ' + DOMAIN);
  if (process.argv.includes('--cert-only')) process.exit(0);
}

const siteOnly = process.argv.includes('--site'); // pages, styles, scripts and screenshots only; the installer stays as it is
if (!siteOnly && !fs.existsSync(installer)) { console.error('missing ' + installer + ': run npm run dist:win first'); process.exit(1); }
// pack the site
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-site-'));
for (const f of ['index.html', 'privacy.html', 'site.css', 'site.js']) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
// a version stamp on the stylesheet and script links, so no browser keeps an old copy after a deploy
const stamp = require('node:crypto').createHash('sha1').update(fs.readFileSync(path.join(out, 'site.css')) + fs.readFileSync(path.join(out, 'site.js'))).digest('hex').slice(0, 8);
for (const f of ['index.html', 'privacy.html']) { const p = path.join(out, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\/site\.(css|js)"/g, `/site.$1?v=${stamp}"`)); }
fs.copyFileSync(path.join(root, 'assets', 'icon.png'), path.join(out, 'icon.png'));
fs.copyFileSync(path.join(root, 'assets', 'icon.ico'), path.join(out, 'favicon.ico')); // Pip in the browser tab
fs.cpSync(path.join(root, 'site', 'img'), path.join(out, 'img'), { recursive: true }); // screenshots of Peep
if (siteOnly) { // copied over the live files in place; download/ and latest.json are left alone
  sh('rm -rf /srv/peep-stage'); copy(out, '/srv/peep-stage', true); // a new folder, then its contents copied over the live site
  sh('set -e; cp -a /srv/peep-stage/. /srv/peep/; rm -rf /srv/peep-stage; chmod -R a+rX /srv/peep'); fs.rmSync(out, { recursive: true, force: true });
  console.log('site updated (stamp ' + stamp + ')'); process.exit(0);
}
fs.mkdirSync(path.join(out, 'download'));
fs.copyFileSync(installer, path.join(out, 'download', `Peep-Setup-${version}.exe`));
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify({ version, url: `https://${DOMAIN}/download/Peep-Setup-${version}.exe` }) + '\n');
// upload next to the live folder, then swap, so visitors never see a half-copied site; only the newest installer is kept
sh('rm -rf /srv/peep.new /srv/peep.old');
copy(out, '/srv/peep.new', true);
// Peep-Setup.exe always gives the newest: a link on the server, so the installer is uploaded only once
sh(`set -e; ln -sf Peep-Setup-${version}.exe /srv/peep.new/download/Peep-Setup.exe; mkdir -p /srv/peep; mv /srv/peep /srv/peep.old; mv /srv/peep.new /srv/peep; chmod -R a+rX /srv/peep; rm -rf /srv/peep.old`);
fs.rmSync(out, { recursive: true, force: true });
console.log(`published Peep ${version} to https://${DOMAIN}`);
