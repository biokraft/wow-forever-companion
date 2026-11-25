import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlan, resolveWaypoints, planToLua, luaString } from '../src/plan.js';
import { parseSavedVariables } from '../src/lua/parse.js';
import { openQuestieDb } from '../src/questie/db.js';
import { writeFakeQuestie } from './helpers/questie-fixture.js';

let addonsDir, db;
before(() => {
  addonsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-plan-'));
  writeFakeQuestie(addonsDir);
  db = openQuestieDb(addonsDir);
});
after(() => fs.rmSync(addonsDir, { recursive: true, force: true }));

const step = (o = {}) => ({ text: 'Turn in Carry Your Weight', ...o });

test('a valid plan passes without errors', () => {
  const { plan, errors } = validatePlan({ title: 'Razor Hill loop', steps: [step({ done: { type: 'quest_turnin', id: 791 } })] });
  assert.deepEqual(errors, []);
  assert.equal(plan.title, 'Razor Hill loop');
  assert.deepEqual(plan.steps[0].done, { type: 'quest_turnin', id: 791 });
});

test('more than 12 steps are cut to 12 with a warning', () => {
  const { plan, warnings } = validatePlan({ steps: Array.from({ length: 13 }, (_, i) => step({ text: `s${i}` })) });
  assert.equal(plan.steps.length, 12);
  assert.ok(warnings.some((w) => /12/.test(w)));
});

test('long text and title are truncated with a warning', () => {
  const { plan, warnings } = validatePlan({ title: 't'.repeat(80), steps: [step({ text: 'x'.repeat(200) })] });
  assert.equal(plan.steps[0].text.length, 120);
  assert.equal(plan.title.length, 60);
  assert.ok(warnings.length >= 2);
});

test('missing steps is an error', () => {
  assert.ok(validatePlan({ title: 'x' }).errors.length > 0);
  assert.ok(validatePlan('nope').errors.length > 0);
  assert.ok(validatePlan({ steps: [{ text: '' }] }).errors.length > 0);
});

test('unknown done types are dropped with a warning; known ones keep their fields', () => {
  const { plan, warnings } = validatePlan({ steps: [
    step({ done: { type: 'teleport', id: 1 } }),
    step({ done: { type: 'level', level: 8 } }),
    step({ done: { type: 'skill', name: 'Mining', rank: 50 } }),
    step({ done: { type: 'equip', itemId: 2387 } }),
    step({ done: { type: 'quest_accept', id: 806 } }),
  ] });
  assert.equal(plan.steps[0].done, undefined);
  assert.ok(warnings.some((w) => /teleport/.test(w)));
  assert.deepEqual(plan.steps.slice(1).map((s) => s.done.type), ['level', 'skill', 'equip', 'quest_accept']);
});

test('luaString escapes quotes, backslashes, newlines and UI escape codes', () => {
  assert.equal(luaString('a"b\\c\n|cffff0000x'), '"a\\"b\\\\c\\n||cffff0000x"');
});

test('zone waypoints resolve to map id and 0..1 coordinates', () => {
  const { plan } = validatePlan({ steps: [step({ waypoint: { zone: 'Durotar', x: 49.9, y: 40.4 } })] });
  const { plan: resolved, warnings } = resolveWaypoints(plan, db);
  assert.deepEqual(resolved.steps[0].waypoint, { mapId: 1411, x: 0.499, y: 0.404, label: 'Durotar 49.9, 40.4' });
  assert.deepEqual(warnings, []);
});

test('waypoints given as area id or map id also resolve', () => {
  const { plan } = validatePlan({ steps: [step({ waypoint: { zone: 14, x: 10, y: 20 } }), step({ waypoint: { mapId: 1413, x: 50, y: 50 } })] });
  const { plan: r } = resolveWaypoints(plan, db);
  assert.equal(r.steps[0].waypoint.mapId, 1411);
  assert.equal(r.steps[1].waypoint.mapId, 1413);
  assert.equal(r.steps[1].waypoint.x, 0.5);
});

test('unknown zone drops the waypoint with a warning; no database drops all with one warning', () => {
  const { plan } = validatePlan({ steps: [step({ waypoint: { zone: 'Nowhere', x: 1, y: 1 } }), step({ waypoint: { zone: 'Durotar', x: 1, y: 1 } })] });
  const a = resolveWaypoints(plan, db);
  assert.equal(a.plan.steps[0].waypoint, undefined);
  assert.ok(a.warnings.some((w) => /Nowhere/.test(w)));
  const b = resolveWaypoints(plan, null);
  assert.ok(b.plan.steps.every((s) => s.waypoint === undefined));
  assert.equal(b.warnings.length, 1);
});

test('planToLua output parses back to the same plan', () => {
  const { plan } = validatePlan({ title: 'Loop "one"', steps: [step({ text: 'Say "hi"\nthen |cffgo', done: { type: 'level', level: 8 }, waypoint: { zone: 'Durotar', x: 49.9, y: 40.4 } })] });
  const { plan: r } = resolveWaypoints(plan, db);
  const lua = planToLua(r, { generatedAt: 1795603000, characterName: 'Testa', nudges: ['Ready to turn in: Sarkoth'] });
  const { ForeverLogPlan } = parseSavedVariables(lua);
  assert.equal(ForeverLogPlan.version, 1);
  assert.equal(ForeverLogPlan.generatedAt, 1795603000);
  assert.equal(ForeverLogPlan.characterName, 'Testa');
  assert.equal(ForeverLogPlan.title, 'Loop "one"');
  assert.equal(ForeverLogPlan.steps[0].text, 'Say "hi"\nthen ||cffgo');
  assert.deepEqual(ForeverLogPlan.steps[0].done, { type: 'level', level: 8 });
  assert.equal(ForeverLogPlan.steps[0].waypoint.mapId, 1411);
  assert.deepEqual(ForeverLogPlan.nudges, ['Ready to turn in: Sarkoth']);
});

test('more than 8 nudges are cut to 8', () => {
  const { plan } = validatePlan({ steps: [step()] });
  const lua = planToLua(plan, { generatedAt: 1, characterName: 'Testa', nudges: Array.from({ length: 10 }, (_, i) => `n${i}`) });
  assert.equal(parseSavedVariables(lua).ForeverLogPlan.nudges.length, 8);
});

test('review: mapId must be a positive integer, otherwise the waypoint is dropped', () => {
  const deep = JSON.parse('['.repeat(300) + ']'.repeat(300));
  for (const mapId of [deep, '1411', { ']] os.exit()': '"' }, -3, 1.5]) {
    const { plan, warnings } = validatePlan({ steps: [step({ waypoint: { mapId, x: 1, y: 1 } })] });
    assert.equal(plan.steps[0].waypoint, undefined, JSON.stringify(mapId).slice(0, 20));
    assert.ok(warnings.length > 0);
  }
});

test('review: mapId waypoints are kept even without QuestieDB', () => {
  const { plan } = validatePlan({ steps: [step({ waypoint: { mapId: 1411, x: 50, y: 50 } })] });
  assert.equal(resolveWaypoints(plan, null).plan.steps[0].waypoint.mapId, 1411);
});

test('review: prototype names as done types are rejected cleanly', () => {
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const { plan, warnings } = validatePlan({ steps: [step({ done: { type } })] });
    assert.equal(plan.steps[0].done, undefined);
    assert.ok(warnings.length > 0);
  }
});
