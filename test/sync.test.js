import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncAll, formatSummary } from '../src/sync.js';
import { charSlug } from '../src/slug.js';

const FIXTURE = fs.readFileSync(new URL('./fixtures/sv/ForeverLog.lua', import.meta.url), 'utf8');
const NOW = 1795600000 + 240; // fixture snapshot time + 4 minutes

let root, cfg, svPath;
const svDir = () => path.dirname(svPath);
const charJson = () => path.join(cfg.dataDir, 'characters', 'testrealm-testa-grimtusk.json');
const journalFile = () => path.join(cfg.dataDir, 'characters', 'testrealm-testa-grimtusk.journal.jsonl');
const journalLines = () => fs.readFileSync(journalFile(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

function writeSv(text, mtimeSec) {
  fs.writeFileSync(svPath, text);
  if (mtimeSec) fs.utimesSync(svPath, mtimeSec, mtimeSec);
}

// Appends a journal entry and bumps journalSeq in the fixture text.
function withExtraEntry(text, seq) {
  return text
    .replace('["journalSeq"] = 3,', `["journalSeq"] = ${seq},`)
    .replace(/\["journal"\] = \{\n/, `["journal"] = {\n{\n["seq"] = ${seq},\n["time"] = 1795600100,\n["kind"] = "death",\n["data"] = {\n},\n},\n`);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-sync-'));
  const game = path.join(root, '_forever_');
  svPath = path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Testa-Grimtusk', 'SavedVariables', 'ForeverLog.lua');
  fs.mkdirSync(path.dirname(svPath), { recursive: true });
  fs.mkdirSync(path.join(game, 'WTF', 'Account', 'ACC#1', '7', 'Moo-Hoofson', 'SavedVariables'), { recursive: true });
  writeSv(FIXTURE, 1795600000);
  cfg = { gameDir: game, dataDir: path.join(root, 'data'), main: 'Testa-Grimtusk' };
  fs.mkdirSync(cfg.dataDir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('charSlug is realm-name, lowercased, dashed', () => {
  assert.equal(charSlug({ realm: 'Test Realm', name: "Testa O'Grim" }), 'test-realm-testa-o-grim');
});

test('first sync writes the snapshot JSON and every journal entry', () => {
  const results = syncAll(cfg, { now: NOW });
  const testa = results.find((r) => r.folder === 'Testa-Grimtusk');
  assert.equal(testa.status, 'updated');
  assert.equal(testa.level, 12);
  assert.equal(testa.xpPct, 40);
  assert.equal(testa.ageSec, 240);
  assert.equal(testa.newJournal, 3);
  const snap = JSON.parse(fs.readFileSync(charJson(), 'utf8'));
  assert.equal(snap.name, 'Testa Grimtusk');
  assert.equal(snap.syncedAt, NOW);
  assert.deepEqual(journalLines().map((e) => e.seq), [1, 2, 3]);
});

test('character without ForeverLog data reports no-data', () => {
  const moo = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Moo-Hoofson');
  assert.equal(moo.status, 'no-data');
});

test('second sync with an unchanged file is a no-op', () => {
  syncAll(cfg, { now: NOW });
  const before = fs.statSync(charJson()).mtimeMs;
  const testa = syncAll(cfg, { now: NOW + 60 }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.equal(testa.status, 'unchanged');
  assert.equal(fs.statSync(charJson()).mtimeMs, before);
});

test('new journal entries append only the unseen ones', () => {
  syncAll(cfg, { now: NOW });
  writeSv(withExtraEntry(FIXTURE, 4), 1795600200);
  const testa = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.equal(testa.newJournal, 1);
  assert.deepEqual(journalLines().map((e) => e.seq), [1, 2, 3, 4]);
});

test('a journal reset (journalSeq below last synced) appends everything as a new epoch', () => {
  writeSv(withExtraEntry(FIXTURE, 4), 1795600000);
  syncAll(cfg, { now: NOW });
  writeSv(FIXTURE, 1795600300); // journalSeq back to 3
  const testa = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.ok(testa.changes.includes('journal reset'));
  assert.equal(testa.newJournal, 3);
  assert.equal(journalLines().length, 7);
});

test('a truncated SavedVariables file is an error and keeps the previous JSON', () => {
  syncAll(cfg, { now: NOW });
  const before = fs.readFileSync(charJson());
  writeSv(FIXTURE.slice(0, 900), 1795600400);
  const testa = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.equal(testa.status, 'error');
  assert.match(testa.error, /line/);
  assert.deepEqual(fs.readFileSync(charJson()), before);
});

test('level and zone changes are reported', () => {
  syncAll(cfg, { now: NOW });
  writeSv(FIXTURE.replace('["level"] = 12,', '["level"] = 13,').replace('["zone"] = "Durotar",', '["zone"] = "The Barrens",'), 1795600500);
  const testa = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.ok(testa.changes.includes('level 12 → 13'));
  assert.ok(testa.changes.includes('zone Durotar → The Barrens'));
});

test('when the data folder is a git repo, sync commits and never pushes', () => {
  const git = (...args) => execFileSync('git', ['-C', cfg.dataDir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  syncAll(cfg, { now: NOW });
  assert.equal(git('log', '-1', '--format=%s').trim(), 'sync: Testa L12 40% XP, Durotar');
  assert.equal(git('remote').trim(), '');
  syncAll(cfg, { now: NOW + 1 });
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1', 'no empty commit when unchanged');
});

test('formatSummary renders one line per updated character', () => {
  const line = formatSummary(syncAll(cfg, { now: NOW }));
  assert.equal(line, 'Testa L12 40% XP · Razor Hill · snapshot 4m old · +3 events · nudges: talent point, trainer due');
});

test('character JSON carries nudges computed from snapshot and journal', () => {
  syncAll(cfg, { now: NOW });
  const snap = JSON.parse(fs.readFileSync(charJson(), 'utf8'));
  assert.deepEqual(snap.nudges.map((n) => n.kind).sort(), ['rested', 'talent_points', 'trainer_due']);
});

test('empty realm falls back to the realm part of the character folder name', () => {
  const zugDir = path.join(cfg.gameDir, 'WTF', 'Account', 'ACC#1', '42', 'Zug-Ashmantle', 'SavedVariables');
  fs.mkdirSync(zugDir, { recursive: true });
  fs.writeFileSync(path.join(zugDir, 'ForeverLog.lua'),
    FIXTURE.replace('["name"] = "Testa Grimtusk",', '["name"] = "Zug",').replace('["realm"] = "Testrealm",', '["realm"] = "",'));
  const zug = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Zug-Ashmantle');
  assert.equal(zug.slug, 'ashmantle-zug');
  const snap = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'characters', 'ashmantle-zug.json'), 'utf8'));
  assert.equal(snap.realm, 'Ashmantle');
});

test('empty gear slots the game writes as nil are left out, so every equipped entry is an item', () => {
  // As the game saves a character with nothing on head, neck and shoulder and a ring gap:
  // positional entries with nil for the empty slots, then keyed ones.
  const table = 'nil,\nnil,\nnil,\n{\n["id"] = 104,\n["name"] = "Shirt",\n},\n[16] = {\n["id"] = 116,\n["name"] = "Axe",\n},\n';
  writeSv(FIXTURE.replace(/\["equipped"\] = \{\n\[16\] = \{[\s\S]*?\n\},\n\},\n\},\n/, `["equipped"] = {\n${table}},\n`), 1795600000);
  syncAll(cfg, { now: NOW });
  const snap = JSON.parse(fs.readFileSync(charJson(), 'utf8'));
  assert.deepEqual(Object.keys(snap.equipped).sort(), ['16', '4']);
  assert.equal(snap.equipped['4'].name, 'Shirt');
  assert.ok(Object.values(snap.equipped).every((it) => it && typeof it === 'object'));
});

test('review: equipped with contiguous slots 1..3 stays an object keyed by slot id', () => {
  const slots = [1, 2, 3].map((n) => `[${n}] = {\n["id"] = ${100 + n},\n["name"] = "Item ${n}",\n},\n`).join('');
  writeSv(FIXTURE.replace(/\["equipped"\] = \{\n\[16\] = \{[\s\S]*?\n\},\n\},\n\},\n/, `["equipped"] = {\n${slots}},\n`), 1795600000);
  syncAll(cfg, { now: NOW });
  const snap = JSON.parse(fs.readFileSync(charJson(), 'utf8'));
  assert.ok(!Array.isArray(snap.equipped));
  assert.equal(snap.equipped['1'].name, 'Item 1');
  assert.equal(snap.equipped['3'].id, 103);
});

test('review: a changed journal epoch is a reset even when the new seq overtakes the old one', () => {
  writeSv(FIXTURE.replace('["journalSeq"] = 3,', '["journalSeq"] = 3,\n["epoch"] = 111,'), 1795600000);
  syncAll(cfg, { now: NOW });
  // new install: epoch changes, seq restarts and climbs past 3 before the next sync
  let fresh = FIXTURE.replace('["journalSeq"] = 3,', '["journalSeq"] = 5,\n["epoch"] = 222,');
  fresh = withExtraEntry(withExtraEntry(fresh, 4), 5).replace(/\["journalSeq"\] = \d+,/, '["journalSeq"] = 5,');
  writeSv(fresh, 1795600600);
  const testa = syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk');
  assert.ok(testa.changes.includes('journal reset'));
  assert.equal(testa.newJournal, 5);
});

test('review: sync commits only the characters folder, never other staged files', () => {
  const git = (...args) => execFileSync('git', ['-C', cfg.dataDir, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(cfg.dataDir, 'notes.md'), 'draft\n');
  git('add', 'notes.md');
  syncAll(cfg, { now: NOW });
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').filter((f) => !f.startsWith('characters/')), []);
  assert.match(git('status', '--porcelain'), /^A  notes\.md/m, 'still staged, not committed');
});

test('review: first sync writes .wowf and temp files into the data folder gitignore', () => {
  syncAll(cfg, { now: NOW });
  const ignore = fs.readFileSync(path.join(cfg.dataDir, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.wowf\/$/m);
  assert.match(ignore, /^\*\.tmp-\*$/m);
  assert.match(ignore, /^chats\/$/m, 'overlay chat transcripts stay out of git');
});

test('review: one unreadable character does not stop or repeat the others', () => {
  syncAll(cfg, { now: NOW });
  writeSv(withExtraEntry(FIXTURE, 4), 1795600200);
  const bad = path.join(cfg.gameDir, 'WTF', 'Account', 'ACC#1', '7', 'Moo-Hoofson', 'SavedVariables', 'ForeverLog.lua');
  fs.mkdirSync(bad, { recursive: true }); // listed as having data, but cannot be read
  const results = syncAll(cfg, { now: NOW });
  assert.equal(results.find((r) => r.folder === 'Moo-Hoofson').status, 'error');
  assert.equal(results.find((r) => r.folder === 'Testa-Grimtusk').newJournal, 1);
  syncAll(cfg, { now: NOW });
  assert.deepEqual(journalLines().map((e) => e.seq), [1, 2, 3, 4]);
});

test('review: an unreadable file is reported once per file version, then stays quiet', () => {
  writeSv(FIXTURE.slice(0, 900), 1795600400);
  assert.equal(syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk').status, 'error');
  assert.equal(syncAll(cfg, { now: NOW }).find((r) => r.folder === 'Testa-Grimtusk').status, 'unchanged');
});

// Git with no identity anywhere, as Git for Windows usually is: an empty system config, a
// global config that only forbids guessing, and a temp home. Restores the environment after.
function withNoGitIdentity(fn) {
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'USERPROFILE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const global = path.join(home, 'gitconfig');
  fs.writeFileSync(global, '[user]\n\tuseConfigOnly = true\n');
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', HOME: home, USERPROFILE: home });
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('a data folder repo without any git identity still gets its commit, under a neutral name', () => {
  withNoGitIdentity(() => {
    const git = (...args) => execFileSync('git', ['-C', cfg.dataDir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    const results = syncAll(cfg, { now: NOW });
    assert.equal(results.find((r) => r.folder === 'Testa-Grimtusk').status, 'updated');
    assert.equal(git('log', '-1', '--format=%an <%ae>').trim(), 'Forever Companion <forever-companion@localhost>');
    assert.doesNotMatch(fs.readFileSync(path.join(cfg.dataDir, '.git', 'config'), 'utf8'), /\[user\]/, 'nothing written to the repo config');
  });
});

test('a git commit that fails never fails the sync: the data is already written', () => {
  // A .git that is not a repository: every git command fails.
  fs.mkdirSync(path.join(cfg.dataDir, '.git'));
  const results = syncAll(cfg, { now: NOW });
  assert.equal(results.find((r) => r.folder === 'Testa-Grimtusk').status, 'updated');
  assert.ok(fs.existsSync(charJson()));
});
