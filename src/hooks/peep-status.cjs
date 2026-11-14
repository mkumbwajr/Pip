#!/usr/bin/env node
'use strict';
// Peep's status line for Claude Code. Claude Code runs it after each answer with session data on stdin, including
// how much of your 5-hour and weekly limits is used. It forwards that to Peep (for the ring in the island) and prints
// one short line for the terminal.   node peep-status.cjs <token> <port>
const http = require('node:http');
const [token, port = '48611'] = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let data = {}; try { data = JSON.parse(input); } catch {}
  const pct = w => (w && Number.isFinite(Number(w.used_percentage)) ? Math.round(Number(w.used_percentage)) + '%' : '');
  const five = pct(data.rate_limits?.five_hour), week = pct(data.rate_limits?.seven_day), ctx = pct(data.context_window);
  process.stdout.write([data.model?.display_name, ctx && 'ctx ' + ctx, five && '5h ' + five, week && '7d ' + week].filter(Boolean).join(' · ') || 'Peep');
  if (!token || !data.rate_limits) return;
  const body = JSON.stringify({ rate_limits: data.rate_limits });
  const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/peep/status', method: 'POST', timeout: 1500,
    headers: { 'X-Peep-Token': token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => res.resume());
  req.on('timeout', () => req.destroy()); req.on('error', () => {});
  req.end(body);
});
