import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npcPlace } from '../src/questie/place.js';

const db = { zoneName: (id) => ({ 14: 'Durotar' })[id] ?? null };

test('npcPlace shows zone and first spawn coordinates', () => {
  assert.equal(npcPlace(db, { name: 'Gornek', zoneId: 14, spawns: { 14: [[42.06, 68.33]] } }), 'Gornek (Durotar 42.1, 68.3)');
});

test('npcPlace falls back to the first spawn zone when zoneId is missing', () => {
  assert.equal(npcPlace(db, { name: 'Brakk', zoneId: 0, spawns: { 14: [[52, 47.3]] } }), 'Brakk (Durotar 52.0, 47.3)');
});

test('npcPlace says location unknown when the NPC has no spawns', () => {
  assert.equal(npcPlace(db, { name: 'Varng', zoneId: 0, spawns: {} }), 'Varng (location unknown)');
});

test('npcPlace shows the NPC title when Questie has one', () => {
  assert.equal(npcPlace(db, { name: 'Hanashi', title: 'Weapon Master', zoneId: 14, spawns: { 14: [[81.5, 19.6]] } }), 'Hanashi <Weapon Master> (Durotar 81.5, 19.6)');
});
