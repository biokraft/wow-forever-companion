import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableQuests } from '../src/questie/available.js';

const HORDE = 178; // Orc, Undead, Tauren, Troll
const ALLIANCE = 77;
const q = (id, o = {}) => ({ id, name: `Q${id}`, requiredLevel: 1, questLevel: 10, requiredRaces: 0, requiredClasses: 0,
  startedBy: { npcs: [500], objects: [], items: [] }, finishedBy: { npcs: [500], objects: [] },
  preQuestGroup: [], preQuestSingle: [], exclusiveTo: [], zoneOrSort: 14, requiredMaxLevel: 0, ...o });

function fakeDb(quests) {
  const byId = new Map(quests.map((x) => [x.id, x]));
  return {
    questIds: () => [...byId.keys()],
    quest: (id) => byId.get(id) ?? null,
    npc: (id) => (id === 500 ? { id, name: 'Giver', zoneId: 14, spawns: { 14: [[51.2, 42.1]] } } : null),
    object: () => null,
  };
}

const troll = { level: 10, raceId: 8, classId: 1, completed: new Set(), inLog: new Set() };
const ids = (list) => list.map((x) => x.id);

test('faction-restricted quests are excluded for the wrong race', () => {
  const db = fakeDb([q(1, { requiredRaces: ALLIANCE }), q(2, { requiredRaces: HORDE }), q(3, { requiredRaces: 8589934770 })]);
  assert.deepEqual(ids(availableQuests(db, troll)), [2, 3]);
});

test('class-restricted quests follow the class bitmask', () => {
  const db = fakeDb([q(1, { requiredClasses: 1 })]);
  assert.deepEqual(ids(availableQuests(db, troll)), [1]);
  assert.deepEqual(ids(availableQuests(db, { ...troll, classId: 3 })), []);
});

test('preQuestSingle needs any one prerequisite completed', () => {
  const db = fakeDb([q(1, { preQuestSingle: [7, 8] })]);
  assert.deepEqual(ids(availableQuests(db, troll)), []);
  assert.deepEqual(ids(availableQuests(db, { ...troll, completed: new Set([8]) })), [1]);
});

test('preQuestGroup needs every prerequisite completed', () => {
  const db = fakeDb([q(1, { preQuestGroup: [7, 8] })]);
  assert.deepEqual(ids(availableQuests(db, { ...troll, completed: new Set([8]) })), []);
  assert.deepEqual(ids(availableQuests(db, { ...troll, completed: new Set([7, 8]) })), [1]);
});

test('completed, in-log and exclusive quests are excluded', () => {
  const db = fakeDb([q(1), q(2), q(3, { exclusiveTo: [9] })]);
  const r = availableQuests(db, { ...troll, completed: new Set([1, 9]), inLog: new Set([2]) });
  assert.deepEqual(ids(r), []);
});

test('level rules: required level, max level and the quest level band', () => {
  const db = fakeDb([q(1, { requiredLevel: 11 }), q(2, { requiredMaxLevel: 9 }), q(3, { questLevel: 6 }), q(4, { questLevel: 14 }), q(5, { questLevel: 7 })]);
  assert.deepEqual(ids(availableQuests(db, troll)), [5]);
  assert.deepEqual(ids(availableQuests(db, { ...troll, band: [5, 14] })), [3, 5, 4]);
});

test('start location resolves from the giver NPC and zone filter applies', () => {
  const db = fakeDb([q(1)]);
  const [one] = availableQuests(db, troll);
  assert.deepEqual(one.start, { kind: 'npc', id: 500, name: 'Giver', zoneId: 14, x: 51.2, y: 42.1 });
  assert.equal(one.zoneId, 14);
  assert.deepEqual(ids(availableQuests(db, { ...troll, zoneIds: [17] })), []);
});

test('profession quests need that profession at the required rank', () => {
  const db = fakeDb([q(1, { requiredSkill: [164, 1] }), q(2, { requiredSkill: [186, 50] }), q(3)]);
  const miner = [{ name: 'Mining', rank: 4, id: 2946, kind: 'profession' }];
  assert.deepEqual(ids(availableQuests(db, { ...troll, skills: miner })), [3]);
  assert.deepEqual(ids(availableQuests(db, { ...troll, skills: [{ name: 'Blacksmithing', rank: 1 }, { name: 'Mining', rank: 50 }] })), [1, 2, 3]);
});

test('without skill data the profession filter is skipped', () => {
  const db = fakeDb([q(1, { requiredSkill: [164, 1] })]);
  assert.deepEqual(ids(availableQuests(db, troll)), [1]);
});

test('a child quest is offered only while its parent quest is in the log', () => {
  const db = fakeDb([q(1, { parentQuest: 9 })]);
  assert.deepEqual(ids(availableQuests(db, troll)), []);
  assert.deepEqual(ids(availableQuests(db, { ...troll, inLog: new Set([9]) })), [1]);
});
