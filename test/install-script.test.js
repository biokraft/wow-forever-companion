// The one-line installers, run for real against fake `node`, `git` and `curl` programs that
// record how they were called. install.sh runs everywhere but Windows, install.ps1 only there.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WIN = process.platform === 'win32';
const CLONE_URL = 'https://github.com/biokraft/wow-forever-companion.git';
const RAW = 'https://raw.githubusercontent.com/biokraft/wow-forever-companion/main';

let root, shims, log, dir;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fc install ')));
  shims = path.join(root, 'shims');
  fs.mkdirSync(shims);
  log = path.join(root, 'calls.log');
  dir = path.join(root, 'home dir', 'wow-forever-companion'); // a space, as in many Windows user folders
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);
const installed = () => { fs.mkdirSync(path.join(dir, 'bin'), { recursive: true }); fs.writeFileSync(path.join(dir, 'bin', 'wowf'), ''); };

// ---------- install.sh ----------

function shim(name, body) {
  fs.writeFileSync(path.join(shims, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}
function unixShims({ node = '22' } = {}) {
  if (node) {
    shim('node', `case "$1" in
  -p) echo "${node}" ;;
  --version) echo "v${node}.0.0" ;;
  *) echo "node $* (in $(pwd -P))" >> "$FC_TEST_LOG" ;;
esac`);
  }
  shim('git', 'echo "git $*" >> "$FC_TEST_LOG"\nif [ "$1" = clone ]; then mkdir -p "$3/bin" && : > "$3/bin/wowf"; fi');
  shim('xcode-select', 'exit 0');
  // curl -fsSL -o <file> <url>
  shim('curl', 'echo "curl $4" >> "$FC_TEST_LOG"\ncp "$FC_TEST_ARCHIVE" "$3"');
}
function sh(args = [], { env = {}, piped = false } = {}) {
  const script = path.join(ROOT, 'install.sh');
  const base = { PATH: `${shims}:/usr/bin:/bin`, HOME: path.join(root, 'home dir'), FC_DIR: dir, FC_TEST_LOG: log, ...env };
  // detached: no controlling terminal, as when a script or an agent runs the installer.
  return piped
    ? spawnSync('sh', ['-s', '--', ...args], { input: fs.readFileSync(script), encoding: 'utf8', env: base, detached: true })
    : spawnSync('sh', [script, ...args], { encoding: 'utf8', env: base, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('install.sh, pasted as curl | sh: clones with git and starts setup in the new folder', { skip: WIN }, () => {
  unixShims();
  const r = sh(['--yes'], { piped: true });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(), [`git clone ${CLONE_URL} ${dir}`, `node bin/wowf setup --yes (in ${dir})`]);
});

test('install.sh without a FC_DIR installs into wow-forever-companion in the home folder', { skip: WIN }, () => {
  unixShims();
  const r = sh(['--yes'], { env: { FC_DIR: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(calls()[0], `git clone ${CLONE_URL} ${dir}`);
});

test('install.sh without git downloads the main branch and unpacks it without the top folder', { skip: WIN }, () => {
  unixShims();
  const src = path.join(root, 'src', 'wow-forever-companion-main');
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(src, 'bin', 'wowf'), 'real\n');
  fs.writeFileSync(path.join(src, 'package.json'), '{}\n');
  const archive = path.join(root, 'main.tar.gz');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', path.dirname(src), path.basename(src)]).status, 0);
  const r = sh(['--yes'], { env: { FC_NO_GIT: '1', FC_TEST_ARCHIVE: archive } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(), [
    'curl https://github.com/biokraft/wow-forever-companion/archive/refs/heads/main.tar.gz',
    `node bin/wowf setup --yes (in ${dir})`,
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 'bin', 'wowf'), 'utf8'), 'real\n');
  assert.ok(fs.existsSync(path.join(dir, 'package.json')));
});

test('install.sh: a failed download says so and leaves no half install to mistake for a real one', { skip: WIN }, () => {
  unixShims();
  const r = sh(['--yes'], { env: { FC_NO_GIT: '1', FC_TEST_ARCHIVE: path.join(root, 'missing.tar.gz') } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /download from GitHub failed/);
  assert.equal(fs.existsSync(path.join(dir, 'bin', 'wowf')), false);
  assert.equal(calls().some((c) => c.startsWith('node ')), false, 'setup never starts');
});

test('install.sh on an existing install updates it, then runs setup again', { skip: WIN }, () => {
  unixShims();
  installed();
  const r = sh(['--yes']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(), [`node bin/wowf update (in ${dir})`, `node bin/wowf setup --yes (in ${dir})`]);
});

test('install.sh refuses a folder that holds something else', { skip: WIN }, () => {
  unixShims();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'holiday.jpg'), '');
  const r = sh(['--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /holds something else/);
  assert.deepEqual(calls(), []);
  assert.deepEqual(fs.readdirSync(dir), ['holiday.jpg']);
});

test('install.sh stops before downloading anything when Node is too old or missing', { skip: WIN }, () => {
  unixShims({ node: '20' });
  const old = sh(['--yes']);
  assert.equal(old.status, 1);
  assert.match(old.stdout, /v20\.0\.0 is too old/);
  assert.match(old.stderr, /https:\/\/nodejs\.org/);
  assert.deepEqual(calls(), []);
  fs.rmSync(path.join(shims, 'node'));
  const none = sh(['--yes'], { env: { PATH: `${shims}:/bin` } });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Node\.js is not installed/);
  assert.deepEqual(calls(), []);
});

test('install.sh with no terminal to ask on installs, then names the setup command instead of hanging', { skip: WIN }, () => {
  unixShims();
  const r = sh([]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(), [`git clone ${CLONE_URL} ${dir}`]);
  assert.match(r.stdout, /node bin\/wowf setup/);
});

// ---------- install.ps1 ----------

function cmdShim(name, lines) {
  fs.writeFileSync(path.join(shims, `${name}.cmd`), ['@echo off', ...lines, ''].join('\r\n'));
}
function windowsShims({ node = '22' } = {}) {
  cmdShim('node', [
    `if "%~1"=="--version" echo v${node}.0.0& exit /b 0`,
    'echo node %* (in %CD%)>>"%FC_TEST_LOG%"',
    'exit /b 0',
  ]);
  cmdShim('git', [
    'echo git %*>>"%FC_TEST_LOG%"',
    'if "%~1"=="clone" mkdir "%~3\\bin" & type nul > "%~3\\bin\\wowf"',
    'exit /b 0',
  ]);
}
function ps(env = {}) {
  // Windows spells the variable Path, PATH or path; drop every spelling before setting ours.
  const withoutPath = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install.ps1')], {
    encoding: 'utf8',
    env: { ...withoutPath, Path: `${shims};${system}`, FC_DIR: dir, FC_TEST_LOG: log, FC_SETUP_ARGS: '--yes', ...env },
  });
}

test('install.ps1: clones with git and starts setup in the new folder', { skip: !WIN }, () => {
  windowsShims();
  const r = ps();
  assert.deepEqual(calls(), [`git clone ${CLONE_URL} ${dir}`, `node bin\\wowf setup --yes (in ${dir})`], r.stdout + r.stderr);
});

test('install.ps1 on an existing install updates it, then runs setup again', { skip: !WIN }, () => {
  windowsShims();
  installed();
  const r = ps();
  assert.deepEqual(calls(), [`node bin\\wowf update (in ${dir})`, `node bin\\wowf setup --yes (in ${dir})`], r.stdout + r.stderr);
});

test('install.ps1 refuses a folder that holds something else', { skip: !WIN }, () => {
  windowsShims();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'holiday.jpg'), '');
  const r = ps();
  assert.match(r.stdout + r.stderr, /holds something else/);
  assert.deepEqual(calls(), []);
  assert.deepEqual(fs.readdirSync(dir), ['holiday.jpg']);
});

test('install.ps1 stops before downloading anything when Node is too old', { skip: !WIN }, () => {
  windowsShims({ node: '20' });
  const r = ps();
  assert.match(r.stdout + r.stderr, /v20\.0\.0 is too old/);
  assert.match(r.stdout + r.stderr, /https:\/\/nodejs\.org/);
  assert.deepEqual(calls(), []);
});

// ---------- both ----------

test('each installer names its own one-line command', () => {
  assert.ok(fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8').includes(`curl -fsSL ${RAW}/install.sh | sh`));
  assert.ok(fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8').includes(`irm ${RAW}/install.ps1 | iex`));
});
