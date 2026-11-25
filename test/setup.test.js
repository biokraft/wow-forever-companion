import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runSetup, runCommand, windowsCommandLine, AI_LOGINS, installOverlayPackages, overlayElectronReady, electronMissingText } from '../src/setup.js';
import { agentPath } from '../src/autostart.js';

// Absolute paths in the form of the OS running the tests (setup resolves what it is given).
const HOME = path.resolve('/players/me');
const GAME = path.resolve('/Games/World of Warcraft/_forever_');
const DATA = path.resolve('/data/my wow');
const OVERLAY = path.resolve('/fc/overlay');
const PATH_TXT = path.join(OVERLAY, 'node_modules', 'electron', 'path.txt');
const PROGRAM = 'Electron.app/Contents/MacOS/Electron';
const ELECTRON_BIN = path.join(OVERLAY, 'node_modules', 'electron', 'dist', PROGRAM);
const IDS = ['node', 'game', 'character', 'data', 'addon', 'overlay', 'ai', 'autostart', 'finish'];
const CHARS = [
  { account: 'A', realmDir: 'R', folder: 'Alt-Realm', svPath: 'x', hasData: false },
  { account: 'A', realmDir: 'R', folder: 'Main-Realm', svPath: 'y', hasData: true },
];

// A fake machine: files, config, game, npm and Pi all in memory; every call is recorded.
function world(over = {}) {
  const state = {
    cfg: null, files: new Set(), chars: CHARS, gameFound: GAME, addonCurrent: false,
    piInstalled: true, piProvider: true, npmMakesPathTxt: true, rebuildMakesPathTxt: true,
    ...over,
  };
  if (over.files) state.files = new Set(over.files);
  const calls = { initData: [], installAddon: [], run: [], enableAutostart: [] };
  const deps = {
    nodeVersion: 'v22.3.0', platform: 'darwin', home: HOME, overlayDir: OVERLAY,
    // Electron's program arrives with path.txt unless a test says the extraction left it out.
    exists: (p) => state.files.has(p) || (p === ELECTRON_BIN && state.files.has(PATH_TXT) && !state.noProgram),
    readFile: (p) => {
      if (p === PATH_TXT && state.files.has(PATH_TXT)) return PROGRAM;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    findGameDir: () => state.gameFound,
    isGameDir: (d) => d === GAME || d === state.gameFound,
    listCharacters: () => state.chars,
    loadConfig: () => state.cfg,
    initData: (o) => {
      calls.initData.push(o);
      // The scaffold creates what is missing: a new folder, or parts an earlier run left out.
      const created = !state.files.has(o.dataDir) || Boolean(state.scaffoldIncomplete);
      state.scaffoldIncomplete = false;
      state.cfg = { ...state.cfg, gameDir: o.gameDir, dataDir: o.dataDir, main: o.main };
      state.files.add(o.dataDir);
      return { cfg: state.cfg, gitFailed: false, created };
    },
    addonCurrent: () => state.addonCurrent,
    installAddon: (g, ...rest) => { calls.installAddon.push([g, ...rest]); state.addonCurrent = true; return `${g}/Interface/AddOns/ForeverLog`; },
    enableAutostart: (o) => { calls.enableAutostart.push(o); state.files.add(agentPath(HOME)); return agentPath(HOME); },
    run: async (cmd, args, o) => {
      calls.run.push([cmd, args, o]);
      const a = args.join(' ');
      if (cmd === 'npm' && a === 'ci' && state.npmFails) return { code: 1, stdout: 'npm ERR! EBUSY' };
      if (cmd === 'npm' && a === 'ci') { if (state.npmMakesPathTxt) state.files.add(PATH_TXT); return { code: 0, stdout: '' }; }
      if (cmd === 'npm' && a === 'rebuild electron') { if (state.rebuildMakesPathTxt) state.files.add(PATH_TXT); return { code: 0, stdout: '' }; }
      if (cmd === 'npm' && a.startsWith('install -g')) { state.piInstalled = true; return { code: 0, stdout: '' }; }
      if (cmd === 'npm') return { code: 0, stdout: '' };
      if (cmd === 'pi' && !state.piInstalled) return { code: 127, stdout: '' };
      if (cmd === 'pi' && a === '--version') return { code: 0, stdout: '1.6.0\n' };
      if (cmd === 'pi' && a === '--list-models') return { code: 0, stdout: state.piProvider ? 'openai gpt-x\n' : 'No models available\n' };
      if (cmd === 'pi' && args[0] === 'auth') { state.piProvider = true; return { code: 0 }; }
      return { code: 1, stdout: '' };
    },
  };
  return { state, calls, deps };
}

// answers: [regex, answer] pairs matched against the question in order; no match takes the fallback.
function fakeIo(answers = []) {
  const asked = [];
  const said = [];
  const io = {
    say: (t) => said.push(t),
    ask: async (q, o = {}) => {
      asked.push({ q, ...o, saidBefore: said.length });
      const hit = answers.find(([re]) => re.test(q));
      return hit ? hit[1] : o.fallback;
    },
  };
  return { io, asked, said };
}

const ANSWERS = [
  [/main/i, 'Main-Realm'],
  [/progress data/i, DATA],
  [/chat overlay/i, 'y'],
  [/log in to your Mac/i, 'y'],
];
const status = (r) => Object.fromEntries(r.steps.map((s) => [s.id, s.status]));
const step = (r, id) => r.steps.find((s) => s.id === id);

test('fresh machine with answers: every step done', async () => {
  const w = world({ piInstalled: false, piProvider: false });
  const { io } = fakeIo([[/Install it now/i, 'y'], [/AI login/, 'OpenAI API key'], ...ANSWERS]);
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((s) => s.id), IDS);
  assert.deepEqual(Object.values(status(r)), IDS.map(() => 'done'));
  assert.deepEqual(w.calls.initData, [{ gameDir: GAME, dataDir: DATA, main: 'Main-Realm', git: true }]);
  assert.deepEqual(w.calls.installAddon, [[GAME]]);
  assert.deepEqual(w.calls.enableAutostart, [{ overlayDir: OVERLAY }]);
});

