'use strict';
// Gives every build its own stamp (UTC minute, e.g. 202611151230) in src/build.json. A new installer can be published
// under the same version number, and Pip compares stamps to know it is newer (src/main/update.js).
const fs = require('node:fs'), path = require('node:path');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
fs.writeFileSync(path.join(__dirname, '..', 'src', 'build.json'), JSON.stringify({ stamp }) + '\n');
console.log('build stamp ' + stamp);
