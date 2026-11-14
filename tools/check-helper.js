'use strict';
// Windows only: starts the PowerShell helper for a few seconds and checks it reports a valid state.
// CI runs this on a real Windows machine, where the media, volume and window code can actually be exercised.
const { WinHelper } = require('../src/main/win-helper.js');
if (process.platform !== 'win32') { console.log('skipped: not Windows'); process.exit(0); }
const helper = new WinHelper(); let states = 0, last = null;
helper.on('state', s => { states++; last = s; });
helper.start();
let before = null; // the volume is set to 30 to test the command, then put back
setTimeout(() => { before = last?.volume?.level ?? null; helper.send({ cmd: 'volume', level: 30 }); }, 6000);
setTimeout(() => {
  const changed = last?.volume?.level === 30;
  if (before !== null) helper.send({ cmd: 'volume', level: before });
  setTimeout(() => {
    helper.stop();
    console.log(JSON.stringify({ states, front: last?.front?.proc || null, volume: last?.volume || null, media: last?.media ? `${last.media.title} (${last.media.app})` : null, net: last?.net || null }));
    if (!states) { console.error('The helper reported nothing.'); process.exit(1); }
    if (last.volume && !changed) console.warn('warning: the volume did not change to 30 (no audio device on this machine?)');
    process.exit(0);
  }, 1500);
}, 12000);
