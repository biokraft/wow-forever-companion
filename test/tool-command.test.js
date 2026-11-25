import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveTool, shimTarget } from '../src/tool-command.js';

// Real shims, written by npm's own cmd-shim for a global install of each package (npm
// writes them with CRLF; the repo stores them with LF, so both are tested).
const fixture = (f) => fs.readFileSync(new URL(`./fixtures/win-shims/${f}`, import.meta.url), 'utf8');
const PI_CMD = fixture('pi.cmd');
const CLAUDE_CMD = fixture('claude.cmd');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
// The shim npm 6 and older wrote.
const OLD_SHIM = '@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js" %*\r\n)';
// A shim for a program that is not a Node script.
const SH_SHIM = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\tool.sh"   %*\r\n';

const NPM_DIR = 'C:\\Users\\Ann Lee\\AppData\\Roaming\\npm';
const PI_JS = `${NPM_DIR}\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js`;

// A fake Windows disk: `files` maps a path (compared without case, like NTFS) to its text.
function win(files, env = { Path: `C:\\Windows\\system32;${NPM_DIR};C:\\Program Files\\nodejs` }) {
  const disk = new Map(Object.entries(files).map(([p, t]) => [p.toLowerCase(), t]));
  return {
    platform: 'win32',
    env,
    exists: (p) => disk.has(p.toLowerCase()),
    readFile: (p) => {
      if (!disk.has(p.toLowerCase())) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return disk.get(p.toLowerCase());
    },
  };
}

test('macOS and Linux: the plain name, nothing looked up', () => {
  const never = () => { throw new Error('no lookup off Windows'); };
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(resolveTool('pi', { platform, env: {}, exists: never, readFile: never }), { command: 'pi', args: [] });
  }
});

test('Windows: an npm .cmd shim runs its script with node, so arguments stay an array (no shell)', () => {
  const o = win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD, [PI_JS]: '' });
  assert.deepEqual(resolveTool('pi', o), { command: 'node', args: [PI_JS] });
});

test('Windows: CRLF shims, the older npm shim and the Claude Code shim', () => {
  assert.deepEqual(resolveTool('pi', win({ [`${NPM_DIR}\\pi.cmd`]: crlf(PI_CMD) })), { command: 'node', args: [PI_JS] });
  assert.deepEqual(resolveTool('pi', win({ [`${NPM_DIR}\\pi.cmd`]: OLD_SHIM })), { command: 'node', args: [PI_JS] });
  assert.deepEqual(resolveTool('claude', win({ [`${NPM_DIR}\\claude.cmd`]: crlf(CLAUDE_CMD) })),
    { command: 'node', args: [`${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`] });
});

test('Windows: the node.exe next to the shim is used when it is there, as the shim does', () => {
  const o = win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD, [`${NPM_DIR}\\node.exe`]: '' });
  assert.deepEqual(resolveTool('pi', o), { command: `${NPM_DIR}\\node.exe`, args: [PI_JS] });
});

test('Windows: an .exe is run directly; PATH order wins, then PATHEXT order', () => {
  const exe = 'C:\\Users\\Ann Lee\\.local\\bin\\claude.exe';
  const env = { PATH: `C:\\Users\\Ann Lee\\.local\\bin;${NPM_DIR}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const o = win({ [exe]: '', [`${NPM_DIR}\\claude.cmd`]: CLAUDE_CMD }, env);
  assert.deepEqual(resolveTool('claude', o), { command: exe, args: [] });
  // Both in one folder: PATHEXT decides.
  const both = win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD, [`${NPM_DIR}\\pi.exe`]: '' }, { Path: NPM_DIR, PATHEXT: '.CMD;.EXE' });
  assert.deepEqual(resolveTool('pi', both), { command: 'node', args: [PI_JS] });
  const exeFirst = win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD, [`${NPM_DIR}\\pi.exe`]: '' }, { Path: NPM_DIR, PATHEXT: '.EXE;.CMD' });
  assert.deepEqual(resolveTool('pi', exeFirst), { command: `${NPM_DIR}\\pi.exe`, args: [] });
});

test('Windows: quoted PATH entries with spaces, empty entries and a trailing backslash', () => {
  const env = { Path: `;"${NPM_DIR}\\";;` };
  assert.deepEqual(resolveTool('pi', win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD }, env)), { command: 'node', args: [PI_JS] });
});

test('Windows: nothing found, an unreadable shim or a shim that is not a Node script give the plain name', () => {
  assert.deepEqual(resolveTool('pi', win({})), { command: 'pi', args: [] });
  assert.deepEqual(resolveTool('pi', win({ [`${NPM_DIR}\\pi.cmd`]: SH_SHIM })), { command: 'pi', args: [] });
  const o = win({ [`${NPM_DIR}\\pi.cmd`]: PI_CMD });
  o.readFile = () => { throw new Error('EACCES'); };
  assert.deepEqual(resolveTool('pi', o), { command: 'pi', args: [] });
  assert.deepEqual(resolveTool('pi', win({}, {})), { command: 'pi', args: [] }, 'no PATH at all');
});

test('a path is never looked up on PATH; a .cmd path is still opened as a shim on Windows', () => {
  assert.deepEqual(resolveTool('/usr/local/bin/node', { platform: 'darwin', env: {} }), { command: '/usr/local/bin/node', args: [] });
  const exe = 'C:\\Program Files\\nodejs\\node.exe';
  assert.deepEqual(resolveTool(exe, win({ [exe]: '' })), { command: exe, args: [] });
  const shim = `${NPM_DIR}\\pi.cmd`;
  assert.deepEqual(resolveTool(shim, win({ [shim]: PI_CMD })), { command: 'node', args: [PI_JS] });
});

test('shimTarget finds the Node script as npm\'s own read-cmd-shim does, and null for anything else', () => {
  assert.equal(shimTarget(PI_CMD), 'node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js');
  assert.equal(shimTarget(OLD_SHIM), 'node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js');
  assert.equal(shimTarget(SH_SHIM), null);
  assert.equal(shimTarget('@echo hello'), null);
});

test('the real defaults work on this machine: process.execPath resolves to itself', () => {
  assert.deepEqual(resolveTool(process.execPath), { command: process.execPath, args: [] });
  assert.ok(path.isAbsolute(process.execPath));
});
