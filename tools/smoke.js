'use strict';
// A development smoke test: starts Peep with a throwaway profile and home folder, plays a pretend Claude Code
// session into the hub (including the real reply and status scripts), and saves screenshots of the island.
//   electron --no-sandbox tools/smoke.js <output folder>
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const out = path.resolve(process.argv.at(-1).endsWith('smoke.js') ? 'smoke-out' : process.argv.at(-1));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-smoke-'));
process.env.HOME = process.env.USERPROFILE = path.join(tmp, 'home'); fs.mkdirSync(process.env.HOME, { recursive: true });
app.setPath('userData', path.join(tmp, 'profile'));
require('../src/main/main.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  await wait(2500);
  const find = name => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith(name));
  const win = find('island.html'), js = code => win.webContents.executeJavaScript(code);
  const settings = find('settings.html'), sjs = code => settings.webContents.executeJavaScript(code);
  const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });
  const shot = async name => { await wait(400); fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const token = fs.readFileSync(path.join(tmp, 'profile', 'hook-token'), 'utf8');
  const post = body => fetch('http://127.0.0.1:48611/peep/event', { method: 'POST', headers: { 'X-Peep-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: 's1', cwd: 'C:\\code\\duka', ...body }) });
  const script = (name, input) => new Promise(resolve => {
    const child = spawn('node', [path.join(__dirname, '..', 'src', 'hooks', name), token, '48611']); let err = '', so = '';
    child.stderr.on('data', d => { err += d; }); child.stdout.on('data', d => { so += d; }); child.on('close', code => resolve({ code, err, out: so })); child.stdin.end(JSON.stringify(input));
  });

  await wait(300); fs.writeFileSync(path.join(out, '1-settings-window.png'), (await settings.webContents.capturePage()).toPNG());
  await shot('1-idle');
  await sjs(`document.querySelector('[data-go=agents]').click()`); await wait(200);
  await sjs(`document.querySelector('#ag-claude').click()`); await wait(800);
  await sjs(`document.querySelector('[data-go=island]').click()`); await wait(200);
  await sjs(`document.querySelector('[data-mode=detach]').click()`); await wait(400); await shot('1-idle-detached');
  fs.writeFileSync(path.join(out, '1-settings-island.png'), (await settings.webContents.capturePage()).toPNG());
  await sjs(`document.querySelector('[data-mode=attach]').click()`); await wait(300);
  await js(`document.querySelector('#pill').click()`); await wait(700);
  const config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude', 'settings.json'), 'utf8'));
  const start = await (await post({ hook_event_name: 'SessionStart' })).json();
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'Ongeza sehemu ya discount code kwenye checkout' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\code\\duka\\checkout.js' } });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\code\\duka\\checkout.js' } });
  const status = await script('peep-status.cjs', { model: { display_name: 'Opus' }, rate_limits: { five_hour: { used_percentage: 62, resets_at: Math.round(Date.now() / 1000) + 5400 }, seven_day: { used_percentage: 88, resets_at: Math.round(Date.now() / 1000) + 200000 } } });
  await js(`document.querySelector('[data-tab=ai]').click()`); await shot('2-agent-kazini');
  const held = post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm install stripe' } });
  await wait(900); await shot('3-ruhusa');
  await js(`document.querySelector('[data-decide=allow]').click()`);
  const decision = (await (await held).json()).hookSpecificOutput?.decision?.behavior;
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\code\\duka\\checkout.js' } });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Nimeongeza field ya discount code. Unataka ikae juu ya total au chini yake?' });
  const reply = script('peep-reply.cjs', { session_id: 's1', cwd: 'C:\\code\\duka' });
  await wait(700); await shot('4-jibu-hapa');
  await js(`(() => { const i = document.querySelector('[data-reply-for]'); i.value = 'Iweke juu ya total'; document.querySelector('[data-reply]').click(); })()`);
  const woke = await reply;
  for (const tab of ['home', 'tray', 'focus', 'ask', 'music']) { await js(`document.querySelector('[data-tab=${tab}]').click()`); await wait(tab === 'ask' ? 800 : 0); await shot('5-' + tab); }
  await js(`document.querySelector('#pill').click()`); await wait(700); await shot('6-pill-in-use');
  console.log(JSON.stringify({ claudeHookEvents: Object.keys(config.hooks).length, stopHooks: config.hooks.Stop.length, statusLine: config.statusLine?.command.includes('peep-status.cjs') || false,
    sessionStartContext: (start.hookSpecificOutput?.additionalContext || '').slice(0, 60), statusLineText: status.out, decision, replyExit: woke.code, replyText: woke.err.trim().split('\n').pop(), rendererErrors: errors }, null, 1));
  app.exit(0);
});
