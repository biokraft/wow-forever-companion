import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeClient, claudeArgs } from '../src/claude-client.js';
import { ADVICE_RULES, CHOICES_RULES } from '../src/advice-rules.js';

const FAKE = fileURLToPath(new URL('./fake-claude.js', import.meta.url));
let client;
afterEach(() => client?.stop());

const make = (env = {}, model = 'sonnet') => {
  client = new ClaudeClient({ command: process.execPath, prefixArgs: [FAKE], cwd: os.tmpdir(), env: { ...process.env, ...env }, model, repo: '/repo' });
  return client;
};
// Ids as the real CLI makes them (UUIDs); FAKE_SESSION is the one fake-claude reports.
const FAKE_SESSION = '11111111-1111-4111-8111-111111111111';
const SAVED = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const readLog = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('send streams text deltas and resolves on the result event', async () => {
  const c = make();
  const deltas = [];
  c.on('delta', (d) => deltas.push(d));
  assert.equal(await c.send('hi'), 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
});

test('tool use and usage are reported', async () => {
  const c = make();
  const tools = [];
  let usage;
  c.on('tool', (t) => tools.push(t));
  c.on('usage', (u) => { usage = u; });
  await c.send('hi');
  assert.deepEqual(tools, [{ name: 'Bash', phase: 'start' }]);
  assert.equal(usage.totalTokens, 12); // input + output; cached context left out
});

test('user messages use the stream-json shape and carry screenshots as image blocks', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile });
  await c.send('look', { images: [{ data: 'AAAA', mimeType: 'image/png' }] });
  const msg = readLog(logFile).find((x) => x.type === 'user');
  assert.equal(msg.parent_tool_use_id, null);
  assert.deepEqual(msg.message.content, [
    { type: 'text', text: 'look' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
  ]);
});

test('switching models restarts claude resuming the same session', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile });
  await c.send('first');
  await c.setModel('claude', 'haiku');
  assert.deepEqual(await c.currentModel(), { provider: 'claude', id: 'haiku' });
  await c.send('second');
  const argvs = readLog(logFile).filter((x) => x.argv).map((x) => x.argv);
  assert.equal(argvs.length, 2);
  const second = argvs[1];
  assert.equal(second[second.indexOf('--model') + 1], 'haiku');
  assert.equal(second[second.indexOf('--resume') + 1], FAKE_SESSION);
});

test('available models are the Claude Code aliases', async () => {
  assert.deepEqual((await make().availableModels()).map((m) => m.id), ['haiku', 'sonnet', 'opus']);
});

test('claudeArgs is headless, streaming, isolated, and locked to read-only tools plus safe wowf commands', () => {
  const a = claudeArgs({ model: 'sonnet', repo: '/repo' });
  for (const f of ['-p', '--input-format', 'stream-json', '--output-format', '--verbose', '--include-partial-messages']) assert.ok(a.includes(f), f);
  // isolation: no user settings/hooks/permission rules, no MCP servers, only our plugin
  for (const f of ['--restricted', '--strict-mcp-config']) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf('--plugin-dir') + 1], '/repo');
  assert.ok(a.includes('/repo/knowledge'), 'knowledge folder readable');
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.match(a[a.indexOf('--tools') + 1], /^Read,Glob,Grep,Bash,Skill/);
  const allowed = a.slice(a.indexOf('--allowedTools') + 1, a.indexOf('--disallowedTools'));
  assert.deepEqual(allowed.filter((x) => x.startsWith('Bash(')), [
    'Bash(node /repo/bin/wowf sync)', 'Bash(node /repo/bin/wowf sync *)', 'Bash(node /repo/bin/wowf state)', 'Bash(node /repo/bin/wowf state *)', 'Bash(node /repo/bin/wowf quests *)',
    'Bash(node /repo/bin/wowf npc *)', 'Bash(node /repo/bin/wowf plan show)', 'Bash(node /repo/bin/wowf plan show *)',
    'Bash(node /repo/bin/wowf plan write --json *)', 'Bash(node /repo/bin/wowf plan write drafts/*)',
    'Bash(node /repo/bin/wowf gameplan show)', 'Bash(node /repo/bin/wowf gameplan show *)',
    'Bash(node /repo/bin/wowf gameplan write drafts/*)', 'Bash(node /repo/bin/wowf gameplan write --json *)',
    'Bash(node /repo/bin/wowf knowledge *)',
  ]);
  for (const bad of ['init', 'install-addon', 'overlay']) assert.ok(a.includes(`Bash(node /repo/bin/wowf ${bad} *)`), `deny ${bad}`);
  assert.ok(!a.some((x) => /^(Edit|Write)$/.test(x)), 'Write/Edit only path-scoped');
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /node \/repo\/bin\/wowf/);
});

