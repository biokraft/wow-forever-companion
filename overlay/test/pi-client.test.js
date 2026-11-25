import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiClient, piArgs } from '../src/pi-client.js';
import { ADVICE_RULES, CHOICES_RULES } from '../src/advice-rules.js';

const FAKE = fileURLToPath(new URL('./fake-pi.js', import.meta.url));
let client;
afterEach(() => client?.stop());

function make(env = {}) {
  client = new PiClient({ command: process.execPath, args: [FAKE], cwd: os.tmpdir(), env: { ...process.env, ...env } });
  return client;
}

test('send streams deltas in order and resolves with the full text', async () => {
  const c = make();
  const deltas = [];
  c.on('delta', (d) => deltas.push(d));
  const text = await c.send('hi');
  assert.deepEqual(deltas, ['Hel', 'lo there']);
  assert.equal(text, 'Hello there');
});

test('tool activity and usage are reported', async () => {
  const c = make();
  const tools = [];
  let usage;
  c.on('tool', (t) => tools.push(t));
  c.on('usage', (u) => { usage = u; });
  await c.send('hi');
  assert.deepEqual(tools, [{ name: 'wow_state', phase: 'start' }, { name: 'wow_state', phase: 'end' }]);
  assert.equal(usage.totalTokens, 105);
});

test('images are attached to the prompt command', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  const c = make({ FAKE_PI_LOG: logFile });
  await c.send('look', { images: [{ data: 'AAAA', mimeType: 'image/png' }] });
  const prompt = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((x) => x.type === 'prompt');
  assert.deepEqual(prompt.images, [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]);
  assert.equal(prompt.message, 'look');
});

test('a crash mid-answer rejects with an error and the next send starts a fresh Pi', async () => {
  const flag = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'died');
  const c = make({ FAKE_PI_DIE_ONCE: flag });
  let errored;
  c.on('error', (e) => { errored = e; });
  await assert.rejects(c.send('first'), /exited/);
  assert.ok(errored);
  assert.equal(await c.send('second'), 'Hello\u2028there');
});

test('availableModels and setModel use the RPC commands', async () => {
  const c = make();
  assert.deepEqual(await c.availableModels(), [{ provider: 'fake', id: 'model-a', name: 'Model A' }]);
  await c.setModel('fake', 'model-a');
});

test('piArgs keeps Pi read-only and isolated', () => {
  const args = piArgs({ extensionPath: '/x/pi/extension.js', skillsPath: '/x/skills', model: 'openai/gpt' });
  const tools = args[args.indexOf('--tools') + 1].split(',');
  for (const t of ['bash', 'edit', 'write']) assert.ok(!tools.includes(t), t);
  for (const f of ['--mode', 'rpc', '--no-approve', '--no-extensions', '--no-skills', '-e', '/x/pi/extension.js', '--skill', '/x/skills', '--model', 'openai/gpt']) assert.ok(args.includes(f), f);
  assert.ok(tools.includes('wow_state') && tools.includes('wow_plan_write'));
  assert.ok(tools.includes('wow_gameplan'), 'the plan page can save the game plan');
});

test('piArgs tells Pi to refuse live combat advice', () => {
  const args = piArgs({ extensionPath: '/e', skillsPath: '/s', model: 'openai/gpt', sessionId: '22222222-2222-4222-8222-222222222222' });
  assert.equal(args.filter((a) => a === '--append-system-prompt').length, 1);
  assert.ok(args[args.indexOf('--append-system-prompt') + 1].includes(ADVICE_RULES));
  assert.ok(args[args.indexOf('--append-system-prompt') + 1].includes(CHOICES_RULES), 'the reply chip rules go to Pi too');
});

test('currentModel reads the active model from get_state', async () => {
  const c = make();
  assert.deepEqual(await c.currentModel(), { provider: 'fake', id: 'model-b' });
});

test('stop() during an answer rejects it instead of hanging', async () => {
  const c = make({ FAKE_PI_LOG: '' });
  const pending = c.send('hi');
  c.stop();
  await assert.rejects(pending, /stopped|exited/i);
});

const SAVED = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const FLAG = '--no-tools';
const argvsOf = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.argv).map((x) => x.argv);

test('piArgs passes the session id', () => {
  const args = piArgs({ extensionPath: '/x/pi/extension.js', skillsPath: '/x/skills', model: 'openai/gpt', sessionId: SAVED });
  assert.deepEqual(args.slice(-2), ['--session-id', SAVED]);
  assert.ok(!piArgs({ extensionPath: '/e', skillsPath: '/s' }).includes('--session-id'));
});

test('pi openSession restarts with that session id', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  const c = make({ FAKE_PI_LOG: logFile });
  assert.equal(c.canResume, true);
  assert.equal(c.sessionId, null);
  await c.send('first');
  // a fresh chat still gets an id, so it can be saved and continued later
  assert.match(c.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(argvsOf(logFile)[0].slice(-2), ['--session-id', c.sessionId]);
  c.openSession(SAVED);
  assert.equal(c.sessionId, SAVED);
  await c.send('second');
  const argvs = argvsOf(logFile);
  assert.equal(argvs.length, 2, 'the running process was stopped and a new one started');
  assert.deepEqual(argvs[1].slice(-2), ['--session-id', SAVED]);
});

test('pi openSession during an answer throws', async () => {
  const c = make();
  const pending = c.send('hi');
  pending.catch(() => {});
  assert.throws(() => c.openSession(OTHER), /still answering/);
  assert.ok(c.run);
});

