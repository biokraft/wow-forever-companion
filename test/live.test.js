import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFakeQuestie } from './helpers/questie-fixture.js';
import { readLive, mergeLive, liveLine, LIVE_MAX_AGE_SEC } from '../src/live.js';
import { readCharacter, questsAvailable, writePlan } from '../src/core.js';
import { openQuestieDb } from '../src/questie/db.js';
import { characterTag } from '../src/bridge/codec.js';

const NOW = 1795600000;
const SLUG = 'testrealm-testchar-grimtusk';
const TAG = characterTag('Testchar Grimtusk', 'WARRIOR');

const snapshot = () => ({
  name: 'Testchar Grimtusk', classFile: 'WARRIOR', raceId: 8, classId: 1,
  level: 11, xp: 100, xpMax: 1000, rested: 0, money: 500,
  zone: 'Durotar', subzone: 'Razor Hill', mapId: 1411, x: 0.5214, y: 0.4377,
  completedQuests: [100],
  quests: [
    { id: 791, title: 'Carry Your Weight', level: 8, complete: false,
      objectives: [{ text: 'Canvas Scraps: 4/8', done: false, have: 4, need: 8 }] },
    { id: 792, title: 'Speak Up', level: 9, complete: false,
      objectives: [{ text: 'Speak to the chieftain', done: false }] },
    { id: 101, title: 'Follow Up', level: 3, complete: true, objectives: [] },
  ],
});

const live = (over = {}) => ({
  seenAt: NOW - 5, changedAt: NOW - 30, seq: 7, tag: TAG,
  level: 12, xp: 450, xpMax: 1000, rested: 300, money: 1234,
  map: { uiMapId: 1411, x: 44.9, y: 13.2 },
  quests: null, questsComplete: false,
  ...over,
});

let root;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-live-'))); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function writeLiveFile(dataDir, name, value) {
  fs.mkdirSync(path.join(dataDir, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'characters', `${name}.live.json`), typeof value === 'string' ? value : JSON.stringify(value));
}

test('readLive: fresh file is returned; 121 s old is stale; 120 s is still fresh', () => {
  const cfg = { dataDir: root };
  assert.equal(LIVE_MAX_AGE_SEC, 120);
  writeLiveFile(root, SLUG, live({ seenAt: NOW - 121 }));
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW, savedMtimeMs: 0 }), null);
  writeLiveFile(root, SLUG, live({ seenAt: NOW - 120 }));
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW, savedMtimeMs: 0 }).level, 12);
});

test('readLive: SavedVariables written at or after seenAt win (a /fc sync after live data)', () => {
  const cfg = { dataDir: root };
  writeLiveFile(root, SLUG, live({ seenAt: NOW - 5 }));
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW, savedMtimeMs: (NOW - 5) * 1000 }), null);
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW, savedMtimeMs: (NOW - 2) * 1000 }), null);
  assert.ok(readLive(cfg, SLUG, { nowSec: NOW, savedMtimeMs: (NOW - 6) * 1000 }));
});

test('readLive: missing or unparseable files are null', () => {
  const cfg = { dataDir: root };
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW }), null);
  writeLiveFile(root, SLUG, '{ not json');
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW }), null);
  writeLiveFile(root, SLUG, JSON.stringify({ level: 3 }));
  assert.equal(readLive(cfg, SLUG, { nowSec: NOW }), null);
});

test('mergeLive copies level, xp, rested, money, map as liveMap and marks live; snapshot position keeps its units', () => {
  const s = snapshot();
  const m = mergeLive(s, live());
  assert.equal(m.level, 12);
  assert.equal(m.xp, 450);
  assert.equal(m.xpMax, 1000);
  assert.equal(m.rested, 300);
  assert.equal(m.money, 1234);
  assert.deepEqual(m.live, { seenAt: NOW - 5, changedAt: NOW - 30, questsComplete: false, snapshotLevel: 11 });
  assert.equal(m.liveMap.uiMapId, 1411);
  assert.equal(m.liveMap.x, 44.9);
  assert.equal(m.liveMap.y, 13.2);
  assert.equal(m.x, 0.5214);
  assert.equal(m.y, 0.4377);
  assert.equal(s.level, 11, 'the input snapshot is not mutated');
});

test('mergeLive with questsComplete false leaves the quest log untouched', () => {
  const m = mergeLive(snapshot(), live({ quests: [{ id: 791, complete: true, failed: false, objectives: [8] }], questsComplete: false }));
  assert.deepEqual(m.quests, snapshot().quests);
  assert.ok(!m.quests.some((q) => q.leftLog));
});

