// Checks everything the overlay needs before chatting. Dependencies are injected for tests.
import { spawn } from 'node:child_process';
import { resolveTool } from '../../src/tool-command.js';

// `resolve` finds how to start the program without a shell (an npm .cmd shim on Windows).
export function execCommand(cmd, args, { timeoutMs = 15000, resolve: resolveCmd = resolveTool } = {}) {
  return new Promise((resolve, reject) => {
    const tool = resolveCmd(cmd);
    const p = spawn(tool.command, [...tool.args, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stdout += d; });
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout }); });
  });
}

export async function checkSetup({ exec = execCommand, loadConfig, hasSnapshot, piCommand = 'pi', backend = 'pi' }) {
  const problems = [];
  if (backend === 'claude') {
    const ok = await exec('claude', ['--version']).then((r) => r.code === 0).catch(() => false);
    if (!ok) problems.push({ code: 'no-claude', text: 'Claude Code is not installed or not on PATH. Install it from https://claude.com/claude-code and sign in once by running claude in a terminal.' });
    return withData(problems, loadConfig, hasSnapshot);
  }
  let pi = true;
  try {
    const v = await exec(piCommand, ['--version']);
    if (v.code !== 0) pi = false;
  } catch {
    pi = false;
  }
  if (!pi) {
    problems.push({ code: 'no-pi', text: 'Pi is not installed. Install it from https://pi.dev (curl -fsSL https://pi.dev/install.sh | sh) or with npm install -g @earendil-works/pi-coding-agent.' });
  } else {
    const models = await exec(piCommand, ['--list-models']).catch(() => ({ code: 1, stdout: '' }));
    if (models.code !== 0 || /No models available/i.test(models.stdout) || !models.stdout.trim()) {
      problems.push({ code: 'no-provider', text: 'Pi has no AI provider yet. In a terminal run: pi auth login <provider> --api-key with your own API key (openai, anthropic, or google with a Gemini key on the paid tier), or pi auth login openrouter, then reopen the overlay.' });
    }
  }
  return withData(problems, loadConfig, hasSnapshot);
}

function withData(problems, loadConfig, hasSnapshot) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    problems.push({ code: 'bad-config', text: `The Forever Companion config file can't be read (${e.message}). Fix or delete it (~/.config/forever-companion/config.json; on Windows %APPDATA%\\forever-companion\\config.json), then in the wow-forever-companion folder run: node bin/wowf setup` });
    return { ok: false, problems };
  }
  if (!cfg) {
    problems.push({ code: 'no-config', text: 'Forever Companion is not set up. In a terminal, in the wow-forever-companion folder, run: node bin/wowf setup' });
  } else if (!hasSnapshot(cfg)) {
    problems.push({ code: 'no-data', text: 'No character data yet. Log in to WoW and type /fc sync.' });
  }
  return { ok: problems.length === 0, problems };
}
