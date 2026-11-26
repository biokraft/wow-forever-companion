import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runUpdate } from '../src/update.js';

// A repo path with spaces, in the form of the OS running the tests.
const REPO = path.resolve('/Users/some player/forever companion');
const GAME = path.resolve('/Games/World of Warcraft/_forever_');
const OVERLAY = path.join(REPO, 'overlay');
const ELECTRON = path.join(OVERLAY, 'node_modules', 'electron');
const PROGRAM = 'Electron.app/Contents/MacOS/Electron';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
// Overlay lockfiles before and after the pull: by default a real dependency change.
const lock = (version, electron) => JSON.stringify({
  name: 'forever-companion-overlay', version, lockfileVersion: 3, requires: true,
  packages: { '': { name: 'forever-companion-overlay', version, devDependencies: { electron: '^39.0.0' } },
    'node_modules/electron': { version: electron } },
}, null, 2) + '\n';
const LOCKFILE = path.join(OVERLAY, 'package-lock.json');
const CHANGELOG = '# Changelog\n\n## 0.4.1 (2026-12-01)\n\n- Faster sync.\n\n## 0.4.0 (2026-11-25)\n\n- First public release.\n';

// A fake clone: git and npm answer from `state`; every call is recorded.
function world(over = {}) {
  const state = {
    git: true, status: '', branch: 'main', pullCode: 0, pullOut: 'Updating aaaa..bbbb\nFast-forward\n',
    head: OLD, pulledTo: NEW, changed: ['src/cli.js'], overlayInstalled: true, npmCode: 0,
    ciElectron: true, rebuildElectron: false, revWarning: '', platform: 'darwin',
    lockBefore: lock('0.4.0', '39.8.10'), lockAfter: lock('0.4.1', '39.9.0'),
    version: '0.4.0', newVersion: '0.4.1', changelog: CHANGELOG,
    ...over,
  };
  state.electron = state.overlayInstalled;
  const calls = { run: [], installAddon: [] };
  const said = [];
  const files = () => new Set([
    ...(state.git ? [path.join(REPO, '.git')] : []),
    ...(state.overlayInstalled ? [path.join(OVERLAY, 'node_modules')] : []),
    ...(state.electron ? [path.join(ELECTRON, 'path.txt'), path.join(ELECTRON, 'dist', PROGRAM)] : []),
  ]);
  const deps = {
    repoDir: REPO,
    nodeVersion: 'v26.13.0',
    get platform() { return state.platform; },
    cfg: { gameDir: GAME, dataDir: '/data', main: 'Thrall-Realm' },
    exists: (p) => files().has(p),
    say: (s) => said.push(s),
    installAddon: (g) => { calls.installAddon.push(g); return path.join(g, 'Interface', 'AddOns', 'ForeverLog'); },
    readFile: (p) => {
      if (p === path.join(REPO, 'package.json')) return JSON.stringify({ version: state.version });
      if (p === path.join(REPO, 'CHANGELOG.md')) return state.changelog;
      if (p === path.join(ELECTRON, 'path.txt') && state.electron) return PROGRAM;
      if (p === LOCKFILE && state.lockAfter !== null) return state.lockAfter;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    run: async (cmd, args, o) => {
      calls.run.push([cmd, args, o]);
      const a = args.join(' ');
      if (cmd === 'git' && a === 'status --porcelain') return { code: 0, stdout: state.status };
      if (cmd === 'git' && a === 'symbolic-ref --quiet --short HEAD') return state.branch ? { code: 0, stdout: `${state.branch}\n` } : { code: 1, stdout: '' };
      if (cmd === 'git' && a === 'rev-parse HEAD') return { code: 0, stdout: `${state.revWarning}${state.head}\n` };
      if (cmd === 'git' && a === 'pull --ff-only') {
        if (state.pullCode === 0) { state.head = state.pulledTo; state.version = state.newVersion; }
        return { code: state.pullCode, stdout: state.pullOut };
      }
      if (cmd === 'git' && a === `show ${OLD}:overlay/package-lock.json`) {
        return state.lockBefore === null ? { code: 128, stdout: 'fatal: bad object' } : { code: 0, stdout: state.lockBefore };
      }
      if (cmd === 'git' && a === `diff --name-only ${OLD} ${NEW}`) return { code: 0, stdout: state.changed.map((f) => `${f}\n`).join('') };
      if (cmd === 'npm' && a === 'ci') {
        if (state.npmCode === 0) state.electron = state.ciElectron;
        return { code: state.npmCode, stdout: state.npmCode ? 'npm ERR! network\n' : '' };
      }
      if (cmd === 'npm' && a === 'install-scripts approve electron') return { code: 0, stdout: '' };
      if (cmd === 'npm' && a === 'rebuild electron') { state.electron = state.rebuildElectron; return { code: 0, stdout: '' }; }
      return { code: 1, stdout: `unexpected: ${cmd} ${a}` };
    },
  };
  return { state, calls, said, deps, text: () => said.join('\n') };
}

const gitCalls = (calls) => calls.run.filter(([c]) => c === 'git').map(([, a]) => a.join(' '));

// A folder without git history: the newest code arrives as a download. The fake stands in
// for the download and the copy; `fetched` and `replaced` record what happened.
function archiveWorld(over = {}, { fetchError = null, replaceError = null } = {}) {
  const w = world({ git: false, ...over });
  w.archive = { fetched: 0, replaced: [], cleaned: 0 };
  const before = w.state.lockAfter;
  w.state.lockAfter = w.state.lockBefore; // on disk before the copy
  w.deps.archive = {
    fetchNewest: async () => {
      w.archive.fetched += 1;
      if (fetchError) throw new Error(fetchError);
      return { tree: '/tmp/newest', cleanup: () => { w.archive.cleaned += 1; } };
    },
    replaceTree: (tree, repoDir) => {
      if (replaceError) throw new Error(replaceError);
      w.archive.replaced.push([tree, repoDir]);
      w.state.version = w.state.newVersion;
      w.state.lockAfter = before;
    },
  };
  return w;
}

test('not a git clone: downloads the newest code, copies it over and refreshes packages and addon', async () => {
  const w = archiveWorld();
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.deepEqual(gitCalls(w.calls), [], 'git is never run in a folder without history');
  assert.deepEqual(w.archive.replaced, [['/tmp/newest', REPO]]);
  assert.equal(w.archive.cleaned, 1, 'the temporary download is removed');
  assert.ok(w.calls.run.some(([c, a]) => c === 'npm' && a.join(' ') === 'ci'), 'the lockfile changed');
  assert.deepEqual(w.calls.installAddon, [GAME]);
  assert.match(w.text(), /Updated Forever Companion from 0\.4\.0 to 0\.4\.1\./);
  assert.match(w.text(), /Faster sync/);
});

test('not a git clone: the same dependencies need no npm call', async () => {
  const w = archiveWorld({ lockAfter: lock('0.4.1', '39.8.10') });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.equal(w.calls.run.some(([c]) => c === 'npm'), false);
});

test('not a git clone: a failed download changes nothing and says so', async () => {
  const w = archiveWorld({}, { fetchError: 'GitHub answered 503' });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'download-failed' });
  assert.deepEqual(w.archive.replaced, []);
  assert.deepEqual(w.calls.installAddon, []);
  assert.match(w.text(), /nothing was changed \(GitHub answered 503\)/);
});