test('mergeLive with a complete quest log updates progress, marks quests that left, and appends new ones', () => {
  const s = snapshot();
  const m = mergeLive(s, live({
    questsComplete: true,
    quests: [
      { id: 791, complete: true, failed: false, objectives: [8] },
      { id: 792, complete: true, failed: false, objectives: [0] },
      { id: 102, complete: false, failed: false, objectives: [2] },
    ],
  }), { questInfo: (id) => (id === 102 ? { name: 'Smithing Task', questLevel: 3 } : null) });
  const byId = new Map(m.quests.map((q) => [q.id, q]));
  assert.equal(byId.get(791).complete, true);
  assert.deepEqual(byId.get(791).objectives[0], { text: 'Canvas Scraps: 8/8', done: true, have: 8, need: 8 });
  // An objective without counts keeps its text; completion of the quest marks it done.
  assert.equal(byId.get(792).objectives[0].done, true);
  assert.equal(byId.get(792).objectives[0].text, 'Speak to the chieftain');
  // 101 left the log: turned in or abandoned, settled by the next sync.
  assert.equal(byId.get(101).leftLog, true);
  assert.ok(!m.completedQuests.includes(101), 'a quest that left the log is not counted as completed');
  assert.equal(byId.get(102).title, 'Smithing Task');
  assert.equal(byId.get(102).objectives[0].have, 2);
  assert.equal(m.quests.at(-1).id, 102, 'live-only quests are appended');
  assert.ok(!byId.get(791).leftLog);
});

test('mergeLive titles an unknown live-only quest by id', () => {
  const m = mergeLive(snapshot(), live({ questsComplete: true, quests: [{ id: 4242, complete: false, failed: false, objectives: [] }] }));
  assert.equal(m.quests.find((q) => q.id === 4242).title, 'Quest #4242');
});

test('liveLine: level, XP, zone with coordinates and ready turn-ins', () => {
  const m = mergeLive(snapshot(), live({
    questsComplete: true,
    quests: [
      { id: 791, complete: true, failed: false, objectives: [8] },
      { id: 792, complete: true, failed: false, objectives: [0] },
      { id: 101, complete: true, failed: false, objectives: [] },
    ],
  }));
  assert.equal(liveLine(m, { zoneName: () => 'Durotar', nowSec: NOW }), 'Live: L12 45% XP · Durotar 44.9/13.2 · 3 quests ready to turn in · L11 at last sync · 5s ago');
});

test('liveLine: zone falls back to the snapshot zone on the same map, else the map id; no turn-ins means no tail', () => {
  const s = snapshot();
  s.quests = [];
  const all = { questsComplete: true, quests: [] };
  assert.equal(liveLine(mergeLive(s, live(all)), { nowSec: NOW }), 'Live: L12 45% XP · Durotar 44.9/13.2 · L11 at last sync · 5s ago');
  assert.equal(liveLine(mergeLive(s, live({ ...all, map: { uiMapId: 9999, x: 1, y: 2 } })), { nowSec: NOW }), 'Live: L12 45% XP · map 9999 1.0/2.0 · L11 at last sync · 5s ago');
  assert.equal(liveLine(s), null, 'no live data, no line');
});

test('liveLine says how old the live values are, and when quest progress is still from the last sync', () => {
  const s = snapshot();
  const line = liveLine(mergeLive(s, live()), { nowSec: NOW + 7 });
  assert.equal(line, 'Live: L12 45% XP · Durotar 44.9/13.2 · 1 quest ready to turn in · quest progress from last sync · L11 at last sync · 12s ago');
  assert.match(liveLine(mergeLive(s, live({ seenAt: NOW - 100 })), { nowSec: NOW }), / · 2 min ago$/);
  assert.match(liveLine(mergeLive(s, live({ seenAt: NOW + 3 })), { nowSec: NOW }), / · 0s ago$/, 'a clock skew never shows a negative age');
  assert.doesNotMatch(liveLine(mergeLive(s, live({ questsComplete: true, quests: [] })), { nowSec: NOW }), /quest progress from last sync/);
});

test('liveLine: one ready quest is singular; leftLog quests are not ready', () => {
  const m = mergeLive(snapshot(), live({ questsComplete: true, quests: [{ id: 791, complete: true, failed: false, objectives: [8] }] }));
  assert.match(liveLine(m, { zoneName: () => 'Durotar' }), / · 1 quest ready to turn in · 2 quests left the log /);
});

test('uiMapZoneName maps a uiMapId back to a Questie zone name', () => {
  const addons = path.join(root, 'AddOns');
  writeFakeQuestie(addons);
  const db = openQuestieDb(addons);
  assert.equal(db.uiMapZoneName(1411), 'Durotar');
  assert.equal(db.uiMapZoneName(1413), 'The Barrens');
  assert.equal(db.uiMapZoneName(4242), null);
});

// --- readCharacter: the merge as every consumer sees it ---

