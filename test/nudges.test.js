import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNudges, loadClassKnowledge } from '../src/nudges.js';

const warrior = loadClassKnowledge('WARRIOR');
const base = () => ({
  level: 12, classFile: 'WARRIOR', rested: 0,
  talents: { unspent: 0, tabs: [] },
  equipped: {}, bags: [], bagSlotsFree: 9, bagSlotsTotal: 16, quests: [],
});
const trained = [{ seq: 0, kind: 'trainer', data: { level: 12 } }];
const kinds = (n) => n.map((x) => x.kind).sort();
const item = (o) => ({ quality: 2, ilvl: 15, minLevel: 10, stats: {}, ...o });

test('class knowledge file loads with weights and armor types', () => {
  assert.equal(warrior.classFile, 'WARRIOR');
  assert.ok(warrior.statWeights.ITEM_MOD_STRENGTH_SHORT > 0);
  assert.ok(warrior.armor.includes('Mail'));
});

test('unspent talent point nudges', () => {
  const s = { ...base(), talents: { unspent: 1, tabs: [] } };
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), ['talent_points']);
});

test('trainer is due at an even level at least 2 above the last visit', () => {
  const journal = [{ seq: 1, kind: 'trainer', data: { level: 10 } }];
  assert.deepEqual(kinds(computeNudges(base(), { classKnowledge: warrior, journal })), ['trainer_due']);
  assert.deepEqual(kinds(computeNudges({ ...base(), level: 11 }, { classKnowledge: warrior, journal })), []);
  const visited = [...journal, { seq: 2, kind: 'trainer', data: { level: 12 } }];
  assert.deepEqual(kinds(computeNudges(base(), { classKnowledge: warrior, journal: visited })), []);
});

test('better mail chest in bags beats equipped leather and names both items', () => {
  const s = base();
  s.equipped = { 5: item({ name: 'Old Jerkin', subType: 'Leather', equipLoc: 'INVTYPE_CHEST', stats: { ITEM_MOD_STAMINA_SHORT: 1 }, armor: 40 }) };
  s.bags = [{ bag: 0, slot: 3, count: 1, item: item({ name: 'Ringed Vest', subType: 'Mail', equipLoc: 'INVTYPE_CHEST', stats: { ITEM_MOD_STRENGTH_SHORT: 3 }, armor: 90 }) }];
  const n = computeNudges(s, { classKnowledge: warrior, journal: trained });
  assert.deepEqual(kinds(n), ['bag_upgrade']);
  assert.match(n[0].text, /Ringed Vest/);
  assert.match(n[0].text, /Old Jerkin/);
});

test('plate below level 40 and items above the character level are not upgrades', () => {
  const s = base();
  s.level = 21; // odd level keeps trainer_due out of this test
  s.bags = [
    { bag: 0, slot: 1, count: 1, item: item({ name: 'Plate Helm', subType: 'Plate', equipLoc: 'INVTYPE_HEAD', armor: 300 }) },
    { bag: 0, slot: 2, count: 1, item: item({ name: 'Future Helm', subType: 'Mail', equipLoc: 'INVTYPE_HEAD', armor: 200, minLevel: 25 }) },
  ];
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), []);
});

test('nearly full bags nudge', () => {
  assert.deepEqual(kinds(computeNudges({ ...base(), bagSlotsFree: 2 }, { classKnowledge: warrior, journal: trained })), ['bags_full']);
});

test('completed quests in the log nudge with their titles', () => {
  const s = { ...base(), quests: [{ id: 790, title: 'Sarkoth', complete: true }, { id: 791, title: 'Carry Your Weight', complete: false }] };
  const n = computeNudges(s, { classKnowledge: warrior, journal: trained });
  assert.deepEqual(kinds(n), ['quests_ready']);
  assert.match(n[0].text, /Sarkoth/);
  assert.doesNotMatch(n[0].text, /Carry Your Weight/);
});

test('rested XP is reported as information', () => {
  assert.deepEqual(kinds(computeNudges({ ...base(), rested: 1200 }, { classKnowledge: warrior, journal: trained })), ['rested']);
});

test('unknown class still computes non-gear nudges', () => {
  const s = { ...base(), classFile: 'NOPE', bagSlotsFree: 1 };
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: loadClassKnowledge('NOPE'), journal: trained })), ['bags_full']);
});

test('with no trainer visit on record, an even level counts as due', () => {
  assert.deepEqual(kinds(computeNudges(base(), { classKnowledge: warrior, journal: [] })), ['trainer_due']);
});

const twoHander = () => item({ name: 'Big Axe', subType: 'Two-Handed Axes', equipLoc: 'INVTYPE_2HWEAPON', stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 9, ITEM_MOD_STRENGTH_SHORT: 4 } });
const axeSkills = [{ name: 'Axes', kind: 'weapon' }, { name: 'Two-Handed Axes', kind: 'weapon' }, { name: 'Swords', kind: 'weapon' }];

test('review: a weaker one-hander or shield is not an upgrade over an equipped two-hander', () => {
  const s = { ...base(), level: 13, skills: axeSkills, equipped: { 16: twoHander() } };
  s.bags = [
    { bag: 0, slot: 1, count: 1, item: item({ name: 'Trash Sword', subType: 'One-Handed Swords', equipLoc: 'INVTYPE_WEAPON', stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 5 } }) },
    { bag: 0, slot: 2, count: 1, item: item({ name: 'Buckler', subType: 'Shields', equipLoc: 'INVTYPE_SHIELD', armor: 200 }) },
  ];
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), []);
});

test('review: before dual wield, a one-hander only competes for the main hand', () => {
  const s = { ...base(), level: 13, skills: axeSkills,
    equipped: { 16: item({ name: 'Good Axe', subType: 'One-Handed Axes', equipLoc: 'INVTYPE_WEAPON', stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 7 } }) } };
  s.bags = [{ bag: 0, slot: 1, count: 1, item: item({ name: 'Worse Axe', subType: 'One-Handed Axes', equipLoc: 'INVTYPE_WEAPON', stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 5 } }) }];
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), []);
});

test('review: weapons without the weapon skill are not suggested', () => {
  const s = { ...base(), level: 13, skills: axeSkills, equipped: {} };
  s.bags = [{ bag: 0, slot: 1, count: 1, item: item({ name: 'Short Bow', subType: 'Bows', equipLoc: 'INVTYPE_RANGED', stats: { ITEM_MOD_DAMAGE_PER_SECOND_SHORT: 4 } }) }];
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), []);
  s.skills = [...axeSkills, { name: 'Bows', kind: 'weapon' }];
  assert.deepEqual(kinds(computeNudges(s, { classKnowledge: warrior, journal: trained })), ['bag_upgrade']);
});

test('review: a class-trainer visit at an odd level does not hide the next even level', () => {
  const journal = [{ seq: 1, kind: 'trainer', data: { level: 11, kind: 'class' } }];
  assert.deepEqual(kinds(computeNudges(base(), { classKnowledge: warrior, journal })), ['trainer_due']);
});

test('review: a profession-trainer visit does not count as training class skills', () => {
  const journal = [{ seq: 1, kind: 'trainer', data: { level: 12, kind: 'profession' } }];
  assert.deepEqual(kinds(computeNudges(base(), { classKnowledge: warrior, journal })), ['trainer_due']);
});