test('the prompt names the game plan commands and the draft file', () => {
  const prompt = (a) => a[a.indexOf('--append-system-prompt') + 1];
  const p = prompt(claudeArgs({ model: 'sonnet', repo: '/repo' }));
  assert.match(p, /gameplan show/);
  assert.match(p, /gameplan write drafts\/gameplan\.json/);
});

test('repo paths with spaces are quoted in the rules', () => {
  const a = claudeArgs({ model: 'sonnet', repo: '/my repo' });
  assert.ok(a.includes('Bash(node "/my repo/bin/wowf" npc *)'));
});

test('switching models during an answer rejects that answer instead of hanging', async () => {
  const c = make({ FAKE_CLAUDE_HANG: '1' });
  const pending = c.send('long question');
  await waitFor(() => c.sessionId === FAKE_SESSION, 'the answer to start');
  await c.setModel('claude', 'haiku');
  await assert.rejects(pending, /model|stopped|exited/i);
  assert.equal(c.run, null);
});

test('review: separate text blocks are separated by a blank line', async () => {
  const c = make({ FAKE_CLAUDE_TWO_BLOCKS: '1' });
  assert.equal(await c.send('hi'), 'Let me check.\n\nYou are level 8.');
});

test('review: the usage count leaves out cached context', async () => {
  const c = make({ FAKE_CLAUDE_TWO_BLOCKS: '1' });
  let usage;
  c.on('usage', (u) => { usage = u; });
  await c.send('hi');
  assert.equal(usage.totalTokens, 12);
});

test('research: web search allowed, web fetch only for WoW sites, knowledge cache writable', () => {
  const a = claudeArgs({ model: 'sonnet', repo: '/repo' });
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Glob,Grep,Bash,Skill,WebSearch,WebFetch,Write,Edit');
  // free text goes through files, never shell arguments (an apostrophe would break the quoting)
  for (const r of ['Write(./knowledge/*.md)', 'Edit(./knowledge/*.md)', 'Write(./drafts/*.json)', 'Edit(./drafts/*.json)']) assert.ok(a.includes(r), r);
  const denied = a.slice(a.indexOf('--disallowedTools') + 1);
  for (const r of ['Write(./knowledge/CLAUDE.md)', 'Write(./knowledge/claude.md)', 'Write(./knowledge/AGENTS.md)', 'Edit(./knowledge/CLAUDE.md)']) assert.ok(denied.includes(r), r);
  assert.ok(!a.includes('Write') && !a.includes('Edit'), 'no unrestricted Write/Edit');
  assert.ok(a.includes('Bash(node /repo/bin/wowf plan write drafts/*)'));
  assert.ok(a.includes('WebSearch'));
  assert.ok(a.includes('WebFetch(domain:warcraft.wiki.gg)'));
  assert.deepEqual(a.filter((x) => /^WebFetch\(domain:.*wowhead/i.test(x)), [], 'Wowhead allows only ordinary browsers');
  assert.ok(!a.includes('WebFetch'), 'no unrestricted WebFetch');
  assert.ok(a.includes('Bash(node /repo/bin/wowf knowledge *)'));
});

const argvsOf = (f) => readLog(f).filter((x) => x.argv).map((x) => x.argv);
const failure = (p) => p.then(() => assert.fail('expected a rejection'), (e) => e);

test('openSession resumes the given conversation on the next send', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile });
  assert.equal(c.canResume, true);
  c.openSession(SAVED);
  assert.equal(c.sessionId, SAVED);
  await c.send('hi');
  const [argv] = argvsOf(logFile);
  assert.equal(argv[argv.indexOf('--resume') + 1], SAVED);
});

test('openSession(null) starts a fresh conversation', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile });
  await c.send('first');
  assert.equal(c.sessionId, FAKE_SESSION);
  c.openSession(null);
  assert.equal(c.sessionId, null);
  await c.send('second');
  const argvs = argvsOf(logFile);
  assert.equal(argvs.length, 2, 'the running process was stopped and a new one started');
  assert.ok(!argvs[1].includes('--resume'));
});