test('not a git clone: a copy that stops part-way says how to repair the folder', async () => {
  const w = archiveWorld({}, { replaceError: 'EBUSY: resource busy' });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'copy-failed' });
  assert.equal(w.archive.cleaned, 1);
  assert.deepEqual(w.calls.installAddon, []);
  assert.match(w.text(), /EBUSY/);
  assert.match(w.text(), /node bin\/wowf update again/);
  assert.match(w.text(), /https:\/\/github\.com\/biokraft\/wow-forever-companion/);
});

test('local changes to tracked files: lists them and does not pull', async () => {
  const w = world({ status: ' M src/cli.js\nM  addon/ForeverLog/Core.lua\n?? notes.txt\n' });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'dirty' });
  assert.ok(!gitCalls(w.calls).includes('pull --ff-only'));
  assert.match(w.text(), /src\/cli\.js/);
  assert.match(w.text(), /addon\/ForeverLog\/Core\.lua/);
  assert.doesNotMatch(w.text(), /notes\.txt/);
  assert.deepEqual(w.calls.installAddon, []);
});

test('untracked files alone do not stop the update', async () => {
  const w = world({ status: '?? notes.txt\n' });
  assert.equal((await runUpdate(w.deps)).code, 'updated');
});

test('detached HEAD: stops without pulling', async () => {
  const w = world({ branch: null });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'detached' });
  assert.ok(!gitCalls(w.calls).includes('pull --ff-only'));
  assert.match(w.text(), /git switch main/);
  assert.deepEqual(w.calls.installAddon, []);
});