test('second run with everything in place: nothing is redone', async () => {
  const w = world();
  await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  w.calls.initData.length = 0;
  w.calls.installAddon.length = 0;
  w.calls.run.length = 0;
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const s = status(r);
  for (const id of ['game', 'character', 'data', 'addon', 'overlay']) assert.equal(s[id], 'already', id);
  assert.equal(s.ai, 'already');
  assert.equal(s.autostart, 'already');
  // The scaffold always runs (it never overwrites), so a folder half-made last time is completed.
  assert.equal(w.calls.initData.length, 1);
  assert.equal(w.calls.installAddon.length, 0);
  assert.ok(!w.calls.run.some(([cmd, args]) => cmd === 'npm' && (args[0] === 'ci' || args[0] === 'install')));
  assert.equal(r.ok, true);
});

test('a data folder an earlier run left incomplete is completed on a re-run', async () => {
  const w = world();
  await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  w.state.scaffoldIncomplete = true;
  w.calls.initData.length = 0;
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  assert.equal(w.calls.initData.length, 1);
  assert.equal(step(r, 'data').status, 'done');
});

test('an outdated addon is refreshed on a later run', async () => {
  const w = world();
  await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  w.state.addonCurrent = false;
  w.calls.installAddon.length = 0;
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  assert.equal(step(r, 'addon').status, 'done');
  assert.deepEqual(w.calls.installAddon, [[GAME]]);
});

test('after a failed overlay install the overlay is retried and earlier steps are already', async () => {
  const w = world({ npmMakesPathTxt: false, rebuildMakesPathTxt: false });
  const first = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  assert.equal(step(first, 'overlay').status, 'failed');
  assert.equal(first.ok, false);
  w.state.npmMakesPathTxt = true;
  w.calls.run.length = 0;
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const s = status(r);
  for (const id of ['game', 'character', 'data', 'addon']) assert.equal(s[id], 'already', id);
  assert.equal(s.overlay, 'done');
  assert.ok(w.calls.run.some(([cmd, args]) => cmd === 'npm' && args.join(' ') === 'ci'));
  assert.equal(r.ok, true);
});

