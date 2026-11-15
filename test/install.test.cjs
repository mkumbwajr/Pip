const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const hi = require('../src/main/hook-install.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pip-'));

test('claude: installs, is idempotent, and uninstall restores the user config exactly', () => {
  const file = path.join(tmp(), 'settings.json');
  const mine = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] }, statusLine: { type: 'command', command: 'x' } };
  fs.writeFileSync(file, JSON.stringify(mine));
  hi.installClaude({ token: 'T', file }); hi.installClaude({ token: 'T', file });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(hi.claudeInstalled({ file }), true);
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.equal(after.hooks.PermissionRequest[0].hooks[0].timeout, 300);
  assert.equal(after.hooks.Stop[0].hooks[0].headers['X-Pip-Token'], 'T');
  assert.equal(after.statusLine.command, 'x');
  assert.ok(fs.existsSync(file + '.pip-backup'));
  assert.equal(hi.uninstallClaude({ file }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), mine);
  assert.equal(hi.uninstallClaude({ file }), false);
});

test('claude: creates the file when there is none, refuses to touch broken JSON', () => {
  const dir = tmp(), file = path.join(dir, 'sub', 'settings.json');
  hi.installClaude({ token: 'T', file });
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).hooks).length, hi.CLAUDE_EVENTS.length);
  hi.uninstallClaude({ file }); assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {});
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{ not json');
  assert.throws(() => hi.installClaude({ token: 'T', file: bad }));
  assert.equal(fs.readFileSync(bad, 'utf8'), '{ not json');
});

test('codex: command hooks via curl, removed cleanly', () => {
  const file = path.join(tmp(), 'hooks.json');
  hi.installCodex({ token: 'T', file });
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.match(c.hooks.Stop[0].hooks[0].command, process.platform === 'win32' ? /^curl\.exe .*agent=codex"$/ : /^curl .*agent=codex"$/); // curl.exe on Windows, curl elsewhere
  assert.equal(hi.codexInstalled({ file }), true);
  hi.uninstallCodex({ file }); assert.equal(hi.codexInstalled({ file }), false);
});

test('rename: entries written by Peep (the earlier name) are replaced, never duplicated, and removed on uninstall', () => {
  const file = path.join(tmp(), 'settings.json');
  const user = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } };
  const peep = JSON.parse(JSON.stringify(user));
  peep.hooks.PreToolUse.push({ hooks: [{ type: 'http', url: 'http://127.0.0.1:48611/peep/event', headers: { 'X-Peep-Token': 'OLD' } }] });
  peep.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node "C:/Peep/resources/app.asar.unpacked/src/hooks/peep-reply.cjs" OLD 48611', asyncRewake: true }] }];
  peep.statusLine = { type: 'command', command: 'node "C:/Peep/src/hooks/peep-status.cjs" OLD 48611' };
  fs.writeFileSync(file, JSON.stringify(peep));
  fs.writeFileSync(file + '.peep-backup', JSON.stringify(user)); // Peep's backup: Pip does not make a second one
  assert.equal(hi.claudeInstalled({ file }), true, "Peep's entries count as ours");
  hi.installClaude({ token: 'NEW', file, scripts: { reply: 'C:/Pip/pip-reply.cjs', status: 'C:/Pip/pip-status.cjs' } });
  const after = JSON.parse(fs.readFileSync(file, 'utf8')), all = JSON.stringify(after);
  assert.ok(!all.includes('/peep/') && !all.includes('peep-reply') && !all.includes('peep-status') && !all.includes('OLD'), 'nothing of Peep left');
  assert.equal(after.hooks.PreToolUse.length, 2); // the user's own + Pip's
  assert.equal(after.statusLine.command.includes('pip-status.cjs'), true, "Peep's status line is replaced by Pip's");
  assert.equal(fs.existsSync(file + '.pip-backup'), false);
  hi.uninstallClaude({ file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), user);
});

test("rename: someone else's status line is still never replaced", () => {
  const file = path.join(tmp(), 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ statusLine: { type: 'command', command: 'starship prompt' } }));
  hi.installClaude({ token: 'T', file, scripts: { status: 'C:/Pip/pip-status.cjs' } });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine.command, 'starship prompt');
});
