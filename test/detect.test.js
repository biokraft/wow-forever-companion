import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findGameDir, listCharacters, addonsDir, defaultGameDirs } from '../src/detect.js';
import { loadConfig, saveConfig, configPath } from '../src/config.js';

let root, game;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-detect-'));
  game = path.join(root, '_forever_');
  const realm = path.join(game, 'WTF', 'Account', 'ACC#1', '7');
  fs.mkdirSync(path.join(realm, 'Testa-Grimtusk', 'SavedVariables'), { recursive: true });
  fs.writeFileSync(path.join(realm, 'Testa-Grimtusk', 'SavedVariables', 'ForeverLog.lua'), 'ForeverLogDB = {\n}\n');
  fs.mkdirSync(path.join(realm, 'Moo-Hoofson', 'SavedVariables'), { recursive: true });
  fs.mkdirSync(path.join(game, 'WTF', 'Account', 'ACC#1', 'SavedVariables'), { recursive: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('listCharacters finds every character folder and flags which have ForeverLog data', () => {
  const chars = listCharacters(game);
  assert.deepEqual(chars.map((c) => [c.folder, c.hasData]).sort(), [['Moo-Hoofson', false], ['Testa-Grimtusk', true]]);
  const testa = chars.find((c) => c.folder === 'Testa-Grimtusk');
  assert.equal(testa.account, 'ACC#1');
  assert.equal(testa.realmDir, '7');
  assert.equal(testa.svPath, path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Testa-Grimtusk', 'SavedVariables', 'ForeverLog.lua'));
});

test('listCharacters returns [] for a folder without WTF', () => {
  assert.deepEqual(listCharacters(path.join(root, 'missing')), []);
});

test('findGameDir returns the first candidate that has WTF/Account', () => {
  assert.equal(findGameDir([path.join(root, 'missing'), game]), game);
  assert.equal(findGameDir([path.join(root, 'missing')]), null);
});

test('defaultGameDirs knows the macOS and Windows install paths', () => {
  assert.deepEqual(defaultGameDirs('darwin'), ['/Applications/World of Warcraft/_forever_']);
  assert.ok(defaultGameDirs('win32').includes('C:\\Program Files (x86)\\World of Warcraft\\_forever_'));
});

test('addonsDir points at Interface/AddOns', () => {
  assert.equal(addonsDir(game), path.join(game, 'Interface', 'AddOns'));
});

test('loadConfig returns null when the config file is missing', () => {
  process.env.WOWF_CONFIG = path.join(root, 'nope', 'config.json');
  assert.equal(loadConfig(), null);
});

test('saveConfig then loadConfig round-trips and creates the folder', () => {
  process.env.WOWF_CONFIG = path.join(root, 'cfg', 'config.json');
  const cfg = { gameDir: game, dataDir: path.join(root, 'data'), main: 'Testa-Grimtusk' };
  saveConfig(cfg);
  assert.equal(configPath(), process.env.WOWF_CONFIG);
  assert.deepEqual(loadConfig(), cfg);
});

test('loadConfig migrates a legacy claude-forever config to forever-companion', () => {
  delete process.env.WOWF_CONFIG;
  const home = path.join(root, 'home');
  const legacy = path.join(home, '.config', 'claude-forever', 'config.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, JSON.stringify({ gameDir: 'g', dataDir: 'd', main: 'Testa-Grimtusk' }));
  const prevHome = process.env.HOME;
  const prevAppData = process.env.APPDATA;
  process.env.HOME = home;
  process.env.APPDATA = path.join(home, 'AppData'); // Windows reads %APPDATA%, never the real one
  if (process.platform === 'win32') {
    fs.mkdirSync(path.join(home, 'AppData', 'claude-forever'), { recursive: true });
    fs.copyFileSync(legacy, path.join(home, 'AppData', 'claude-forever', 'config.json'));
  }
  try {
    assert.match(configPath(), /forever-companion/);
    assert.deepEqual(loadConfig(), { gameDir: 'g', dataDir: 'd', main: 'Testa-Grimtusk' });
    const migrated = process.platform === 'win32' ? path.join(home, 'AppData', 'forever-companion', 'config.json') : path.join(home, '.config', 'forever-companion', 'config.json');
    assert.ok(fs.existsSync(migrated));
  } finally {
    process.env.HOME = prevHome;
    if (prevAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = prevAppData;
  }
});

test('review: saveConfig writes atomically (no partial file left behind)', () => {
  process.env.WOWF_CONFIG = path.join(root, 'cfg2', 'config.json');
  saveConfig({ gameDir: 'g', dataDir: 'd', main: null });
  assert.deepEqual(fs.readdirSync(path.join(root, 'cfg2')), ['config.json']);
});

import { windowsRegistryGameDir } from '../src/detect.js';

test('Windows: the registry install path leads to the _forever_ folder', () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft\r\n    InstallPath    REG_SZ    D:\\Games\\World of Warcraft\\_retail_\\\r\n';
  assert.equal(windowsRegistryGameDir(() => out), 'D:\\Games\\World of Warcraft\\_forever_');
  assert.ok(defaultGameDirs('win32', { registryDir: 'D:\\Games\\World of Warcraft\\_forever_' }).includes('D:\\Games\\World of Warcraft\\_forever_'));
});

test('Windows: a failing registry query falls back silently', () => {
  assert.equal(windowsRegistryGameDir(() => { throw new Error('reg not found'); }), null);
  assert.equal(windowsRegistryGameDir(() => 'no InstallPath here'), null);
});

import { isGameDir } from '../src/detect.js';

test('review: a fresh _forever_ folder (no WTF yet) is recognised by the game app or Interface', () => {
  const fresh = path.join(root, 'fresh', '_forever_');
  fs.mkdirSync(path.join(fresh, 'World of Warcraft.app'), { recursive: true });
  assert.equal(isGameDir(fresh), true);
  assert.equal(findGameDir([fresh]), fresh);
  assert.equal(isGameDir(path.join(root, 'nothing-here')), false);
});

test('review: registry paths ending in _classic_era_ map to _forever_', () => {
  const out = '    InstallPath    REG_SZ    D:\\Games\\World of Warcraft\\_classic_era_\\\r\n';
  assert.equal(windowsRegistryGameDir(() => out), 'D:\\Games\\World of Warcraft\\_forever_');
});