test('a resume of a missing conversation rejects with code session_gone and forgets the id', async () => {
  const c = make({ FAKE_CLAUDE_GONE: '1' });
  c.openSession(SAVED);
  const err = await failure(c.send('hi'));
  assert.ok(err instanceof Error);
  assert.equal(err.code, 'session_gone');
  assert.equal(c.sessionId, null);
});

test('a missing conversation reported only by the exit is still session_gone', async () => {
  const c = make({ FAKE_CLAUDE_GONE: 'exit' });
  c.on('error', () => {}); // the overlay listens; the cause arrives through send()
  c.openSession(SAVED);
  const err = await failure(c.send('hi'));
  assert.equal(err.code, 'session_gone');
  assert.equal(c.sessionId, null);
});

test('another failure on resume keeps the id and has no code', async () => {
  const c = make({ FAKE_CLAUDE_CRASH: '1' });
  c.on('error', () => {}); // the overlay listens; the cause arrives through send()
  c.openSession(SAVED);
  const err = await failure(c.send('hi'));
  assert.ok(err instanceof Error);
  assert.equal(err.code, undefined);
  assert.equal(c.sessionId, SAVED);
});

// Waits until `cond()` holds, checking every 10 ms, or fails after `ms` (a loaded machine
// starts the fake process slowly, so a fixed sleep is not enough).
async function waitFor(cond, what, ms = 10000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('openSession during an answer throws', async () => {
  const c = make({ FAKE_CLAUDE_HANG: '1' });
  const pending = c.send('long question');
  pending.catch(() => {});
  await waitFor(() => c.sessionId === FAKE_SESSION, 'the session id of the running answer');
  const proc = c.proc;
  assert.throws(() => c.openSession(OTHER), /still answering/);
  assert.equal(c.proc, proc, 'the running answer was not killed');
  assert.ok(c.run);
  assert.equal(c.sessionId, FAKE_SESSION);
});

// ---- Session ids reach the CLI's argv, which also carries the sandbox flags: UUIDs only ----

const FLAG = '--dangerously-skip-permissions';

test('claudeArgs never emits a session id that is not a UUID', () => {
  for (const bad of [FLAG, '--resume', 'abc', 'sess-123', `${SAVED} ${FLAG}`, [SAVED], 42, {}]) {
    const a = claudeArgs({ model: 'sonnet', repo: '/repo', sessionId: bad });
    assert.ok(!a.includes('--resume'), `no --resume for ${JSON.stringify(bad)}`);
    assert.ok(!a.includes(bad));
  }
  const ok = claudeArgs({ model: 'sonnet', repo: '/repo', sessionId: SAVED });
  assert.deepEqual(ok.slice(-2), ['--resume', SAVED]);
});

test('openSession with an id that is not a UUID behaves as openSession(null)', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile });
  c.openSession(SAVED);
  c.openSession(FLAG);
  assert.equal(c.sessionId, null);
  await c.send('hi');
  const [argv] = argvsOf(logFile);
  assert.ok(!argv.includes(FLAG));
  assert.ok(!argv.includes('--resume'));
});

test('a session id from the process output that is not a UUID never reaches argv', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile, FAKE_CLAUDE_SESSION: FLAG });
  await c.send('first');
  assert.equal(c.sessionId, null, 'the reported id was not taken');
  await c.setModel('claude', 'haiku'); // restarts and would resume the learned id
  await c.send('second');
  const argvs = argvsOf(logFile);
  assert.equal(argvs.length, 2);
  for (const argv of argvs) {
    assert.ok(!argv.includes(FLAG));
    assert.ok(!argv.includes('--resume'));
  }
});

test('a session id set on the client directly still cannot reach argv', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_LOG: logFile, FAKE_CLAUDE_SESSION: FLAG });
  c.sessionId = FLAG;
  await c.send('hi');
  const [argv] = argvsOf(logFile);
  assert.ok(!argv.includes(FLAG));
  assert.ok(!argv.includes('--resume'));
});

test('after session_gone from a result the next send starts a fresh process at once', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-')), 'log.jsonl');
  const c = make({ FAKE_CLAUDE_GONE: '1', FAKE_CLAUDE_LOG: logFile });
  c.on('error', () => {});
  c.openSession(SAVED);
  const err = await failure(c.send('hi'));
  assert.equal(err.code, 'session_gone');
  assert.equal(c.proc, null, 'the dying process is detached');
  // No waiting for the exit: the retry must not be written to the process that is going away.
  assert.equal(await c.send('again'), 'Hello');
  const argvs = argvsOf(logFile);
  assert.equal(argvs.length, 2);
  assert.ok(argvs[0].includes('--resume'));
  assert.ok(!argvs[1].includes('--resume'));
});

