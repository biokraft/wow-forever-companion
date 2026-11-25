import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateClassData, readClassData, writeClassData, classDataStatus, classDataLine, classDataText, classDataFile, CLASSDATA_STALE_DAYS } from '../src/classdata.js';

const WARRIOR = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/classdata/warrior.json', import.meta.url)), 'utf8'));
const NOW = Date.UTC(2026, 10, 25, 12);
const cfg = () => ({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fc-classdata-')) });
const hunter = (over = {}) => ({
  classFile: 'HUNTER', checked: '2026-11-25', sources: ['https://example.org/hunter'],
  armor: ['Cloth', 'Leather'], armorFrom40: ['Mail'], weapons: ['Bows', 'Guns'],
  statWeights: { ITEM_MOD_AGILITY_SHORT: 1, armor: 0.01 }, dualWieldLevel: 20, ...over,
});

test('well-formed class data is accepted and comes back trimmed to its fields', () => {
  const r = validateClassData(hunter({ note: '  Agility first.  ' }), { expectedClass: 'HUNTER', nowMs: NOW });
  assert.equal(r.ok, true, r.errors?.join('; '));
  assert.deepEqual(r.data, {
    classFile: 'HUNTER', checked: '2026-11-25', sources: ['https://example.org/hunter'], armor: ['Cloth', 'Leather'], weapons: ['Bows', 'Guns'],
    statWeights: { ITEM_MOD_AGILITY_SHORT: 1, armor: 0.01 }, dualWieldLevel: 20, armorFrom40: ['Mail'], note: 'Agility first.',
  });
  assert.equal(validateClassData(WARRIOR, { expectedClass: 'WARRIOR', nowMs: NOW }).ok, true, 'the test fixture is valid class data');
});

test('every problem is named at once', () => {
  const r = validateClassData({
    classFile: 'hunter pet', checked: 'yesterday', sources: [], armor: 'Mail', weapons: [7, 'x'.repeat(41)],
    statWeights: { STRENGTH: 1, ITEM_MOD_AGILITY_SHORT: -2 }, dualWieldLevel: 99, note: 7, extra: true,
  }, { nowMs: NOW });
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  for (const part of ['extra: unknown field', 'classFile:', 'checked:', 'sources:', 'armor: must be a list', 'weapons[0]', 'weapons[1]', 'statWeights.STRENGTH', 'statWeights.ITEM_MOD_AGILITY_SHORT', 'dualWieldLevel:', 'note:']) {
    assert.ok(all.includes(part), `${part} in:\n${all}`);
  }
});

test('data for another class, from the future, without sources or without any weight is refused', () => {
  const bad = (over, re, opts = {}) => {
    const r = validateClassData(hunter(over), { expectedClass: 'HUNTER', nowMs: NOW, ...opts });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('; '), re);
  };
  bad({ classFile: 'MAGE' }, /this character is a HUNTER, not a MAGE/);
  bad({ checked: '2099-01-01' }, /future/);
  bad({ checked: '2026-02-30' }, /checked/);
  bad({ sources: ['file:///etc/passwd'] }, /http/);
  bad({ statWeights: { ITEM_MOD_AGILITY_SHORT: 0 } }, /above 0/);
  bad({ statWeights: [] }, /statWeights: required/);
  assert.equal(validateClassData('x').ok, false);
});

test('write stores the file per class and read gives it back; nothing is written when refused', () => {
  const c = cfg();
  assert.equal(readClassData(c, 'HUNTER'), null);
  const { file, data } = writeClassData(c, 'HUNTER', hunter(), { nowMs: NOW });
  assert.equal(file, path.join(c.dataDir, 'classdata', 'hunter.json'));
  assert.deepEqual(readClassData(c, 'hunter'), data);
  assert.equal(readClassData(c, 'MAGE'), null);
  assert.throws(() => writeClassData(c, 'MAGE', hunter(), { nowMs: NOW }), /nothing saved.*this character is a MAGE/);
  assert.deepEqual(fs.readdirSync(path.join(c.dataDir, 'classdata')), ['hunter.json'], 'no other file and no temp file left');
});

test('a class name that is not one reaches no file', () => {
  const c = cfg();
  for (const name of ['../x', '', null, 'A', 'HUNTER/..']) {
    assert.equal(classDataFile(c, name), null);
    assert.equal(readClassData(c, name), null);
  }
  assert.throws(() => writeClassData(c, '../x', hunter()), /nothing saved/);
});

test('a damaged or hand-edited file reads as none', () => {
  const c = cfg();
  fs.mkdirSync(path.join(c.dataDir, 'classdata'));
  fs.writeFileSync(path.join(c.dataDir, 'classdata', 'hunter.json'), '{ not json');
  assert.equal(readClassData(c, 'HUNTER'), null);
  fs.writeFileSync(path.join(c.dataDir, 'classdata', 'hunter.json'), JSON.stringify(hunter({ classFile: 'MAGE' })));
  assert.equal(readClassData(c, 'HUNTER'), null);
});

test(`status: none, fresh, and stale after ${CLASSDATA_STALE_DAYS} days; the line tells the agent what to do`, () => {
  const c = cfg();
  assert.deepEqual(classDataStatus(c, 'HUNTER', { nowMs: NOW }), { state: 'none', checked: null, ageDays: null });
  writeClassData(c, 'HUNTER', hunter(), { nowMs: NOW });
  assert.deepEqual(classDataStatus(c, 'HUNTER', { nowMs: NOW }), { state: 'fresh', checked: '2026-11-25', ageDays: 0 });
  const later = classDataStatus(c, 'HUNTER', { nowMs: NOW + (CLASSDATA_STALE_DAYS + 1) * 86400000 });
  assert.equal(later.state, 'stale');
  assert.match(classDataLine('HUNTER', { state: 'none' }), /none for HUNTER yet.*wowf classdata write/);
  assert.match(classDataLine('HUNTER', later), /stale.*wowf classdata write/);
  assert.equal(classDataLine('HUNTER', { state: 'fresh', checked: '2026-11-25', ageDays: 0 }), 'Class data: HUNTER, checked 2026-11-25.');
});

test('the readable form names what the class wears, wields and values, and its sources', () => {
  const t = classDataText(validateClassData(hunter(), { nowMs: NOW }).data);
  assert.match(t, /^Class data for HUNTER \(checked 2026-11-25\)/);
  assert.match(t, /Armor: Cloth, Leather; from level 40: Mail/);
  assert.match(t, /Dual wield: from level 20/);
  assert.match(t, /Stat weights: ITEM_MOD_AGILITY_SHORT 1, armor 0\.01/);
  assert.match(t, /- https:\/\/example\.org\/hunter/);
});
