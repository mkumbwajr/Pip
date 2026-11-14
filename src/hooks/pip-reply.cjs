#!/usr/bin/env node
'use strict';
// Pip's background Stop hook for Claude Code (asyncRewake). After Claude stops, this waits until you type an answer
// in the island. Exit code 2 wakes Claude and shows it what is written to stderr; exit 0 means there is nothing to
// send (you answered in the terminal, Pip is closed, or the wait ended).   node pip-reply.cjs <token> <port>
const http = require('node:http');
const [token, port = '48611'] = process.argv.slice(2);
if (!token) process.exit(0);
let input = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let event = {}; try { event = JSON.parse(input); } catch {}
  if (event.stop_hook_active) process.exit(0); // Claude is already continuing because of a Stop hook
  const body = JSON.stringify(event);
  const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/pip/wait', method: 'POST', timeout: 31 * 60 * 1000,
    headers: { 'X-Pip-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
    let out = ''; res.setEncoding('utf8'); res.on('data', d => { out += d; });
    res.on('end', () => {
      let reply = ''; try { reply = String(JSON.parse(out).reply || ''); } catch {}
      if (!reply) process.exit(0);
      process.stderr.write('The user answered from the Pip island:\n\n' + reply + '\n', () => process.exit(2));
    });
  });
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.on('error', () => process.exit(0));
  req.end(body);
});
