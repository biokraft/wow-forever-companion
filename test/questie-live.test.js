// Runs only against a real install: WOWF_QUESTIE_DIR=<.../Interface/AddOns> node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openQuestieDb } from '../src/questie/db.js';

const dir = process.env.WOWF_QUESTIE_DIR;

test('real QuestieDB: Durotar starter quest and its giver decode', { skip: !dir && 'WOWF_QUESTIE_DIR not set' }, () => {
  const db = openQuestieDb(dir);
  const q = db.quest(4641);
  assert.equal(q.name, 'Your Place In The World');
  assert.equal(q.requiredLevel, 1);
  assert.deepEqual(q.finishedBy.npcs, [3143]);
  const gornek = db.npc(3143);
  assert.equal(gornek.name, 'Gornek');
  assert.ok(gornek.spawns['14'].length > 0);
  assert.ok(db.questIds().length > 1000);
});
