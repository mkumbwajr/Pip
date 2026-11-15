'use strict';
// "Ask about my screen": Pip takes one screenshot of the screen the island is on, and asks the coding agent you
// already use (Claude Code or Codex, through its own command-line program and your own login) your question about it.
// The screenshot lives in a temporary folder and is deleted right after the answer.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 3 * 60 * 1000;
const win = process.platform === 'win32';
const q = s => (win ? `"${String(s).replace(/"/g, '')}"` : s); // only for paths we made ourselves

// Pip's own questions run Claude Code bare: no hooks (Pip's hooks would show the question as an agent session, and the
// reply hook would wait for an answer) and no MCP servers (starting them made one short answer take minutes).
function quiet(dir) { const f = path.join(dir, 'pip-settings.json'); fs.writeFileSync(f, JSON.stringify({ disableAllHooks: true })); return ['--settings', q(f), '--strict-mcp-config']; }

/** The command line for an agent. The question always travels on stdin, never as an argument. */
function commandFor(agent, dir, image) {
  if (agent === 'codex') return { cmd: 'codex', args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', q(dir), '-i', q(image), '-'], parse: out => out.trim() };
  return {
    cmd: 'claude', args: ['-p', '--output-format', 'json', ...quiet(dir), '--allowedTools', 'Read', '--add-dir', q(dir)],
    parse: out => { try { return String(JSON.parse(out).result || '').trim(); } catch { return out.trim(); } }
  };
}

function run({ cmd, args, parse }, input, cwd, t) {
  return new Promise((resolve, reject) => {
    // shell on Windows: npm installs these programs as .cmd files, which cannot be started directly
    const child = spawn(cmd, args, { cwd, shell: win, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(t('The agent took too long.'))); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(t('{program} is not installed on this PC.', { program: cmd })) : e); });
    child.on('close', code => {
      clearTimeout(timer);
      const text = parse(out);
      if (text) resolve(text); else reject(new Error(code === 127 || /not recognized|not found/i.test(err) ? t('{program} is not installed on this PC.', { program: cmd }) : (err.trim().split('\n').pop() || t('No answer.'))));
    });
    child.stdin.end(input);
  });
}

/** png: Buffer of the screenshot. Returns the agent's answer as text. */
async function ask({ agent = 'claude', question, png, language = '', t = s => s }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-ask-')), image = path.join(dir, 'screen.png');
  try {
    fs.writeFileSync(image, png);
    const prompt = agent === 'codex'
      ? `Answer this question about the attached screenshot, briefly and in plain language.\n\n${question}`
      : `Read the image file screen.png in ${dir} (a screenshot of my screen), then answer briefly and in plain language. Do not use any other tool.\n\n${question}`;
    return await run(commandFor(agent, dir, image), languageRule(language) + prompt, dir, t);
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

/** A plain chat with Pip: the agent answers from the conversation alone, in an empty folder, with no screenshot.
    messages: [{ role: 'me' | 'pip', text }], newest last. Nothing is kept: the whole conversation is sent each turn. */
// Pip's chat answers in Pip's own language. Said first and firmly: an English error or English text pasted into the
// question otherwise pulls the answer into English. Asking for a translation is the one exception.
const languageRule = language => (language ? language + ' This holds even when the message, or text quoted in it, is in English. Only when the user asks for a translation (or for another language) do you write that language.\n\n' : '');
function chatPrompt(messages, name = 'Pip', language = '') {
  const lines = messages.slice(-12).map(m => `${m.role === 'me' ? 'User' : name}: ${String(m.text || '').slice(0, 4000)}`);
  return `You are ${name}, a small friendly helper living in a status island at the top of the user's screen. Answer the last message `
    + 'briefly and in plain language: short paragraphs, no headings, no tables. Do not use any tools and do not read or change any files.\n\n'
    + languageRule(language) + lines.join('\n\n') + `\n\n${name}:`;
}
async function chat({ agent = 'claude', messages = [], name = 'Pip', language = '', t = s => s }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pip-chat-'));
  try {
    const prompt = chatPrompt(messages, name, language);
    const cmd = agent === 'codex'
      ? { cmd: 'codex', args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', q(dir), '-'], parse: out => out.trim() }
      : { cmd: 'claude', args: ['-p', '--output-format', 'json', ...quiet(dir)], parse: out => { try { return String(JSON.parse(out).result || '').trim(); } catch { return out.trim(); } } };
    return await run(cmd, prompt, dir, t);
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

module.exports = { ask, chat, chatPrompt, commandFor, languageRule };
