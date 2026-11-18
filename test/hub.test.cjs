const test = require('node:test'), assert = require('node:assert');
const { Hub, describeTool } = require('../src/main/hooks-hub.js');

const post = (port, body, token = 'tok', q = '') => fetch(`http://127.0.0.1:${port}/pip/event${q}`, { method: 'POST', headers: { 'X-Pip-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('describeTool', () => {
  assert.deepEqual(describeTool('Read', { file_path: 'C:\\a\\b.js' }), { verb: 'Reading', detail: 'b.js' });
  assert.deepEqual(describeTool('Edit', { file_path: '/x/y/z.ts' }), { verb: 'Editing', detail: 'z.ts' });
  assert.equal(describeTool('Bash', { command: 'npm   test' }).detail, 'npm test');
});

test('session lifecycle and history', async () => {
  const hub = new Hub({ token: 't', doneIdleMs: 10 }); let finished = null; hub.on('finish', f => { finished = f; });
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: 'C:\\proj\\shop', prompt: 'fix the bug' });
  assert.equal(hub.snapshot().top, 'working');
  hub.handle({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\shop\\cart.js' } });
  hub.handle({ hook_event_name: 'PostToolUse', session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'C:\\proj\\shop\\cart.js' } });
  assert.equal(hub.snapshot().sessions[0].activity.detail, 'cart.js');
  hub.handle({ hook_event_name: 'Stop', session_id: 's1', last_assistant_message: 'Done.' });
  const snap = hub.snapshot();
  assert.equal(snap.top, 'done'); assert.equal(snap.history[0].project, 'shop'); assert.deepEqual(snap.history[0].edits, ['cart.js']);
  assert.equal(finished.entry.reply, 'Done.');
  // "done" reverts to idle on its own shortly after, not via the sweep (an error, unlike done, still needs it)
  await new Promise(r => hub.once('change', r)); assert.equal(hub.snapshot().top, 'idle');
  hub.handle({ hook_event_name: 'SessionEnd', session_id: 's1' }); assert.equal(hub.snapshot().sessions.length, 0);
});

test('done reverts to idle on its own; a new prompt within that window cancels the revert; error still needs the sweep', async () => {
  const hub = new Hub({ token: 't', doneIdleMs: 15 });
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', prompt: 'x' });
  hub.handle({ hook_event_name: 'Stop', session_id: 'a', last_assistant_message: 'ok' });
  hub.handle({ hook_event_name: 'UserPromptSubmit', session_id: 'a', prompt: 'one more thing' }); // before the timer fires
  assert.equal(hub.snapshot().top, 'working');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(hub.snapshot().top, 'working', 'the stale done-timer must not revert a session that moved on');

  hub.handle({ hook_event_name: 'StopFailure', session_id: 'a' });
  assert.equal(hub.snapshot().top, 'error');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(hub.snapshot().top, 'error', 'an error does not revert on its own - only the sweep clears it, after much longer');
  hub.sweep(Date.now() + 6 * 60e3); assert.equal(hub.snapshot().top, 'idle');
});

test('http: rejects a wrong token, holds a permission request until decided', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    assert.equal((await post(port, {}, 'nope')).status, 404);
    assert.equal((await post(port, { hook_event_name: 'UserPromptSubmit', session_id: 'a', prompt: 'x' })).status, 200);
    const waiting = post(port, { hook_event_name: 'PermissionRequest', session_id: 'a', tool_name: 'Bash', tool_input: { command: 'npm install' } });
    await new Promise(r => hub.once('change', r));
    const s = hub.snapshot().sessions[0];
    assert.equal(s.state, 'asking'); assert.equal(s.ask.detail, 'npm install'); assert.equal(s.ask.canAnswer, true);
    assert.equal(hub.decide('a', 'allow'), true);
    const body = await (await waiting).json();
    assert.equal(body.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(hub.snapshot().sessions[0].state, 'working');
    assert.equal(hub.decide('a', 'allow'), false);
  } finally { await hub.stop(); }
});

test('http: answering in the terminal releases the held request with no decision', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    const waiting = post(port, { hook_event_name: 'PermissionRequest', session_id: 'b', tool_name: 'Bash', tool_input: { command: 'ls' } });
    await new Promise(r => hub.once('change', r));
    await post(port, { hook_event_name: 'PostToolUse', session_id: 'b', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.deepEqual(await (await waiting).json(), {});
    assert.equal(hub.snapshot().sessions[0].ask, null);
  } finally { await hub.stop(); }
});

test('codex events are tagged and cannot be answered from the island', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    const r = await post(port, { hook_event_name: 'PermissionRequest', session_id: 'c', tool_name: 'shell', tool_input: { command: ['git', 'push'] } }, 'tok', '?agent=codex');
    assert.deepEqual(await r.json(), {});
    const s = hub.snapshot().sessions[0];
    assert.equal(s.agent, 'codex'); assert.equal(s.ask.canAnswer, false); assert.equal(s.ask.detail, 'git push');
  } finally { await hub.stop(); }
});

test('a new session is handed the extra instructions (answer in Swahili)', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); hub.context = 'Jibu kwa Kiswahili.'; const port = await hub.start();
  try {
    const start = await (await post(port, { hook_event_name: 'SessionStart', session_id: 'z' })).json();
    assert.deepEqual(start, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Jibu kwa Kiswahili.' } });
    assert.deepEqual(await (await post(port, { hook_event_name: 'PreToolUse', session_id: 'z', tool_name: 'Read' })).json(), {});
  } finally { await hub.stop(); }
});

test('rename: hooks still written by Peep (/peep/event, X-Peep-Token) keep working until Pip replaces them', async () => {
  const hub = new Hub({ token: 'tok', port: 0 }); const port = await hub.start();
  try {
    const old = (body, token = 'tok') => fetch(`http://127.0.0.1:${port}/peep/event`, { method: 'POST', headers: { 'X-Peep-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await old({ hook_event_name: 'UserPromptSubmit', session_id: 'old', prompt: 'x' })).status, 200);
    assert.equal(hub.snapshot().sessions.some(s => s.id === 'old'), true);
    assert.equal((await old({}, 'wrong')).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/other/event`, { method: 'POST', headers: { 'X-Pip-Token': 'tok' }, body: '{}' })).status, 404);
  } finally { await hub.stop(); }
});