function setupData({ mtimeMs = (NOW - 600) * 1000, snap = snapshot() } = {}) {
  const game = path.join(root, '_forever_');
  writeFakeQuestie(path.join(game, 'Interface', 'AddOns'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, '.wowf'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'characters'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, '.wowf', 'sync-state.json'),
    JSON.stringify({ 'Testchar-Grimtusk': { slug: SLUG, mtimeMs, lastSeq: 0, epoch: null } }));
  fs.writeFileSync(path.join(dataDir, 'characters', `${SLUG}.json`), JSON.stringify({ ...snap, nudges: [] }));
  return { gameDir: game, dataDir, main: 'Testchar-Grimtusk' };
}

test('readCharacter lays fresh live state over the snapshot, resolves the zone, and recomputes nudges', () => {
  const cfg = setupData();
  const file = path.join(cfg.dataDir, 'characters', `${SLUG}.json`);
  const before = fs.readFileSync(file, 'utf8');
  writeLiveFile(cfg.dataDir, SLUG, live({
    seenAt: Math.floor(Date.now() / 1000) - 2,
    map: { uiMapId: 1413, x: 50, y: 60 },
    questsComplete: true,
    quests: [{ id: 791, complete: true, failed: false, objectives: [8] }, { id: 792, complete: false, failed: false, objectives: [0] }],
  }));
  const { snapshot: s } = readCharacter(cfg);
  assert.equal(s.level, 12);
  assert.equal(s.liveMap.zone, 'The Barrens');
  assert.match(liveLine(s), /^Live: L12 45% XP · The Barrens 50\.0\/60\.0 · 1 quest ready to turn in/);
  const kinds = s.nudges.map((n) => n.kind);
  assert.ok(kinds.includes('quests_ready'), JSON.stringify(kinds));
  assert.equal(s.nudges.find((n) => n.kind === 'quests_ready').text, 'Ready to turn in: Carry Your Weight', 'a quest that left the log is not ready');
  assert.ok(kinds.includes('trainer_due'), 'level 12 from live makes a class trainer visit due');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing live is written into the snapshot file');
});

test('readCharacter ignores stale live data and live data older than the SavedVariables', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  let cfg = setupData();
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: nowSec - 121 }));
  assert.equal(readCharacter(cfg).snapshot.level, 11);
  assert.equal(readCharacter(cfg).snapshot.live, undefined);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root);
  cfg = setupData({ mtimeMs: (nowSec + 1) * 1000 });
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: nowSec }));
  assert.equal(readCharacter(cfg).snapshot.level, 11);
});

test('a live file for another tag never touches the main character', () => {
  const cfg = setupData();
  const nowSec = Math.floor(Date.now() / 1000);
  writeLiveFile(cfg.dataDir, `live-${TAG + 1}`, live({ seenAt: nowSec, tag: TAG + 1, level: 40 }));
  assert.equal(readCharacter(cfg).snapshot.level, 11);
  // Even at the main's slug, a file whose tag names another character is ignored.
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: nowSec, tag: TAG + 1, level: 40 }));
  assert.equal(readCharacter(cfg).snapshot.level, 11);
});

test('questsAvailable excludes a quest that left the log and the quests that hang on it', () => {
  // 101 is in the log; 102 (Blacksmithing, only while 101 is in the log) is available.
  const snap = { ...snapshot(), level: 3, completedQuests: [100], skills: [{ name: 'Blacksmithing', rank: 5, kind: 'profession' }],
    quests: [{ id: 101, title: 'Follow Up', complete: true, objectives: [] }] };
  const cfg = setupData({ snap });
  assert.deepEqual(questsAvailable(cfg).list.map((q) => q.id), [102]);
  // Live says 101 left the log (turned in or abandoned): neither 101 nor its child is offered.
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: Math.floor(Date.now() / 1000), level: 3, questsComplete: true, quests: [] }));
  assert.deepEqual(questsAvailable(cfg).list.map((q) => q.id), []);
});

test('writePlan reads the snapshot without live state (plans never carry live values)', () => {
  const cfg = setupData();
  const addonDir = path.join(cfg.gameDir, 'Interface', 'AddOns', 'ForeverLog');
  fs.mkdirSync(addonDir, { recursive: true });
  fs.writeFileSync(path.join(addonDir, 'ForeverLog.toc'), '## Version: 99.0.0\nForeverLog_Plan.lua\n');
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: Math.floor(Date.now() / 1000) }));
  writePlan(cfg, { title: 'Next', character: 'Testchar-Grimtusk', steps: [{ text: 'Train' }] }, { now: NOW });
  const plan = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'plans', fs.readdirSync(path.join(cfg.dataDir, 'plans'))[0]), 'utf8'));
  assert.ok(!plan.nudges.some((n) => /Level 12/.test(n)), JSON.stringify(plan.nudges));
});

