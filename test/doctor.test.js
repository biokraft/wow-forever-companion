import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doctorReport, redactHome, execCommand } from '../src/doctor.js';

const home = '/Users/someone';
const cfg = { gameDir: `${home}/Games/_forever_`, dataDir: `${home}/fc data`, main: 'Thrall-Realm' };
const good = () => ({
  version: '1.2.0', platform: 'darwin', nodeVersion: 'v22.3.0', home, cfg,
  exists: () => true,
  exec: async (cmd, args) => (args[0] === '--list-models' ? { code: 0, stdout: 'provider model-x\n' } : { code: 0, stdout: '1.0\n' }),
  syncState: { 'Thrall-Realm': { slug: 'thrall-abc' } },
  installedAddonVersion: '1.2.0', overlayDir: `${home}/fc/overlay`,
});
const IDS = ['node', 'config', 'game', 'addon', 'data', 'snapshot', 'overlay', 'backend', 'ai'];

test('all good: ok with nine checks in order', async () => {
  const r = await doctorReport(good());
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks.map((c) => c.id), IDS);
  assert.ok(r.lines.every((l) => !l.includes('FIX')));
});

test('missing config fails config with the setup command', async () => {
  const r = await doctorReport({ ...good(), cfg: null });
  const c = r.checks.find((x) => x.id === 'config');
  assert.equal(c.ok, false);
  assert.match(c.text, /run: node bin\/wowf setup/);
  assert.equal(r.ok, false);
});

test('older addon fails addon with the update command', async () => {
  const r = await doctorReport({ ...good(), installedAddonVersion: '1.0.0' });
  const c = r.checks.find((x) => x.id === 'addon');
  assert.equal(c.ok, false);
  assert.match(c.text, /run: node bin\/wowf update/);
});

test('Node 20 fails node', async () => {
  const r = await doctorReport({ ...good(), nodeVersion: 'v20.11.0' });
  assert.equal(r.checks.find((x) => x.id === 'node').ok, false);
});

test('no line carries the home path, a character name, or model names', async () => {
  const r = await doctorReport({ ...good(), cfg: { ...cfg, overlay: { backend: 'pi', model: 'secret-model' } }, exists: () => false });
  for (const l of r.lines) {
    assert.ok(!l.includes(home) && !l.includes('Thrall') && !l.includes('secret-model') && !l.includes('model-x'), l);
  }
});

test('missing ai tool fails ai; claude backend checks claude', async () => {
  const calls = [];
  const r = await doctorReport({ ...good(), cfg: { ...cfg, overlay: { backend: 'claude' } }, exec: async (c, a) => { calls.push(c); throw new Error('nope'); } });
  assert.deepEqual(calls, ['claude']);
  assert.equal(r.checks.find((x) => x.id === 'ai').ok, false);
});

test('pi without a model fails ai', async () => {
  const r = await doctorReport({ ...good(), exec: async (c, a) => ({ code: 0, stdout: a[0] === '--list-models' ? 'No models available' : '1' }) });
  assert.equal(r.checks.find((x) => x.id === 'ai').ok, false);
});

test('update line only when given', async () => {
  assert.ok(!(await doctorReport(good())).lines.some((l) => /^Update/.test(l)));
  const r = await doctorReport({ ...good(), update: { latest: '1.3.0', newer: true } });
  assert.ok(r.lines.some((l) => /^Update: 1\.3\.0/.test(l)));
});

test('redactHome handles both slash styles', () => {
  assert.equal(redactHome("D:\\fc\\p\\x and D:/fc/p/y", "D:\\fc\\p"), "~\\x and ~/y");
});

test('snapshot check opens characters/<slug>.json, not the main folder name', async () => {
  const seen = [];
  const r = await doctorReport({ ...good(), exists: (p) => { seen.push(p.replaceAll('\\', '/')); return true; } });
  assert.ok(seen.some((p) => p.endsWith('/characters/thrall-abc.json')));
  assert.ok(!seen.some((p) => p.includes('Thrall-Realm.json')));
  assert.equal(r.checks.find((x) => x.id === 'snapshot').ok, true);
});

test('a wrongly named snapshot file fails', async () => {
  const r = await doctorReport({ ...good(), exists: (p) => !p.includes('characters') });
  const c = r.checks.find((x) => x.id === 'snapshot');
  assert.equal(c.ok, false);
  assert.match(c.text, /\/fc sync/);
});

test('missing sync state or main fails snapshot without throwing', async () => {
  for (const o of [{ syncState: null }, { syncState: {} }, { cfg: { ...cfg, main: null } }, { cfg: null }]) {
    const r = await doctorReport({ ...good(), ...o });
    assert.equal(r.checks.find((x) => x.id === 'snapshot').ok, false);
  }
});

test('a home path injected into a line is redacted (Windows home with a space)', async () => {
  const h = 'C:\\Users\\Jane Doe';
  const r = await doctorReport({ ...good(), home: h, update: { latest: `${h}\\x and c:/users/jane doe/y`, newer: true } });
  const l = r.lines.find((x) => x.startsWith('Update'));
  assert.ok(l.includes('~'));
  assert.ok(!/jane/i.test(l), l);
});

test('redactHome keeps a longer sibling name, ignores tiny homes, matches Windows case-insensitively', () => {
  assert.equal(redactHome('/srv/fcuser2/x /srv/fcuser/y', '/srv/fcuser'), '/srv/fcuser2/x ~/y');
  assert.equal(redactHome('a/b/c', '/'), 'a/b/c');
  assert.equal(redactHome('a/b/c', ''), 'a/b/c');
  assert.equal(redactHome('a/b/c', 'a'), 'a/b/c');
  assert.equal(redactHome('c:\\users\\x\\f', 'C:\\Users\\x'), '~\\f');
  assert.equal(redactHome('C:\\Users\\xavier', 'C:\\Users\\x'), 'C:\\Users\\xavier');
  assert.equal(redactHome('home is /srv/fcuser', '/srv/fcuser'), 'home is ~');
});

test('execCommand starts the resolved command (an npm shim on Windows) with the arguments as an array', async () => {
  const resolve = (name) => (name === 'fc-test-no-such-pi' ? { command: process.execPath, args: ['-e', 'console.log(process.argv.slice(1).join("|"))', '--'] } : null);
  const r = await execCommand('fc-test-no-such-pi', ['--list-models', 'a b'], { resolve });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '--list-models|a b');
});