test('a failing pull reports git\'s own message', async () => {
  const w = world({ pullCode: 1, pullOut: 'fatal: Not possible to fast-forward, aborting.\n' });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'pull-failed' });
  assert.match(w.text(), /fatal: Not possible to fast-forward, aborting\./);
  assert.deepEqual(w.calls.installAddon, []);
});

test('already up to date: current, no diff and no npm, the addon is still refreshed', async () => {
  const w = world({ pulledTo: OLD, newVersion: '0.4.0' });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'current' });
  assert.ok(!gitCalls(w.calls).some((a) => a.startsWith('diff')));
  assert.equal(w.calls.run.some(([c]) => c === 'npm'), false);
  assert.match(w.text(), /up to date/i);
  assert.match(w.text(), /0\.4\.0/);
  assert.deepEqual(w.calls.installAddon, [GAME]);
});

test('updated with a changed overlay lockfile: npm ci in the overlay, which never rewrites the lockfile', async () => {
  const w = world({ changed: ['src/cli.js', 'overlay/package-lock.json'] });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  const npm = w.calls.run.filter(([c]) => c === 'npm');
  assert.deepEqual(npm, [['npm', ['ci'], { cwd: OVERLAY }]]);
  assert.deepEqual(gitCalls(w.calls), ['status --porcelain', 'symbolic-ref --quiet --short HEAD', 'rev-parse HEAD', 'pull --ff-only', 'rev-parse HEAD', `diff --name-only ${OLD} ${NEW}`, `show ${OLD}:overlay/package-lock.json`]);
});

test('a lockfile whose only change is the release version bump reinstalls nothing', async () => {
  const w = world({ changed: ['package.json', 'overlay/package-lock.json'], lockAfter: lock('0.4.1', '39.8.10') });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.equal(w.calls.run.some(([c]) => c === 'npm'), false);
});

test('a lockfile that cannot be compared is reinstalled to be safe', async () => {
  for (const over of [{ lockBefore: null }, { lockAfter: null }, { lockAfter: '{ not json' }]) {
    const w = world({ changed: ['overlay/package-lock.json'], lockAfter: lock('0.4.1', '39.8.10'), ...over });
    assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' }, JSON.stringify(over));
    assert.deepEqual(w.calls.run.filter(([c]) => c === 'npm').map(([, a]) => a), [['ci']], JSON.stringify(over));
  }
});

test('on Windows a failed package install says to close the chat overlay first', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], npmCode: 1, platform: 'win32' });
  await runUpdate(w.deps);
  assert.match(w.text(), /close the chat overlay/i);
  const mac = world({ changed: ['overlay/package-lock.json'], npmCode: 1 });
  await runUpdate(mac.deps);
  assert.doesNotMatch(mac.text(), /close the chat overlay/i);
  const electron = world({ changed: ['overlay/package-lock.json'], ciElectron: false, rebuildElectron: false, platform: 'win32' });
  await runUpdate(electron.deps);
  assert.match(electron.text(), /close the chat overlay/i);
});

test('Electron missing after npm ci: approve and rebuild, then it counts', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], ciElectron: false, rebuildElectron: true });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.deepEqual(w.calls.run.filter(([c]) => c === 'npm').map(([, a]) => a.join(' ')), ['ci', 'install-scripts approve electron', 'rebuild electron']);
});