test('Node 20: node fails and nothing else runs', async () => {
  const w = world();
  w.deps.nodeVersion = 'v20.11.0';
  const { io, asked } = fakeIo(ANSWERS);
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  assert.equal(r.ok, false);
  assert.deepEqual(r.steps.map((s) => s.id), ['node']);
  assert.equal(r.steps[0].status, 'failed');
  assert.match(r.steps[0].text, /22/);
  assert.match(r.steps[0].text, /nodejs\.org/);
  assert.equal(asked.length, 0);
  assert.equal(w.calls.run.length + w.calls.initData.length + w.calls.installAddon.length, 0);
});

test('game not found: the asked path with spaces reaches installAddon unchanged; run never gets a shell string', async () => {
  const typed = path.resolve('/My Games/World of Warcraft/_forever_');
  const w = world({ gameFound: null });
  w.deps.isGameDir = (d) => d === typed;
  const { io, asked } = fakeIo([[/_forever_/, typed], ...ANSWERS]);
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  assert.equal(step(r, 'game').status, 'done');
  assert.ok(asked.some((a) => /_forever_/.test(a.q)));
  assert.deepEqual(w.calls.installAddon, [[typed]]);
  assert.equal(w.calls.initData[0].gameDir, typed);
  for (const [cmd, args] of w.calls.run) {
    assert.ok(Array.isArray(args));
    assert.ok(!/\s/.test(cmd), cmd);
  }
});

test('a quoted path loses its quotes; a wrong folder is asked again', async () => {
  const w = world({ gameFound: null });
  const answers = ['/tmp/nope', `"${GAME}"`];
  const { io } = fakeIo(ANSWERS);
  const ask = io.ask;
  io.ask = async (q, o) => (/_forever_/.test(q) ? answers.shift() : ask(q, o));
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  assert.equal(answers.length, 0);
  assert.equal(step(r, 'game').status, 'done');
  assert.deepEqual(w.calls.installAddon, [[GAME]]);
});

test('no characters yet: character skipped with a rerun hint, config still written with main null', async () => {
  const w = world({ chars: [] });
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const c = step(r, 'character');
  assert.equal(c.status, 'skipped');
  assert.match(c.text, /log in/i);
  assert.match(c.text, /node bin\/wowf setup/);
  assert.equal(w.calls.initData.length, 1);
  assert.equal(w.calls.initData[0].main, null);
  assert.equal(w.state.cfg.main, null);
});

test('--main must name an existing character folder', async () => {
  const w = world();
  const r = await runSetup({ opts: { yes: true, main: 'Nobody-Realm', dataDir: DATA }, io: fakeIo().io, deps: w.deps });
  assert.equal(step(r, 'character').status, 'failed');
  assert.equal(r.ok, false);
  assert.equal(w.calls.initData.length, 0);
});

test('an unreadable config is not overwritten', async () => {
  const w = world();
  w.deps.loadConfig = () => { throw new SyntaxError('Unexpected token'); };
  const r = await runSetup({ opts: { yes: true, dataDir: DATA }, io: fakeIo().io, deps: w.deps });
  assert.equal(step(r, 'data').status, 'failed');
  assert.match(step(r, 'data').text, /Fix or delete it/);
  assert.equal(w.calls.initData.length, 0);
  assert.equal(r.ok, false);
});

test('setup refuses the home folder as data folder', async () => {
  const w = world();
  const r = await runSetup({ opts: { yes: true, dataDir: HOME }, io: fakeIo().io, deps: w.deps });
  assert.equal(step(r, 'data').status, 'failed');
  assert.equal(w.calls.initData.length, 0);
});

test('overlay install: npm ci in the overlay folder (never rewrites the lockfile); no approval when Electron arrived', async () => {
  const w = world();
  await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const npm = w.calls.run.filter(([cmd]) => cmd === 'npm');
  assert.deepEqual(npm[0], ['npm', ['ci'], { cwd: OVERLAY }]);
  assert.ok(!npm.some(([, args]) => args[0] === 'install-scripts' || args[0] === 'rebuild'));
});

test('overlay install: approve and rebuild Electron when its app is missing', async () => {
  const w = world({ npmMakesPathTxt: false });
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const npm = w.calls.run.filter(([cmd]) => cmd === 'npm').map(([, args, o]) => [args, o]);
  assert.deepEqual(npm.slice(0, 3), [
    [['ci'], { cwd: OVERLAY }],
    [['install-scripts', 'approve', 'electron'], { cwd: OVERLAY }],
    [['rebuild', 'electron'], { cwd: OVERLAY }],
  ]);
  assert.equal(step(r, 'overlay').status, 'done');
});

