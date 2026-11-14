'use strict';
// "Ask about my screen": Peep takes one screenshot of the screen the island is on, and asks the coding agent you
// already use (Claude Code or Codex, through its own command-line program and your own login) your question about it.
// The screenshot lives in a temporary folder and is deleted right after the answer.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 3 * 60 * 1000;
const win = process.platform === 'win32';
const q = s => (win ? `"${String(s).replace(/"/g, '')}"` : s); // only for paths we made ourselves

/** The command line for an agent. The question always travels on stdin, never as an argument. */
function commandFor(agent, dir, image) {
  if (agent === 'codex') return { cmd: 'codex', args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', q(dir), '-i', q(image), '-'], parse: out => out.trim() };
  return {
    cmd: 'claude', args: ['-p', '--output-format', 'json', '--allowedTools', 'Read', '--add-dir', q(dir)],
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peep-ask-')), image = path.join(dir, 'screen.png');
  try {
    fs.writeFileSync(image, png);
    const prompt = agent === 'codex'
      ? `Answer this question about the attached screenshot, briefly and in plain language.\n\n${question}`
      : `Read the image file screen.png in ${dir} (a screenshot of my screen), then answer briefly and in plain language. Do not use any other tool.\n\n${question}`;
    return await run(commandFor(agent, dir, image), language ? prompt + '\n\n' + language : prompt, dir, t);
  } finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
}

module.exports = { ask, commandFor };
