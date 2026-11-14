const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { Hub } = require('../src/main/hooks-hub.js');
const hi = require('../src/main/hook-install.js');

const script = name => path.join(__dirname, '..', 'src', 'hooks', name);
function run(name, port, input, token = 'tok') {
  const child = spawn(process.execPath, [script(name), token, String(port)]);
  let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  child.stdin.end(JSON.stringify(input));
  return new Promise(r => child.on('close', code => r({ code, out, err })));
}

test('reply script: an island answer wakes Claude with exit code 2', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'x' }); hub.handle({ hook_event_name: 'Stop', session_id: 's', last_assistant_message: 'Which colour?' });
    const done = run('pip-reply.cjs', port, { session_id: 's' });
    await new Promise(r => { const t = setInterval(() => { if (hub.snapshot().sessions[0].canReply) { clearInterval(t); r(); } }, 20); });
    assert.equal(hub.snapshot().sessions[0].reply, 'Which colour?');
    assert.equal(hub.reply('s', 'Blue please'), true);
    const r = await done; assert.equal(r.code, 2); assert.match(r.err, /Blue please/);
    assert.equal(hub.snapshot().sessions[0].state, 'working'); assert.equal(hub.reply('s', 'again'), false);
  } finally { await hub.stop(); }
});

test('reply script: typing in the terminal ends the wait quietly; no Pip means exit 0', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  const done = run('pip-reply.cjs', port, { session_id: 's' });
  await new Promise(r => hub.once('change', r));
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'typed here' });
  assert.equal((await done).code, 0);
  assert.equal((await run('pip-reply.cjs', port, { session_id: 's', stop_hook_active: true })).code, 0);
  await hub.stop();
  assert.equal((await run('pip-reply.cjs', port, { session_id: 's' })).code, 0);
});

test('status script: prints a line and reports usage to the hub', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    const changed = new Promise(r => hub.once('change', r));
    const r = await run('pip-status.cjs', port, { model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 34.4, resets_at: 1790000000 }, seven_day: { used_percentage: 12 } } });
    assert.equal(r.out, 'Opus · 5h 34% · 7d 12%'); await changed;
    assert.deepEqual(hub.snapshot().usage.fiveHour, { pct: 34, resetsAt: 1790000000000 });
    assert.equal((await run('pip-status.cjs', port, {})).out, 'Pip');
  } finally { await hub.stop(); }
});

test('install: reply hook and status line are added and removed; an existing status line is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-')), file = path.join(dir, 'settings.json');
  const scripts = { reply: 'C:\\Apps\\Pip\\src\\hooks\\pip-reply.cjs', status: 'C:\\Apps\\Pip\\src\\hooks\\pip-status.cjs' };
  hi.installClaude({ token: 'T', file, scripts }); hi.installClaude({ token: 'T', file, scripts });
  let c = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(c.hooks.Stop.length, 2);
  assert.equal(c.hooks.Stop[1].hooks[0].command, 'node "C:/Apps/Pip/src/hooks/pip-reply.cjs" T 48611'); assert.equal(c.hooks.Stop[1].hooks[0].asyncRewake, true);
  assert.equal(c.statusLine.command, 'node "C:/Apps/Pip/src/hooks/pip-status.cjs" T 48611');
  hi.uninstallClaude({ file }); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'mine.sh' } }));
  hi.installClaude({ token: 'T', file, scripts }); c = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(c.statusLine.command, 'mine.sh');
  hi.uninstallClaude({ file }); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { statusLine: { type: 'command', command: 'mine.sh' } });
});