test('availableQuests skips unsettled quests and their next-in-chain quest even without prerequisites', async () => {
  const { availableQuests } = await import('../src/questie/available.js');
  const quest = (id, extra = {}) => ({ id, name: `Q${id}`, requiredLevel: 1, questLevel: 3, requiredRaces: 0, requiredClasses: 0,
    startedBy: { npcs: [], objects: [], items: [] }, preQuestGroup: [], preQuestSingle: [], exclusiveTo: [],
    zoneOrSort: 14, nextQuestInChain: 0, parentQuest: 0, requiredSkill: null, requiredMaxLevel: 0, ...extra });
  const quests = { 1: quest(1, { nextQuestInChain: 2 }), 2: quest(2), 3: quest(3) };
  const db = { questIds: () => [1, 2, 3], quest: (id) => quests[id] ?? null, npc: () => null, object: () => null };
  assert.deepEqual(availableQuests(db, { level: 3, raceId: 2, classId: 1 }).map((q) => q.id), [1, 2, 3]);
  assert.deepEqual(availableQuests(db, { level: 3, raceId: 2, classId: 1, unsettled: new Set([1]) }).map((q) => q.id), [3]);
});

test('readCharacter titles live-only quests from Questie by default, and skips the lookup with questTitles: false', { skip: process.getuid?.() === 0 && 'root reads unreadable files' }, () => {
  const cfg = setupData();
  writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: Math.floor(Date.now() / 1000), questsComplete: true,
    quests: [{ id: 102, complete: false, failed: false, objectives: [1] }] }));
  assert.equal(readCharacter(cfg).snapshot.quests.find((q) => q.id === 102).title, 'Smithing Task');
  // A row lookup reads the baked .toc; with it unreadable, only a lookup-free read succeeds.
  fs.chmodSync(path.join(cfg.gameDir, 'Interface', 'AddOns', 'QuestieDB', 'QuestieDB_Forever.toc'), 0o000);
  const s = readCharacter(cfg, undefined, { questTitles: false }).snapshot;
  assert.equal(s.quests.find((q) => q.id === 102).title, 'Quest #102');
  assert.equal(s.liveMap.zone, 'Durotar', 'zone names do not need the .toc');
});

// --- the Questie db is reused across reads in one long-lived process (the overlay) ---

const tocOf = (cfg) => path.join(cfg.gameDir, 'Interface', 'AddOns', 'QuestieDB', 'QuestieDB_Forever.toc');
const liveOnly = (cfg) => writeLiveFile(cfg.dataDir, SLUG, live({ seenAt: Math.floor(Date.now() / 1000), questsComplete: true,
  quests: [{ id: 102, complete: false, failed: false, objectives: [1] }] }));
const title102 = (cfg) => readCharacter(cfg).snapshot.quests.find((q) => q.id === 102).title;

test('readCharacter opens the Questie db once while the .toc is unchanged, and again after it changes', () => {
  const cfg = setupData();
  liveOnly(cfg);
  const toc = tocOf(cfg);
  const T = 1_700_000_000 + Math.floor(Math.random() * 1e6);
  fs.utimesSync(toc, T, T);
  assert.equal(title102(cfg), 'Smithing Task');
  // Same path, size and mtime but other bytes: a reused db never rereads the file.
  fs.writeFileSync(toc, 'x'.repeat(fs.statSync(toc).size));
  fs.utimesSync(toc, T, T);
  assert.equal(title102(cfg), 'Smithing Task', 'the second read reuses the opened db');
  fs.utimesSync(toc, T + 10, T + 10);
  assert.equal(title102(cfg), 'Quest #102', 'a changed mtime reopens the db');
});

test('an unreadable Questie .toc titles a live-only quest by id instead of throwing', { skip: (process.platform === 'win32' && 'chmod cannot make a file unreadable on Windows') || (process.getuid?.() === 0 && 'root reads unreadable files') }, () => {
  const cfg = setupData();
  liveOnly(cfg);
  const toc = tocOf(cfg);
  const T = 1_600_000_000 + Math.floor(Math.random() * 1e6);
  fs.utimesSync(toc, T, T);
  fs.chmodSync(toc, 0o000);
  try {
    assert.equal(title102(cfg), 'Quest #102');
  } finally {
    fs.chmodSync(toc, 0o644);
  }
});

test('the Live line says when the player levelled since the last sync, and only then', () => {
  const s = snapshot();
  assert.match(liveLine(mergeLive(s, live()), { nowSec: NOW }), / · L11 at last sync · /);
  assert.doesNotMatch(liveLine(mergeLive(s, live({ level: 11 })), { nowSec: NOW }), /at last sync/);
});
