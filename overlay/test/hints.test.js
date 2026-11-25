import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHints, STARTERS, MAX_ROWS, MAX_CHIPS } from '../src/hints.js';
import { visibleHints } from '../src/hint-view.js';

const nudge = (kind, extra = {}) => ({ kind, short: kind.replace('_', ' '), text: `text of ${kind}`, ...extra });
const snap = (o = {}) => ({ level: 10, nudges: [], quests: [], talents: { unspent: 0 }, ...o });

test('hints come in priority order with prepared questions', () => {
  const s = snap({
    quests: [{ id: 12, title: 'A', complete: true }],
    talents: { unspent: 1 },
    nudges: [nudge('rested'), nudge('talent_points'), nudge('quests_ready', { short: 'turn-ins ready' })],
  });
  const hints = buildHints({ merged: s, synced: s });
  assert.deepEqual(hints.map((h) => h.kind), ['quests_ready', 'talent_points', 'rested']);
  assert.equal(hints[0].prompt, 'Which quests can I turn in now, where, and in what order?');
  assert.equal(hints[1].prompt, 'Where should I spend my unspent talent point(s)?');
  assert.equal(hints[2].prompt, 'I have rested XP. How do I use it best right now?');
  assert.equal(hints[1].text, 'text of talent_points');
});

test('quests_ready label counts complete quests', () => {
  const s = snap({
    quests: [{ id: 40, title: 'B', complete: true }, { id: 12, title: 'A', complete: true }, { id: 77, title: 'C', complete: false }],
    nudges: [nudge('quests_ready', { short: 'turn-ins ready' })],
  });
  const [h] = buildHints({ merged: s, synced: s });
  assert.equal(h.label, '2 turn-ins ready');
  assert.equal(h.key, 'quests_ready:12,40');
});

test('quests_ready falls back to short and plain key without quests', () => {
  const s = { level: 10, nudges: [nudge('quests_ready', { short: 'turn-ins ready' })] };
  const [h] = buildHints({ merged: s, synced: s });
  assert.equal(h.label, 'turn-ins ready');
  assert.equal(h.key, 'quests_ready');
});

test('level_up shows when live level is above the synced one and hides talent_points', () => {
  const synced = snap({ level: 10, talents: { unspent: 1 }, nudges: [nudge('talent_points'), nudge('trainer_due')] });
  const merged = { ...synced, level: 11 };
  const hints = buildHints({ merged, synced });
  const up = hints.find((h) => h.kind === 'level_up');
  assert.ok(up);
  assert.equal(up.label, 'Level 11!');
  assert.equal(up.text, 'You reached level 11');
  assert.equal(up.key, 'level_up:11');
  assert.equal(up.prompt, 'I just reached level 11. What should I do now: talents, trainer, new quests?');
  assert.equal(hints.some((h) => h.kind === 'talent_points'), false);
  assert.ok(hints.some((h) => h.kind === 'trainer_due'));
});

test('no level_up when levels match', () => {
  const s = snap({ nudges: [nudge('talent_points')] });
  const hints = buildHints({ merged: s, synced: { ...s } });
  assert.equal(hints.some((h) => h.kind === 'level_up'), false);
  assert.ok(hints.some((h) => h.kind === 'talent_points'));
});

test('a dismissed key is left out and returns when the state changes', () => {
  const mk = (ids) => snap({
    quests: ids.map((id) => ({ id, title: `q${id}`, complete: true })),
    nudges: [nudge('quests_ready', { short: 'turn-ins ready' })],
  });
  const dismissed = new Set(['quests_ready:12,40']);
  const before = mk([12, 40]);
  assert.deepEqual(buildHints({ merged: before, synced: before, dismissed }), []);
  const after = mk([12, 40, 77]);
  const hints = buildHints({ merged: after, synced: after, dismissed });
  assert.equal(hints.length, 1);
  assert.equal(hints[0].key, 'quests_ready:12,40,77');
});

test('several bag upgrades give one hint each with the item name in the prompt', () => {
  const s = snap({
    nudges: [
      nudge('bag_upgrade', { itemId: 5, slot: 1, text: 'Iron Helm looks better than Cap (score +3.0)' }),
      nudge('bag_upgrade', { itemId: 9, slot: 8, text: 'Fast Boots looks better than an empty slot (score +1.5)' }),
    ],
  });
  const hints = buildHints({ merged: s, synced: s });
  assert.deepEqual(hints.map((h) => h.key), ['bag_upgrade:5', 'bag_upgrade:9']);
  assert.equal(hints[0].prompt, 'Is Iron Helm in my bags an upgrade? Should I equip it?');
  assert.equal(hints[1].prompt, 'Is Fast Boots in my bags an upgrade? Should I equip it?');
});

test('missing snapshot or nudges gives an empty list', () => {
  assert.deepEqual(buildHints({ merged: null }), []);
  assert.deepEqual(buildHints({ merged: null, synced: null }), []);
  assert.deepEqual(buildHints({ merged: { level: 5 }, synced: { level: 5 } }), []);
});

test('unknown nudge kinds are ignored', () => {
  const s = snap({ nudges: [nudge('mystery'), nudge('bags_full')] });
  const hints = buildHints({ merged: s, synced: s });
  assert.deepEqual(hints.map((h) => h.kind), ['bags_full']);
  assert.equal(hints[0].key, 'bags_full');
  assert.equal(hints[0].prompt, 'My bags are nearly full. What can I sell or drop?');
});