test('overlay install: still no Electron after the rebuild is a plain failure', async () => {
  const w = world({ npmMakesPathTxt: false, rebuildMakesPathTxt: false });
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  const o = step(r, 'overlay');
  assert.equal(o.status, 'failed');
  assert.match(o.text, /^[A-Z][^\n]*\.$/);
  assert.match(o.text, /node bin\/wowf setup/);
  assert.equal(step(r, 'ai').status, 'skipped');
  assert.equal(step(r, 'autostart').status, 'skipped');
  assert.equal(step(r, 'finish').status, 'done');
  assert.equal(r.ok, false);
});

test('on Windows a failed overlay install says to close the chat overlay first', async () => {
  for (const [over, failed] of [[{ npmMakesPathTxt: false, rebuildMakesPathTxt: false }, 'electron'], [{ npmFails: true }, 'install']]) {
    const w = world(over);
    w.deps.platform = 'win32';
    const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
    assert.equal(step(r, 'overlay').status, 'failed', failed);
    assert.match(step(r, 'overlay').text, /close the chat overlay/i, failed);
    const mac = world(over);
    const m = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: mac.deps });
    assert.doesNotMatch(step(m, 'overlay').text, /close the chat overlay/i, failed);
  }
});

test('AI logins: six allowed entries, real Pi providers, never a subscription coding login', () => {
  assert.deepEqual(AI_LOGINS.map((l) => l.id), ['openai-key', 'anthropic-key', 'google-key', 'openrouter', 'chatgpt', 'skip']);
  const byId = Object.fromEntries(AI_LOGINS.map((l) => [l.id, l.args]));
  assert.deepEqual(byId['openai-key'], ['auth', 'login', 'openai', '--api-key']);
  assert.deepEqual(byId['anthropic-key'], ['auth', 'login', 'anthropic', '--api-key']);
  assert.deepEqual(byId['google-key'], ['auth', 'login', 'google', '--api-key']);
  assert.deepEqual(byId.openrouter, ['auth', 'login', 'openrouter']);
  assert.deepEqual(byId.chatgpt, ['auth', 'login', 'openai']);
  assert.deepEqual(byId.skip, []);
  const all = AI_LOGINS.flatMap((l) => l.args).join(' ');
  assert.doesNotMatch(all, /codex|copilot|coding|kimi|zai/i);
  assert.match(AI_LOGINS.find((l) => l.id === 'google-key').label, /paid tier/);
  assert.match(AI_LOGINS.find((l) => l.id === 'chatgpt').label, /Sign in with ChatGPT/);
});

test('AI: Pi missing and the install declined is skipped with the install command', async () => {
  const w = world({ piInstalled: false });
  const r = await runSetup({ opts: {}, io: fakeIo([[/Install it now/i, 'n'], ...ANSWERS]).io, deps: w.deps });
  const ai = step(r, 'ai');
  assert.equal(ai.status, 'skipped');
  assert.match(ai.text, /npm install -g @earendil-works\/pi-coding-agent/);
  assert.ok(!w.calls.run.some(([cmd, args]) => cmd === 'npm' && args.includes('-g')));
});

test('AI: Pi missing and accepted installs Pi, then asks for a login', async () => {
  const w = world({ piInstalled: false, piProvider: false });
  const r = await runSetup({ opts: {}, io: fakeIo([[/Install it now/i, 'y'], [/AI login/, 'OpenRouter'], ...ANSWERS]).io, deps: w.deps });
  assert.ok(w.calls.run.some(([cmd, args]) => cmd === 'npm' && args.join(' ') === 'install -g @earendil-works/pi-coding-agent'));
  assert.equal(step(r, 'ai').status, 'done');
});

