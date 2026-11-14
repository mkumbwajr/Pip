const test = require('node:test'), assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const hi = require('../src/main/hook-install.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'peep-'));

test('claude: installs, is idempotent, and uninstall restores the user config exactly', () => {
  const file = path.join(tmp(), 'settings.json');
  const mine = { model: 'opus', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] }, statusLine: { type: 'command', command: 'x' } };
  fs.writeFileSync(file, JSON.stringify(mine));
  hi.installClaude({ token: 'T', file }); hi.installClaude({ token: 'T', file });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(hi.claudeInstalled({ file }), true);
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.equal(after.hooks.PermissionRequest[0].hooks[0].timeout, 300);
  assert.equal(after.hooks.Stop[0].hooks[0].headers['X-Peep-Token'], 'T');
  assert.equal(after.statusLine.command, 'x');
  assert.ok(fs.existsSync(file + '.peep-backup'));
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
  assert.match(c.hooks.Stop[0].hooks[0].command, /^curl\.exe .*agent=codex"$/);
  assert.equal(hi.codexInstalled({ file }), true);
  hi.uninstallCodex({ file }); assert.equal(hi.codexInstalled({ file }), false);
});