test('Electron still missing after the rebuild: the update fails with a plain sentence naming Node', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], ciElectron: false, rebuildElectron: false });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'updated' });
  assert.match(w.text(), /Electron app did not install on Node v26\.13\.0\./);
  assert.match(w.text(), /node bin\/wowf setup/);
});

test('a failing npm ci gives npm\'s output and the packages sentence', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], npmCode: 1 });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'updated' });
  assert.match(w.text(), /npm ERR! network/);
  assert.match(w.text(), /overlay's packages failed, so the overlay may not start/);
});

test('git warnings mixed into the output are not read as changed files or commit ids', async () => {
  const w = world({
    status: 'warning: in the working copy of \'src/cli.js\', LF will be replaced by CRLF the next time Git touches it\n',
    revWarning: "warning: refname 'HEAD' is ambiguous.\n",
    changed: ['overlay/package-lock.json'],
  });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.ok(gitCalls(w.calls).includes(`diff --name-only ${OLD} ${NEW}`));
  assert.deepEqual(w.calls.run.filter(([c]) => c === 'npm').map(([, a]) => a), [['ci']]);
});

test('no commit id from rev-parse: stops before pulling', async () => {
  const w = world({ head: 'fatal: not a valid object name' });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'pull-failed' });
  assert.ok(!gitCalls(w.calls).includes('pull --ff-only'));
  assert.deepEqual(w.calls.installAddon, []);
});

test('updated without a lockfile change: no npm call', async () => {
  const w = world({ changed: ['src/cli.js', 'overlay/renderer.js'] });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.equal(w.calls.run.some(([c]) => c === 'npm'), false);
});

test('a changed lockfile without an installed overlay installs nothing', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], overlayInstalled: false });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.equal(w.calls.run.some(([c]) => c === 'npm'), false);
});

test('a failing npm install is reported and fails the update', async () => {
  const w = world({ changed: ['overlay/package-lock.json'], npmCode: 1 });
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'updated' });
  assert.match(w.text(), /npm ERR! network/);
  assert.match(w.text(), /node bin\/wowf setup/);
});

test('updated: refreshes the addon, says to /reload and restart the overlay, shows the changelog', async () => {
  const w = world();
  await runUpdate(w.deps);
  assert.deepEqual(w.calls.installAddon, [GAME]);
  assert.match(w.text(), /0\.4\.0 to 0\.4\.1/);
  assert.match(w.text(), /\/reload/);
  assert.match(w.text(), /restart/i);
  assert.match(w.text(), /run node bin\/wowf overlay again to restart it/);
  assert.match(w.text(), /Faster sync\./);
  assert.doesNotMatch(w.text(), /First public release/);
});

test('no game folder in the config: the update still succeeds and points to setup', async () => {
  const w = world();
  w.deps.cfg = null;
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.deepEqual(w.calls.installAddon, []);
  assert.match(w.text(), /node bin\/wowf setup/);
});

test('an addon copy that fails is reported and fails the update', async () => {
  const w = world();
  w.deps.installAddon = () => { throw new Error('EACCES: permission denied'); };
  assert.deepEqual(await runUpdate(w.deps), { ok: false, code: 'updated' });
  assert.match(w.text(), /EACCES/);
});

test('a missing changelog section is skipped quietly', async () => {
  const w = world({ changelog: '# Changelog\n' });
  assert.deepEqual(await runUpdate(w.deps), { ok: true, code: 'updated' });
  assert.match(w.text(), /\/reload/);
});

test('the repo path goes in cwd, never inside a command or its arguments', async () => {
  const w = world({ changed: ['overlay/package-lock.json'] });
  await runUpdate(w.deps);
  assert.ok(w.calls.run.length >= 6);
  for (const [cmd, args, o] of w.calls.run) {
    assert.ok(cmd === 'git' || cmd === 'npm', cmd);
    for (const a of args) assert.ok(!a.includes('some player') && !a.includes(path.sep + 'Users'), a);
    assert.ok(o.cwd === REPO || o.cwd === OVERLAY, o.cwd);
  }
});