test('AI: no provider shows the 18+ sentence, then exactly the six labels, then runs pi with the terminal', async () => {
  const w = world({ piProvider: false });
  const chosen = AI_LOGINS.find((l) => l.id === 'chatgpt');
  const { io, asked, said } = fakeIo([[/AI login/, chosen.label], ...ANSWERS]);
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  const menu = asked.find((a) => /AI login/.test(a.q));
  assert.deepEqual(menu.choices, AI_LOGINS.map((l) => l.label));
  const adult = said.findIndex((t) => /18 or older/.test(t));
  assert.ok(adult >= 0 && adult < menu.saidBefore, '18+ sentence comes before the menu');
  const login = w.calls.run.find(([cmd, args]) => cmd === 'pi' && args[0] === 'auth');
  assert.deepEqual(login, ['pi', chosen.args, { inherit: true }]);
  assert.equal(step(r, 'ai').status, 'done');
});

test('AI: choosing Skip runs no login', async () => {
  const w = world({ piProvider: false });
  const skip = AI_LOGINS.find((l) => l.id === 'skip');
  const r = await runSetup({ opts: {}, io: fakeIo([[/AI login/, skip.label], ...ANSWERS]).io, deps: w.deps });
  assert.equal(step(r, 'ai').status, 'skipped');
  assert.ok(!w.calls.run.some(([cmd, args]) => cmd === 'pi' && args[0] === 'auth'));
});

test('AI: a login that did not finish fails with the retry command', async () => {
  const w = world({ piProvider: false });
  const run = w.deps.run;
  w.deps.run = async (cmd, args, o) => (cmd === 'pi' && args[0] === 'auth' ? { code: 1 } : run(cmd, args, o));
  const r = await runSetup({ opts: {}, io: fakeIo([[/AI login/, 'OpenAI API key'], ...ANSWERS]).io, deps: w.deps });
  assert.equal(step(r, 'ai').status, 'failed');
  assert.match(step(r, 'ai').text, /node bin\/wowf setup/);
});

test('--yes never asks, leaves the AI login and start at login to the player', async () => {
  const w = world({ piProvider: false });
  const { io, asked } = fakeIo(ANSWERS);
  const r = await runSetup({ opts: { yes: true, dataDir: DATA }, io, deps: w.deps });
  assert.equal(asked.length, 0);
  const s = status(r);
  assert.equal(s.ai, 'skipped');
  assert.match(step(r, 'ai').text, /node bin\/wowf setup/);
  assert.equal(s.autostart, 'skipped');
  assert.ok(!w.calls.run.some(([cmd, args]) => cmd === 'pi' && args[0] === 'auth'));
  assert.ok(!w.calls.run.some(([cmd, args]) => cmd === 'npm' && args.includes('-g')));
  assert.equal(w.calls.initData[0].main, 'Main-Realm', 'defaults to the character with data');
  assert.equal(s.overlay, 'done', '--yes accepts the overlay default');
  assert.equal(r.ok, true);
});

test('--yes with Pi missing also skips and names the command', async () => {
  const w = world({ piInstalled: false });
  const r = await runSetup({ opts: { yes: true, dataDir: DATA }, io: fakeIo().io, deps: w.deps });
  assert.equal(step(r, 'ai').status, 'skipped');
  assert.match(step(r, 'ai').text, /node bin\/wowf setup/);
});

test('--yes with no data folder flag uses ~/wow-companion; game not found fails without asking', async () => {
  const w = world();
  await runSetup({ opts: { yes: true }, io: fakeIo().io, deps: w.deps });
  assert.equal(w.calls.initData[0].dataDir, path.join(HOME, 'wow-companion'));
  const w2 = world({ gameFound: null });
  const { io, asked } = fakeIo();
  const r = await runSetup({ opts: { yes: true }, io, deps: w2.deps });
  assert.equal(step(r, 'game').status, 'failed');
  assert.match(step(r, 'game').text, /--game-dir/);
  assert.equal(asked.length, 0);
  assert.equal(r.ok, false);
});

test('--no-overlay skips overlay, ai and autostart', async () => {
  const w = world();
  const r = await runSetup({ opts: { overlay: false }, io: fakeIo(ANSWERS).io, deps: w.deps });
  const s = status(r);
  assert.equal(s.overlay, 'skipped');
  assert.equal(s.ai, 'skipped');
  assert.equal(s.autostart, 'skipped');
  assert.equal(w.calls.run.length, 0);
});

