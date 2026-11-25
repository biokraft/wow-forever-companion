import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareVersions, checkForUpdate, RELEASES_URL } from '../src/update-check.js';

const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 25, 12);

let root, cacheFile;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-update-check-'));
  cacheFile = path.join(root, 'config dir', 'update-check.json');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// A fetch that records every call and answers with `reply()`.
function fakeFetch(reply = () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.4.1' }) })) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return reply(); };
  return { calls, fetchImpl };
}
const check = (fetchImpl, o = {}) => checkForUpdate({ current: '0.4.0', now: T0, cacheFile, fetchImpl, ...o });

test('compareVersions orders versions, with or without a leading v', () => {
  assert.equal(compareVersions('0.4.0', 'v0.4.1'), -1);
  assert.equal(compareVersions('v0.4.1', '0.4.1'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.5.0-beta.1', '0.5.0'), -1);
  assert.equal(compareVersions('0.5.0', '0.5.0-beta.1'), 1);
  assert.equal(compareVersions('0.5.0-beta.2', '0.5.0-beta.10'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('a fresh check finds the newer release and caches it', async () => {
  const { calls, fetchImpl } = fakeFetch();
  assert.deepEqual(await check(fetchImpl), { latest: '0.4.1', newer: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), { checkedAt: T0, latest: '0.4.1' });
});

test('the same or an older release is not newer', async () => {
  const same = fakeFetch(() => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.4.0' }) }));
  assert.deepEqual(await check(same.fetchImpl), { latest: '0.4.0', newer: false });
  fs.rmSync(cacheFile);
  const older = fakeFetch(() => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v0.3.0' }) }));
  assert.deepEqual(await check(older.fetchImpl), { latest: '0.3.0', newer: false });
});

test('one request per 24 hours: 1 h later answers from the cache, 25 h later asks again', async () => {
  const { calls, fetchImpl } = fakeFetch();
  await check(fetchImpl);
  assert.deepEqual(await check(fetchImpl, { now: T0 + HOUR }), { latest: '0.4.1', newer: true });
  assert.equal(calls.length, 1);
  await check(fetchImpl, { now: T0 + 25 * HOUR });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).checkedAt, T0 + 25 * HOUR);
});

test('a cached answer is compared with the version installed now', async () => {
  const { fetchImpl } = fakeFetch();
  await check(fetchImpl);
  assert.deepEqual(await check(fetchImpl, { now: T0 + HOUR, current: '0.4.1' }), { latest: '0.4.1', newer: false });
});

const FAILURES = {
  'fetch throws': () => { throw new Error('offline'); },
  'HTTP 403': () => ({ ok: false, status: 403, json: async () => ({ message: 'rate limited' }) }),
  'non-JSON body': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
  'JSON without tag_name': () => ({ ok: true, status: 200, json: async () => ({ name: 'x' }) }),
  'tag that is no version': () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'latest' }) }),
};
for (const [name, reply] of Object.entries(FAILURES)) {
  test(`${name}: no update, nothing thrown, and the failure is cached for 24 h`, async () => {
    const { calls, fetchImpl } = fakeFetch(reply);
    assert.deepEqual(await check(fetchImpl), { latest: null, newer: false });
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf8')), { checkedAt: T0, latest: null });
    assert.deepEqual(await check(fetchImpl, { now: T0 + 23 * HOUR }), { latest: null, newer: false });
    assert.equal(calls.length, 1, 'no retry within the day');
  });
}

test('a request that hangs is cut off after timeoutMs', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  assert.deepEqual(await check(fetchImpl, { timeoutMs: 20 }), { latest: null, newer: false });
});

test('a broken or unwritable cache never throws', async () => {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, '{not json');
  const { calls, fetchImpl } = fakeFetch();
  assert.deepEqual(await check(fetchImpl), { latest: '0.4.1', newer: true });
  assert.equal(calls.length, 1);
  // The cache path is a folder, so it can be neither read nor written.
  const dirAsFile = path.join(root, 'is-a-dir');
  fs.mkdirSync(dirAsFile);
  assert.deepEqual(await check(fetchImpl, { cacheFile: dirAsFile }), { latest: '0.4.1', newer: true });
});

test('enabled: false never fetches and reads no cache', async () => {
  const { calls, fetchImpl } = fakeFetch();
  assert.deepEqual(await check(fetchImpl, { enabled: false }), { latest: null, newer: false });
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(cacheFile), false);
});

test('the request is the fixed public URL with only accept and a generic user agent', async () => {
  const { calls, fetchImpl } = fakeFetch();
  await check(fetchImpl, { current: '0.4.0' });
  assert.equal(RELEASES_URL, 'https://api.github.com/repos/biokraft/wow-forever-companion/releases/latest');
  assert.equal(calls[0].url, RELEASES_URL);
  const { headers, ...rest } = calls[0].init;
  assert.deepEqual(Object.keys(rest), ['signal']);
  assert.deepEqual(Object.keys(headers).sort(), ['accept', 'user-agent']);
  assert.equal(headers['user-agent'], 'ForeverCompanion');
  assert.equal(headers.accept, 'application/vnd.github+json');
  // Nothing from the player's install: not the version, not the cache (config) folder.
  const sent = JSON.stringify(calls[0]);
  assert.ok(!sent.includes('0.4.0'));
  assert.ok(!sent.includes(root));
});

// ---- wowf sync never touches the network ----

const BIN = fileURLToPath(new URL('../bin/wowf', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const FIXTURE = fs.readFileSync(new URL('./fixtures/sv/ForeverLog.lua', import.meta.url), 'utf8');
const NET_EXIT = 99;
// Loaded before the program: any fetch or socket connect ends the process with NET_EXIT, so a
// caller that swallows errors (sync --hook does) still cannot hide it.
const GUARD = `
import net from 'node:net';
const caught = (what) => { process.stderr.write('NETWORK USED: ' + what + '\\n'); process.exit(${NET_EXIT}); };
globalThis.fetch = (url) => caught('fetch ' + url);
net.Socket.prototype.connect = function () { caught('socket connect'); };
`;

function guarded(args, { cwd, env }) {
  const guard = path.join(root, 'no-network.mjs');
  fs.writeFileSync(guard, GUARD);
  return spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('the network guard really stops a program that fetches', () => {
  const r = guarded(['-e', "fetch('https://example.invalid/').catch(() => {})"], { cwd: root, env: {} });
  assert.equal(r.status, NET_EXIT, r.stderr);
  assert.match(r.stderr, /NETWORK USED: fetch/);
});

test('wowf sync (plain, --json and --hook) makes no network request', () => {
  const game = path.join(root, '_forever_');
  const sv = path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Testa-Grimtusk', 'SavedVariables');
  fs.mkdirSync(sv, { recursive: true });
  fs.writeFileSync(path.join(sv, 'ForeverLog.lua'), FIXTURE);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  const cfgFile = path.join(root, 'config.json');
  // updateCheck is left on: sync must not check whatever the config says.
  fs.writeFileSync(cfgFile, JSON.stringify({ gameDir: game, dataDir, main: 'Testa-Grimtusk' }));
  const env = { WOWF_CONFIG: cfgFile };
  for (const args of [['sync', '--json'], ['sync'], ['sync', '--hook']]) {
    const r = guarded([BIN, ...args], { cwd: dataDir, env });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /NETWORK USED/);
  }
  assert.ok(fs.existsSync(path.join(dataDir, 'characters')), 'sync really ran');
  // The update check is loaded only by the commands that use it.
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'sync.js'), 'utf8'), /update-check/);
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8'), /^import .*update-check/m);
});