test('the overlay companion may run the read-only state command', () => {
  const args = claudeArgs({ repo: '/repo' });
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  assert.ok(allowed.includes('Bash(node /repo/bin/wowf state)'));
  assert.ok(allowed.includes('Bash(node /repo/bin/wowf state *)'));
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /allowed: sync, state, /);
});

test('the appended system prompt refuses live combat advice', () => {
  const a = claudeArgs({ repo: '/repo' });
  assert.equal(a.filter((x) => x === '--append-system-prompt').length, 1, 'one system prompt, not two');
  const prompt = a[a.indexOf('--append-system-prompt') + 1];
  assert.ok(prompt.includes(ADVICE_RULES));
  assert.ok(prompt.includes(CHOICES_RULES), 'the reply chip rules go to Claude too');
  assert.match(prompt, /^Forever Companion overlay: run the toolkit CLI/, 'the toolkit instructions stay');
});

test('the command is resolved before it starts, ahead of the prefix arguments', async () => {
  const asked = [];
  const resolve = (name) => { asked.push(name); return { command: process.execPath, args: [FAKE] }; };
  client = new ClaudeClient({ command: 'fc-test-no-such-claude', cwd: os.tmpdir(), env: process.env, repo: '/repo', resolve });
  assert.equal(await client.send('hi'), 'Hello');
  assert.deepEqual(asked, ['fc-test-no-such-claude']);
});

test('compact() runs the CLI\'s own /compact and reports the activity and that it is done', async () => {
  const c = make();
  await c.send('hi');
  const tools = [];
  let compacted = 0;
  c.on('tool', (t) => tools.push(`${t.name}:${t.phase}`));
  c.on('compacted', () => compacted++);
  await c.compact();
  assert.deepEqual(tools, ['compact:start', 'compact:end']);
  assert.equal(compacted, 1);
  assert.equal(c.sessionId, FAKE_SESSION, 'the conversation continues');
});

test('compact() refuses while an answer is running', async () => {
  const c = make({ FAKE_CLAUDE_HANG: '1' });
  const pending = c.send('long question');
  pending.catch(() => {});
  await assert.rejects(() => c.compact(), /still answering/);
});

test('the Claude process starts with windowsHide, so Windows opens no console over the game', async () => {
  const { spawn } = await import('node:child_process');
  const seen = [];
  client = new ClaudeClient({ command: process.execPath, prefixArgs: [FAKE], cwd: os.tmpdir(), env: process.env, repo: '/repo',
    spawn: (cmd, args, opts) => { seen.push(opts); return spawn(cmd, args, opts); } });
  client.start();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].windowsHide, true);
});
test('on Windows the wowf command uses forward slashes, so Git Bash does not eat the backslashes', () => {
  const a = claudeArgs({ repo: 'D:\\Games\\wow-forever-companion\\', platform: 'win32' });
  const allowed = a.slice(a.indexOf('--allowedTools') + 1, a.indexOf('--disallowedTools'));
  assert.ok(allowed.includes('Bash(node D:/Games/wow-forever-companion/bin/wowf state)'));
  const denied = a.slice(a.indexOf('--disallowedTools') + 1);
  assert.ok(denied.includes('Bash(node D:/Games/wow-forever-companion/bin/wowf init *)'));
  assert.match(a[a.indexOf('--append-system-prompt') + 1], /`node D:\/Games\/wow-forever-companion\/bin\/wowf <command>`/);
  for (const x of a.filter((s) => s.includes('bin/wowf'))) assert.ok(!x.includes('\\'), x);
  const spaced = claudeArgs({ repo: 'C:\\Program Files\\wow-forever-companion', platform: 'win32' });
  assert.ok(spaced.includes('Bash(node "C:/Program Files/wow-forever-companion/bin/wowf" npc *)'));
  assert.ok(claudeArgs({ repo: '/repo/', platform: 'darwin' }).includes('Bash(node /repo/bin/wowf state)'));
});
test('the client offers a toolkit hint naming the exact allowed command path', async () => {
  const { ClaudeClient, wowfCommand } = await import('../src/claude-client.js');
  const c = new ClaudeClient({ repo: '/some/repo', spawn: () => { throw new Error('not started'); } });
  assert.ok(c.toolkitHint.includes(`${wowfCommand('/some/repo')} <command>`));
  assert.match(c.toolkitHint, /earlier in this chat/);
});