test('talent and trainer keys carry the state they depend on', () => {
  const s = snap({ level: 12, talents: { unspent: 2 }, nudges: [nudge('talent_points'), nudge('trainer_due')] });
  const hints = buildHints({ merged: s, synced: s });
  assert.deepEqual(hints.map((h) => h.key), ['talent_points:2', 'trainer_due:12']);
  assert.equal(hints[1].prompt, 'What should I train at my class trainer now, and where is the nearest one?');
});

test('starters and limits', () => {
  assert.deepEqual(STARTERS, [
    { label: 'What next?', prompt: 'What should I do next?' },
    { label: 'Plan my route', prompt: 'Plan my route for this zone' },
    { label: 'Professions', prompt: 'What is my next profession step?' },
  ]);
  assert.equal(MAX_ROWS, 4);
  assert.equal(MAX_CHIPS, 3);
});

// ---- The new-version notice ----

const UPDATE = { key: 'update', kind: 'update', label: '0.4.1 is out', text: 'run: node bin/wowf update', prompt: null, command: 'node bin/wowf update' };

test('a newer release puts the update hint first, ahead of every nudge', () => {
  const s = snap({ quests: [{ id: 12, title: 'A', complete: true }], nudges: [nudge('quests_ready', { short: 'turn-ins ready' })] });
  const hints = buildHints({ merged: s, synced: s, update: { latest: '0.4.1', newer: true } });
  assert.deepEqual(hints[0], UPDATE);
  assert.deepEqual(hints.map((h) => h.kind), ['update', 'quests_ready']);
});

test('the update hint shows even without a snapshot', () => {
  assert.deepEqual(buildHints({ merged: null, update: { latest: '0.4.1', newer: true } }), [UPDATE]);
});

test('no update hint when nothing newer is known', () => {
  const s = snap({ nudges: [nudge('rested')] });
  for (const update of [undefined, null, { latest: '0.4.1', newer: false }, { latest: null, newer: false }]) {
    assert.deepEqual(buildHints({ merged: s, synced: s, update }).map((h) => h.kind), ['rested']);
  }
});

test('the update hint takes no row, chip or starter slot from the chat hints', () => {
  const s = snap({ nudges: ['quests_ready', 'talent_points', 'trainer_due', 'bags_full', 'rested'].map((k) => nudge(k)) });
  const live = buildHints({ merged: s, synced: s, update: { latest: '0.4.1', newer: true } });
  const empty = visibleHints({ live, starters: STARTERS, empty: true });
  assert.deepEqual(empty.rows[0], UPDATE);
  assert.equal(empty.rows.length, 1 + MAX_ROWS);
  assert.deepEqual(empty.starters, STARTERS);
  const mid = visibleHints({ live, starters: STARTERS, empty: false });
  assert.deepEqual(mid.chips[0], UPDATE);
  assert.equal(mid.chips.length, 1 + MAX_CHIPS);
});

// ---- The game plan hint ----

const PLAN_HINT = { key: 'gameplan', kind: 'gameplan', label: 'Set up your game plan', text: 'Opens the Plan page', prompt: null, action: 'open-plan' };

test('without a game plan a "Set up your game plan" hint opens the plan page and sends nothing', () => {
  const s = snap({ gamePlan: null, nudges: [nudge('rested')] });
  const hints = buildHints({ merged: s, synced: s, update: { latest: '0.4.1', newer: true } });
  assert.deepEqual(hints.map((h) => h.kind), ['update', 'gameplan', 'rested']);
  assert.deepEqual(hints[1], PLAN_HINT);
});

test('no game plan hint once a plan exists, or when it is not known', () => {
  const withPlan = snap({ gamePlan: { summary: 'S', goal: 'G' }, nudges: [nudge('rested')] });
  assert.deepEqual(buildHints({ merged: withPlan, synced: withPlan }).map((h) => h.kind), ['rested']);
  const unknown = snap({ nudges: [nudge('rested')] });
  assert.deepEqual(buildHints({ merged: unknown, synced: unknown }).map((h) => h.kind), ['rested']);
  assert.deepEqual(buildHints({ merged: null }), []);
});

test('the game plan hint is never dismissed and takes no chat hint slot', () => {
  const s = snap({ gamePlan: null, nudges: ['quests_ready', 'talent_points', 'trainer_due', 'bags_full', 'rested'].map((k) => nudge(k)) });
  const live = buildHints({ merged: s, synced: s, dismissed: new Set(['gameplan']) });
  assert.equal(live[0].key, 'gameplan');
  const mid = visibleHints({ live, starters: STARTERS, empty: false });
  assert.equal(mid.chips[0].key, 'gameplan');
  assert.equal(mid.chips.length, 1 + MAX_CHIPS);
});

// ---- The hotkey notice: the key that opens the chat could not be taken ----

test('a hotkey another app holds is said in a notice, after the update notice', () => {
  const HOTKEY = { key: 'hotkey', kind: 'hotkey', label: 'Alt+Space does not open the chat', text: 'another app uses that key; set "overlay.hotkey" in the config to another one, or click the round button', prompt: null };
  assert.deepEqual(buildHints({ merged: null, hotkey: { key: 'Alt+Space', ok: false } }), [HOTKEY]);
  const both = buildHints({ merged: null, update: { latest: '0.4.1', newer: true }, hotkey: { key: 'Alt+Space', ok: false } });
  assert.deepEqual(both.map((h) => h.kind), ['update', 'hotkey']);
});

test('no hotkey notice while the key works or nothing is known', () => {
  for (const hotkey of [undefined, null, { key: 'Alt+Space', ok: true }, { ok: false }]) {
    assert.deepEqual(buildHints({ merged: null, hotkey }), []);
  }
});