test('start at login is offered on macOS only', async () => {
  const w = world();
  w.deps.platform = 'win32';
  const { io, asked } = fakeIo(ANSWERS);
  const r = await runSetup({ opts: {}, io, deps: w.deps });
  assert.equal(step(r, 'autostart').status, 'skipped');
  assert.ok(!asked.some((a) => /log in to your Mac/.test(a.q)));
  assert.equal(w.calls.enableAutostart.length, 0);
});

test('finish names the in-game steps', async () => {
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: world().deps });
  const f = step(r, 'finish').text;
  assert.match(f, /restart WoW/);
  assert.match(f, /AddOns/);
  assert.match(f, /\/fc sync/);
});

test('every step is said as it happens', async () => {
  const { io, said } = fakeIo(ANSWERS);
  const r = await runSetup({ opts: {}, io, deps: world().deps });
  for (const s of r.steps) assert.ok(said.some((t) => t.includes(s.text)), s.id);
});

test('windowsCommandLine: .cmd shims with safe constant arguments only', () => {
  assert.equal(windowsCommandLine('npm', ['install', '-g', '@earendil-works/pi-coding-agent']), 'npm.cmd install -g @earendil-works/pi-coding-agent');
  assert.equal(windowsCommandLine('pi', ['auth', 'login', 'openai', '--api-key']), 'pi.cmd auth login openai --api-key');
  assert.throws(() => windowsCommandLine('npm', ['install', 'a b']));
  assert.throws(() => windowsCommandLine('npm', ['install', 'x&calc']));
  assert.throws(() => windowsCommandLine('npm', ['"x"']));
});

test('runCommand captures output and the exit code; a missing program is a non-zero code', async () => {
  const ok = await runCommand(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)']);
  assert.equal(ok.code, 3);
  assert.equal(ok.stdout, 'hi');
  const missing = await runCommand('wowf-no-such-program-xyz', ['--version']);
  assert.notEqual(missing.code, 0);
  const slow = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 100 });
  assert.notEqual(slow.code, 0);
});

test('runCommand on Windows starts Pi the way resolveTool finds it (an .exe works, not only pi.cmd)', async () => {
  const asked = [];
  const resolve = (name) => { asked.push(name); return { command: process.execPath, args: ['-e', 'console.log(process.argv.slice(1).join("|"))', '--'] }; };
  const r = await runCommand('pi', ['--version'], { platform: 'win32', resolve });
  assert.deepEqual(asked, ['pi']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '--version');
});

