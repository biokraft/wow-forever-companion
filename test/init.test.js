import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initData } from '../src/init.js';

let root, cfgFile, savedEnv;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-init-')));
  cfgFile = path.join(root, 'config.json');
  savedEnv = process.env.WOWF_CONFIG;
  process.env.WOWF_CONFIG = cfgFile;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.WOWF_CONFIG;
  else process.env.WOWF_CONFIG = savedEnv;
  fs.rmSync(root, { recursive: true, force: true });
});

const readCfg = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

test('a setup re-run with a new main keeps updateCheck: false and every other key', () => {
  const game = path.join(root, 'game');
  const data = path.join(root, 'data');
  fs.writeFileSync(cfgFile, JSON.stringify({
    gameDir: game, dataDir: data, main: 'Old-Realm',
    updateCheck: false, overlay: { backend: 'pi', hotkey: 'F9' }, somethingNew: { kept: 1 },
  }));
  initData({ gameDir: game, dataDir: data, main: 'New-Realm' });
  const cfg = readCfg();
  assert.equal(cfg.main, 'New-Realm');
  assert.equal(cfg.updateCheck, false);
  assert.deepEqual(cfg.overlay, { backend: 'pi', hotkey: 'F9' });
  assert.deepEqual(cfg.somethingNew, { kept: 1 });
});

test('initData says whether it created anything: a complete folder is left as it is', () => {
  const data = path.join(root, 'data');
  const first = initData({ gameDir: path.join(root, 'game'), dataDir: data });
  assert.equal(first.created, true);
  const again = initData({ gameDir: path.join(root, 'game'), dataDir: data });
  assert.equal(again.created, false);
  fs.rmSync(path.join(data, 'plans'), { recursive: true });
  const repaired = initData({ gameDir: path.join(root, 'game'), dataDir: data });
  assert.equal(repaired.created, true);
  assert.ok(fs.statSync(path.join(data, 'plans')).isDirectory());
});

test('gitSafeToRun: only a Mac without the command line tools and without another git is unsafe', async () => {
  const { gitSafeToRun } = await import('../src/init.js');
  assert.equal(gitSafeToRun({ platform: 'win32' }), true);
  assert.equal(gitSafeToRun({ platform: 'linux' }), true);
  assert.equal(gitSafeToRun({ platform: 'darwin', toolsInstalled: () => true }), true);
  const onlyStub = (p) => p === '/usr/bin/git';
  assert.equal(gitSafeToRun({ platform: 'darwin', toolsInstalled: () => false, pathEnv: '/usr/local/bin:/usr/bin', exists: onlyStub }), false,
    'the /usr/bin stub would open the install dialog');
  const brew = (p) => p === '/opt/homebrew/bin/git' || p === '/usr/bin/git';
  assert.equal(gitSafeToRun({ platform: 'darwin', toolsInstalled: () => false, pathEnv: '/opt/homebrew/bin:/usr/bin', exists: brew }), true);
  assert.equal(gitSafeToRun({ platform: 'darwin', toolsInstalled: () => false, pathEnv: '', exists: () => false }), false);
});
