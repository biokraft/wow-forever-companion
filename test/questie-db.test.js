import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFakeQuestie } from './helpers/questie-fixture.js';
import { openQuestieDb } from '../src/questie/db.js';
import { readTocMetadata } from '../src/questie/toc.js';

let addonsDir;
before(() => {
  addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-questie-'));
  writeFakeQuestie(addonsDir);
});
after(() => fs.rmSync(addonsDir, { recursive: true, force: true }));

test('readTocMetadata reassembles chunked values', () => {
  const meta = readTocMetadata(path.join(addonsDir, 'QuestieDB', 'QuestieDB_Forever.toc'));
  assert.ok(meta.get('X-Quest-IDS').length > 4);
  assert.ok(!meta.get('X-Quest-IDS').startsWith('~'));
});

test('openQuestieDb returns null when QuestieDB is not installed', () => {
  assert.equal(openQuestieDb(path.join(addonsDir, 'nope')), null);
});

test('questIds lists all baked quest ids', () => {
  assert.deepEqual(openQuestieDb(addonsDir).questIds(), [100, 101, 102]);
});

test('quest decodes scalar fields and present table fields', () => {
  const q = openQuestieDb(addonsDir).quest(100);
  assert.equal(q.name, 'Test Quest');
  assert.equal(q.requiredLevel, 1);
  assert.equal(q.questLevel, 2);
  assert.equal(q.requiredRaces, 178);
  assert.equal(q.requiredClasses, 0);
  assert.equal(q.zoneOrSort, 14);
  assert.deepEqual(q.startedBy, { npcs: [500], objects: [], items: [] });
  assert.deepEqual(q.finishedBy, { npcs: [500], objects: [] });
  assert.deepEqual(q.preQuestSingle, []);
});

test('quest reads prerequisite lists only when the presence bit is set', () => {
  const q = openQuestieDb(addonsDir).quest(101);
  assert.deepEqual(q.preQuestSingle, [100]);
  assert.deepEqual(q.preQuestGroup, []);
  assert.equal(q.requiredClasses, 1);
});

test('npc decodes name, zone and spawns', () => {
  const n = openQuestieDb(addonsDir).npc(500);
  assert.equal(n.name, 'Test Giver');
  assert.equal(n.title, 'Weapon Master');
  assert.equal(n.zoneId, 14);
  assert.deepEqual(n.spawns['14'][0], [50.1, 60.2]);
});

test('object decodes name and zone', () => {
  assert.deepEqual(openQuestieDb(addonsDir).object(700), { id: 700, name: 'Test Chest', zoneId: 14 });
});

test('unknown ids return null', () => {
  const db = openQuestieDb(addonsDir);
  assert.equal(db.quest(999), null);
  assert.equal(db.npc(999), null);
});

test('zoneName maps area ids to readable names from the zone enum', () => {
  const db = openQuestieDb(addonsDir);
  assert.equal(db.zoneName(14), 'Durotar');
  assert.equal(db.zoneName(17), 'The Barrens');
  assert.equal(db.zoneName(1519), 'Stormwind City');
  assert.equal(db.zoneName(999), null);
});

test('uiMapId maps area ids to in-game map ids; zoneIdByName is case-insensitive', () => {
  const db = openQuestieDb(addonsDir);
  assert.equal(db.uiMapId(14), 1411);
  assert.equal(db.uiMapId(999), null);
  assert.equal(db.zoneIdByName('durotar'), 14);
  assert.equal(db.zoneIdByName('The Barrens'), 17);
  assert.equal(db.zoneIdByName('Nowhere'), null);
});

test('findNpcs matches names case-insensitively and returns places', () => {
  const db = openQuestieDb(addonsDir);
  assert.deepEqual(db.findNpcs('test giver').map((n) => n.id), [500]);
  assert.deepEqual(db.findNpcs('giver').map((n) => n.id), [500]);
  assert.deepEqual(db.findNpcs('nobody'), []);
});