test('wowf setup --yes --no-overlay from the command line, run twice', () => {
  const BIN = fileURLToPath(new URL('../bin/wowf', import.meta.url));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wowf setup ')));
  try {
    const game = path.join(root, 'World of Warcraft', '_forever_');
    fs.mkdirSync(path.join(game, 'WTF', 'Account', 'ACC', 'Realm', 'Testa-Realm', 'SavedVariables'), { recursive: true });
    const data = path.join(root, 'my data');
    const env = { ...process.env, WOWF_CONFIG: path.join(root, 'config.json') };
    const setup = (...extra) => spawnSync(process.execPath, [BIN, 'setup', '--yes', '--no-overlay', '--game-dir', game, '--data-dir', data, ...extra],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    const first = setup();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(env.WOWF_CONFIG, 'utf8')), { gameDir: game, dataDir: data, main: 'Testa-Realm' });
    assert.ok(fs.existsSync(path.join(game, 'Interface', 'AddOns', 'ForeverLog', 'ForeverLog.toc')));
    assert.ok(fs.existsSync(path.join(data, 'characters')));
    assert.match(first.stdout, /\/fc sync/);
    const second = setup();
    assert.equal(second.status, 0, second.stdout + second.stderr);
    for (const what of ['Game folder', 'Main character', 'Data folder', 'Addon']) {
      assert.match(second.stdout, new RegExp(`^already +${what}`, 'm'), what);
    }
    const asks = spawnSync(process.execPath, [BIN, 'setup', '--no-overlay'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(asks.status, 1);
    assert.match(asks.stderr, /--yes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- Electron's app: path.txt and the program it names ----

test('overlay: a path.txt whose program is missing counts as not installed, and the install runs', async () => {
  const w = world({ files: [PATH_TXT], noProgram: true });
  const r = await runSetup({ opts: {}, io: fakeIo(ANSWERS).io, deps: w.deps });
  assert.ok(w.calls.run.some(([cmd, args]) => cmd === 'npm' && args[0] === 'ci'));
  const o = step(r, 'overlay');
  assert.equal(o.status, 'failed');
  assert.equal(o.text, electronMissingText('v22.3.0', 'darwin'));
  assert.match(o.text, /^The chat overlay's Electron app did not install on Node v22\.3\.0\. [^\n]*node bin\/wowf setup[^\n]*\.$/);
});

test('overlayElectronReady needs path.txt and the program it names', () => {
  const dir = path.resolve('/x/overlay');
  const txt = path.join(dir, 'node_modules', 'electron', 'path.txt');
  const bin = path.join(dir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const readFile = () => 'electron.exe\n';
  assert.equal(overlayElectronReady({ overlayDir: dir, exists: (p) => p === txt || p === bin, readFile }), true);
  assert.equal(overlayElectronReady({ overlayDir: dir, exists: (p) => p === txt, readFile }), false);
  assert.equal(overlayElectronReady({ overlayDir: dir, exists: (p) => p === bin, readFile }), false);
  assert.equal(overlayElectronReady({ overlayDir: dir, exists: () => true, readFile: () => '' }), false);
  assert.equal(overlayElectronReady({ overlayDir: dir, exists: () => true, readFile: () => { throw new Error('EACCES'); } }), false);
});

test('installOverlayPackages: npm ci, then approve and rebuild only while the program is missing', async () => {
  const dir = path.resolve('/x/overlay');
  const bin = path.join(dir, 'node_modules', 'electron', 'dist', 'electron');
  const txt = path.join(dir, 'node_modules', 'electron', 'path.txt');
  const make = (afterCi, afterRebuild, ciCode = 0) => {
    const files = new Set();
    const calls = [];
    const run = async (cmd, args, o) => {
      calls.push([cmd, args.join(' '), o.cwd]);
      if (args[0] === 'ci' && ciCode === 0 && afterCi) { files.add(txt); files.add(bin); }
      if (args[0] === 'rebuild' && afterRebuild) { files.add(txt); files.add(bin); }
      return { code: args[0] === 'ci' ? ciCode : 0, stdout: ciCode ? 'line\nnpm ERR! last\n' : '' };
    };
    return { calls, deps: { run, exists: (p) => files.has(p), readFile: () => 'electron', overlayDir: dir } };
  };
  let m = make(true, false);
  assert.deepEqual(await installOverlayPackages(m.deps), { ok: true });
  assert.deepEqual(m.calls, [['npm', 'ci', dir]]);
  m = make(false, true);
  assert.deepEqual(await installOverlayPackages(m.deps), { ok: true });
  assert.deepEqual(m.calls.map((c) => c[1]), ['ci', 'install-scripts approve electron', 'rebuild electron']);
  m = make(false, false);
  assert.deepEqual(await installOverlayPackages(m.deps), { ok: false, failed: 'electron', output: '' });
  m = make(false, false, 1);
  assert.deepEqual(await installOverlayPackages(m.deps), { ok: false, failed: 'install', output: 'line\nnpm ERR! last' });
  assert.deepEqual(m.calls.map((c) => c[1]), ['ci']);
  // A run that throws counts as a failed command, never as a crash.
  const throwing = { ...make(false, false).deps, run: async () => { throw new Error('spawn npm ENOENT'); } };
  assert.deepEqual(await installOverlayPackages(throwing), { ok: false, failed: 'install', output: 'spawn npm ENOENT' });
});

test('the overlay pins yauzl 3 for Electron\'s unzip (yauzl 2 stalls on Node 26)', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../overlay/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('../overlay/package-lock.json', import.meta.url), 'utf8'));
  assert.match(pkg.overrides?.yauzl ?? '', /^3\./);
  assert.match(lock.packages['node_modules/yauzl'].version, /^3\./);
  assert.equal(lock.packages['node_modules/fd-slicer'], undefined);
  const electron = lock.packages['node_modules/electron'].version;
  assert.equal(pkg.allowScripts?.[`electron@${electron}`], true, 'allowScripts names the locked Electron');
});