// ---- Session ids reach Pi's argv, which also carries the tool limits: UUIDs only ----

test('piArgs never emits a session id that is not a UUID', () => {
  for (const bad of [FLAG, '--session-id', 'abc', `${SAVED} ${FLAG}`, [SAVED], 42, {}]) {
    const args = piArgs({ extensionPath: '/e', skillsPath: '/s', sessionId: bad });
    assert.ok(!args.includes('--session-id'), `no --session-id for ${JSON.stringify(bad)}`);
    assert.ok(!args.includes(bad));
  }
});

test('pi openSession with an id that is not a UUID behaves as openSession(null)', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  const c = make({ FAKE_PI_LOG: logFile });
  c.openSession(SAVED);
  c.openSession(FLAG);
  assert.equal(c.sessionId, null);
  await c.send('hi');
  const [argv] = argvsOf(logFile);
  assert.ok(!argv.includes(FLAG));
  assert.notEqual(c.sessionId, FLAG);
  assert.deepEqual(argv.slice(-2), ['--session-id', c.sessionId], 'a fresh id was made instead');
});

test('a pi session id set on the client directly still cannot reach argv', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  const c = make({ FAKE_PI_LOG: logFile });
  c.sessionId = FLAG;
  await c.send('hi');
  const [argv] = argvsOf(logFile);
  assert.ok(!argv.includes(FLAG));
  assert.match(argv.at(-1), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

// ---- The model picked in the dropdown outlives the process ----

const modelsIn = (argv) => argv.flatMap((a, i) => (a === '--model' ? [argv[i + 1]] : []));

test('the chosen model survives openSession', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  client = new PiClient({
    command: process.execPath, args: [FAKE, '--model', 'launch/model', '--tools', 'read'], cwd: os.tmpdir(),
    env: { ...process.env, FAKE_PI_LOG: logFile },
  });
  const c = client;
  await c.send('first');
  await c.setModel('fake', 'model-a');
  c.openSession(null); // what new, open and delete chat all do
  await c.send('second');
  const argvs = argvsOf(logFile);
  assert.equal(argvs.length, 2);
  assert.deepEqual(modelsIn(argvs[0]), ['launch/model']);
  assert.deepEqual(modelsIn(argvs[1]), ['fake/model-a'], 'the restarted Pi gets the chosen model, once');
  assert.deepEqual(argvs[1].slice(0, 4), ['--model', 'fake/model-a', '--tools', 'read'], 'the other launch arguments stay in place');
});

test('a chosen model is added when Pi was launched without one', async () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fakepi-')), 'log.jsonl');
  const c = make({ FAKE_PI_LOG: logFile });
  await c.setModel('fake', 'model-a');
  c.openSession(null);
  await c.send('hi');
  const argvs = argvsOf(logFile);
  assert.deepEqual(modelsIn(argvs[0]), []);
  assert.deepEqual(modelsIn(argvs[1]), ['fake/model-a']);
  assert.deepEqual(argvs[1].slice(-2), ['--session-id', c.sessionId], 'the session id stays last');
});

test('the command is resolved before it starts (Windows npm shims run through node, no shell)', async () => {
  const asked = [];
  // Stands in for resolveTool finding pi.cmd: node plus the script the shim runs.
  const resolve = (name, o) => { asked.push([name, o.env.FAKE_MARK]); return { command: process.execPath, args: [FAKE] }; };
  // A name no machine has, so the test never starts a real Pi.
  client = new PiClient({ command: 'fc-test-no-such-pi', args: [], cwd: os.tmpdir(), env: { ...process.env, FAKE_MARK: 'x' }, resolve });
  assert.equal(await client.send('hi'), 'Hello\u2028there');
  assert.deepEqual(asked, [['fc-test-no-such-pi', 'x']]);
});

test('compaction shows as an activity and reports when it succeeded', async () => {
  const c = make({ FAKE_PI_COMPACT: 'during' });
  const tools = [];
  let compacted = 0;
  c.on('tool', (t) => tools.push(`${t.name}:${t.phase}`));
  c.on('compacted', () => compacted++);
  await c.send('hi');
  assert.ok(tools.includes('compact:start') && tools.includes('compact:end'));
  assert.equal(compacted, 1);
});

test('a compaction that failed or was aborted is not reported as done', async () => {
  const c = make({ FAKE_PI_COMPACT: 'failed' });
  let compacted = 0;
  c.on('compacted', () => compacted++);
  await c.send('hi');
  assert.equal(compacted, 0);
});

test('compact() sends the compact command and refuses during an answer', async () => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-pi-compact-')), 'log');
  const c = make({ FAKE_PI_LOG: log });
  await c.send('hi');
  await c.compact();
  const cmds = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l).type).filter(Boolean);
  assert.ok(cmds.includes('compact'));
  c.stop();
  const c2 = make({ FAKE_PI_HANG: '1' });
  const pending = c2.send('long');
  pending.catch(() => {});
  await assert.rejects(() => c2.compact(), /still answering/);
  c2.stop();
});

test('the Pi process starts with windowsHide, so Windows opens no console over the game', async () => {
  const { spawn } = await import('node:child_process');
  const seen = [];
  client = new PiClient({ command: process.execPath, args: [FAKE], cwd: os.tmpdir(), env: process.env,
    spawn: (cmd, args, opts) => { seen.push(opts); return spawn(cmd, args, opts); } });
  client.start();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].windowsHide, true);
});