import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSetup, execCommand } from '../src/setup-check.js';

const okExec = async (cmd, args) => {
  if (args[0] === '--version') return { code: 0, stdout: '1.6.0' };
  if (args[0] === '--list-models') return { code: 0, stdout: 'openai/gpt-x\n' };
  return { code: 1, stdout: '' };
};
const okDeps = { exec: okExec, loadConfig: () => ({ main: 'Testa-Grimtusk' }), hasSnapshot: () => true };
const codes = (r) => r.problems.map((p) => p.code);

test('all good means ok and no problems', async () => {
  const r = await checkSetup(okDeps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.problems, []);
});

test('missing Pi is reported with an install hint', async () => {
  const r = await checkSetup({ ...okDeps, exec: async () => { throw Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }); } });
  assert.deepEqual(codes(r), ['no-pi']);
  assert.match(r.problems[0].text, /pi\.dev|npm install/);
});

test('Pi without any provider asks the player to log in', async () => {
  const exec = async (c, args) => (args[0] === '--list-models' ? { code: 0, stdout: 'No models available. Use /login' } : okExec(c, args));
  const r = await checkSetup({ ...okDeps, exec });
  assert.deepEqual(codes(r), ['no-provider']);
  assert.match(r.problems[0].text, /pi auth login/);
  // only logins the providers allow for third-party tools: an API key or OpenRouter
  assert.match(r.problems[0].text, /API key/);
  assert.match(r.problems[0].text, /openrouter/i);
  assert.doesNotMatch(r.problems[0].text, /copilot/i);
  assert.match(r.problems[0].text, /google[^.]*paid tier/i, 'Gemini keys are offered for the paid tier only');
});

test('missing config and missing snapshot are reported', async () => {
  const none = await checkSetup({ ...okDeps, loadConfig: () => null });
  assert.deepEqual(codes(none), ['no-config']);
  assert.match(none.problems[0].text, /node bin\/wowf setup/);
  assert.doesNotMatch(none.problems[0].text, /wowf init/);
  assert.deepEqual(codes(await checkSetup({ ...okDeps, hasSnapshot: () => false })), ['no-data']);
});

test('claude backend checks Claude Code instead of Pi', async () => {
  const exec = async (cmd, args) => {
    if (cmd === 'claude' && args[0] === '--version') return { code: 0, stdout: '2.1.300 (Claude Code)' };
    throw new Error('pi should not be called');
  };
  assert.deepEqual(codes(await checkSetup({ ...okDeps, exec, backend: 'claude' })), []);
  const missing = await checkSetup({ ...okDeps, backend: 'claude', exec: async () => { throw new Error('ENOENT'); } });
  assert.deepEqual(codes(missing), ['no-claude']);
});

test('review: an unreadable config becomes a setup problem, not a crash', async () => {
  const r = await checkSetup({ ...okDeps, loadConfig: () => { throw new SyntaxError('Unexpected token'); } });
  assert.deepEqual(codes(r), ['bad-config']);
  assert.match(r.problems[0].text, /config/);
  assert.match(r.problems[0].text, /node bin\/wowf setup/);
  assert.doesNotMatch(r.problems[0].text, /wowf init/);
});

test('execCommand starts the resolved command (an npm shim on Windows) with the arguments as an array', async () => {
  const resolve = (name) => (name === 'fc-test-no-such-pi' ? { command: process.execPath, args: ['-e', 'console.log(process.argv.slice(1).join("|"))', '--'] } : null);
  const r = await execCommand('fc-test-no-such-pi', ['--version', 'a b'], { resolve });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '--version|a b');
});
