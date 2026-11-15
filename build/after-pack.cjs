'use strict';
// electron-builder afterPack: signs the finished Mac app "ad hoc" (no Apple Developer ID: signed with "-").
// Without any signature, macOS on Apple silicon can refuse to start an app whose files were changed after Electron
// signed them (Pip's own code, icon and Info.plist), and reports it as "damaged" or "can't be opened". An ad-hoc
// signature keeps the app whole; the first-launch Gatekeeper question (Open Anyway) stays until Pip is notarized.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  // a universal build packs an x64 and an arm64 copy first and merges them; only the merged app is signed
  if (/-(x64|arm64)-temp$/.test(path.basename(context.appOutDir))) return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  console.log('ad-hoc signed ' + app);
};
