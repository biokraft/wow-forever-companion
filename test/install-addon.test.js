import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installAddon, addonSourceDir } from '../src/install-addon.js';

let game;
beforeEach(() => {
  game = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-install-'));
  fs.mkdirSync(path.join(game, 'Interface', 'AddOns'), { recursive: true });
});
afterEach(() => fs.rmSync(game, { recursive: true, force: true }));

test('copy install puts the addon files into AddOns', () => {
  const dest = installAddon(game, { link: false });
  assert.equal(dest, path.join(game, 'Interface', 'AddOns', 'ForeverLog'));
  assert.ok(fs.existsSync(path.join(dest, 'ForeverLog.toc')));
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
});

test('link install creates a symlink to the repo addon folder', () => {
  const dest = installAddon(game, { link: true });
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(dest), fs.realpathSync(addonSourceDir()));
});

test('reinstalling replaces a previous link without touching the source', () => {
  installAddon(game, { link: true });
  const dest = installAddon(game, { link: false });
  assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
  assert.ok(fs.existsSync(path.join(addonSourceDir(), 'ForeverLog.toc')), 'source intact');
});

test('missing AddOns folder is an error', () => {
  assert.throws(() => installAddon(path.join(game, 'nope'), { link: false }), /not a WoW: Forever folder/);
});

test('install writes a default empty plan file and keeps an existing one', () => {
  const dest = installAddon(game, { link: false });
  const planFile = path.join(dest, 'ForeverLog_Plan.lua');
  assert.match(fs.readFileSync(planFile, 'utf8'), /ForeverLogPlan = nil/);
  fs.writeFileSync(planFile, 'ForeverLogPlan = { ["title"] = "kept" }\n');
  installAddon(game, { link: false });
  assert.match(fs.readFileSync(planFile, 'utf8'), /kept/);
});

test('review: a game folder without Interface/AddOns gets one', () => {
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-fresh-'));
  fs.mkdirSync(path.join(g, 'World of Warcraft.app'));
  const dest = installAddon(g, { link: false });
  assert.ok(fs.existsSync(path.join(dest, 'ForeverLog.toc')));
  fs.rmSync(g, { recursive: true, force: true });
});
