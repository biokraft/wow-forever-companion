import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hintsData, lazyChats, chatsData, exclusiveSend, gamePlanData } from '../src/ipc-data.js';
import { buildHints, STARTERS } from '../src/hints.js';
import { createChatStore } from '../src/chat-store.js';

const never = (name) => () => assert.fail(`${name} must not be called`);

test('hints without a config are the starters only, and nothing is read', () => {
  const res = hintsData({ safeConfig: () => null, readCharacter: never('readCharacter'), buildHints: never('buildHints'), starters: STARTERS });
  assert.deepEqual(res, { live: [], starters: STARTERS });
});

test('hints when the character cannot be read are the starters only, nothing thrown', () => {
  const readCharacter = () => { throw new Error('No snapshot yet: log in and /reload'); };
  const res = hintsData({ safeConfig: () => ({ dataDir: '/data' }), readCharacter, buildHints, starters: STARTERS });
  assert.deepEqual(res, { live: [], starters: STARTERS });
  // The same when building the hints fails.
  const res2 = hintsData({
    safeConfig: () => ({ dataDir: '/data' }), readCharacter: () => ({ snapshot: {} }),
    buildHints: () => { throw new Error('boom'); }, starters: STARTERS,
  });
  assert.deepEqual(res2, { live: [], starters: STARTERS });
});

test('hints are built from the merged snapshot against the synced one', () => {
  const cfg = { dataDir: '/data' };
  const calls = [];
  const readCharacter = (c, name, opts) => {
    calls.push([c, name, opts]);
    return { snapshot: { which: opts?.live === false ? 'synced' : 'merged' } };
  };
  const res = hintsData({
    safeConfig: () => cfg, readCharacter, starters: ['s'],
    buildHints: ({ merged, synced }) => [`${merged.which}/${synced.which}`],
  });
  assert.deepEqual(res, { live: ['merged/synced'], starters: ['s'] });
  assert.deepEqual(calls, [[cfg, undefined, undefined], [cfg, undefined, { live: false }]]);
});

test('the update notice reaches the hints, also when the character cannot be read', () => {
  const update = { latest: '0.4.1', newer: true };
  const s = { level: 10, nudges: [{ kind: 'rested', short: 'rested', text: 'rested' }] };
  const ok = hintsData({ safeConfig: () => ({ dataDir: '/data' }), readCharacter: () => ({ snapshot: s }), buildHints, starters: STARTERS, update });
  assert.deepEqual(ok.live.map((h) => h.kind), ['update', 'rested']);
  const unread = hintsData({
    safeConfig: () => ({ dataDir: '/data' }), readCharacter: () => { throw new Error('No snapshot yet'); }, buildHints, starters: STARTERS, update,
  });
  assert.deepEqual(unread, { live: [buildHints({ merged: null, update })[0]], starters: STARTERS });
  assert.equal(unread.live[0].kind, 'update');
});

test('without a config there are no chats, and nothing is created', () => {
  const getChats = lazyChats({ safeConfig: () => null, make: never('make') });
  assert.equal(getChats(), null);
  assert.deepEqual(chatsData({ getChats }), { items: [], openId: null });
  // A config without a data folder counts as none.
  const noDir = lazyChats({ safeConfig: () => ({ main: 'Thrall' }), make: never('make') });
  assert.deepEqual(chatsData({ getChats: noDir }), { items: [], openId: null });
});

test('the chat parts are made once, when a config first exists', () => {
  let cfg = null;
  let made = 0;
  const getChats = lazyChats({ safeConfig: () => cfg, make: (c) => ({ n: ++made, cfg: c }) });
  assert.equal(getChats(), null);
  cfg = { dataDir: '/data', main: 'Thrall' };
  const parts = getChats();
  assert.deepEqual(parts, { n: 1, cfg });
  cfg = { dataDir: '/other', main: 'Jaina' };
  assert.equal(getChats(), parts);
  assert.equal(made, 1);
});

test('chats lists the saved chats of the character, newest first, and names the open one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-ipc-'));
  let t = 1000;
  const store = createChatStore({ dir, now: () => t++ });
  const a = { ...store.newChat({ character: 'Thrall', backend: 'pi' }), id: '20260101-000000-aaaa', title: 'A' };
  const b = { ...store.newChat({ character: 'Thrall', backend: 'pi' }), id: '20260101-000000-bbbb', title: 'B' };
  const j = { ...store.newChat({ character: 'Jaina', backend: 'pi' }), id: '20260101-000000-jjjj', title: 'J' };
  for (const c of [a, j, b]) store.save(c);
  const session = { current: () => b };
  const res = chatsData({ getChats: () => ({ session, store, character: 'Thrall' }) });
  assert.deepEqual(res.items.map((x) => x.id), [b.id, a.id]);
  assert.equal(res.openId, b.id);
});

// ---- One answer at a time ----

test('a send while another is being answered is refused and changes nothing', async () => {
  const state = { answering: false };
  let release;
  let runs = 0;
  const first = exclusiveSend(state, async () => {
    runs++;
    await new Promise((r) => { release = r; });
    return { ok: true, answer: 'one' };
  });
  assert.equal(state.answering, true);
  const second = await exclusiveSend(state, async () => { runs++; return { ok: true, answer: 'two' }; });
  assert.deepEqual(second, { ok: false, error: 'Still answering the previous message' });
  assert.equal(runs, 1, 'the second question never ran');
  assert.equal(state.answering, true, 'the refusal leaves the flag to the running answer');
  release();
  assert.deepEqual(await first, { ok: true, answer: 'one' });
  assert.equal(state.answering, false);
  assert.deepEqual(await exclusiveSend(state, async () => ({ ok: true, answer: 'three' })), { ok: true, answer: 'three' });
});

test('the answering flag is cleared when the answer fails', async () => {
  const state = { answering: false };
  await assert.rejects(exclusiveSend(state, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(state.answering, false);
});

// ---- The game plan page ----

test('game plan data without a config or a snapshot says so and reads nothing more', () => {
  const none = { hasSnapshot: false, planChat: false, plan: null, level: null, introSeen: false, folds: {} };
  assert.deepEqual(gamePlanData({ safeConfig: () => null, readCharacter: never('readCharacter'), characterSlug: never('characterSlug') }), none);
  const cfg = { dataDir: '/data', overlay: { planFolds: { goal: false } } };
  const res = gamePlanData({ safeConfig: () => cfg, readCharacter: () => { throw new Error('No synced data'); }, characterSlug: () => 'realm-thrall' });
  assert.deepEqual(res, { ...none, folds: { goal: false } });
});

test('game plan data carries the plan, the live level, the intro flag of this character and the folds', () => {
  const plan = { summary: 'S', goal: 'G' };
  const calls = [];
  const cfg = { dataDir: '/data', overlay: { planIntroSeen: { 'realm-thrall': true, 'realm-jaina': true }, planFolds: { card: false, junk: 'x' } } };
  const res = gamePlanData({
    safeConfig: () => cfg,
    readCharacter: (c, name, opts) => { calls.push(opts); return { snapshot: { level: 23, gamePlan: plan } }; },
    characterSlug: () => 'realm-thrall',
  });
  assert.deepEqual(res, { hasSnapshot: true, planChat: true, plan, level: 23, introSeen: true, folds: { card: false } });
  assert.deepEqual(calls, [{ questTitles: false }]);
  const fresh = gamePlanData({
    safeConfig: () => ({ dataDir: '/data' }),
    readCharacter: () => ({ snapshot: { level: 'x' } }),
    characterSlug: () => 'realm-thrall',
  });
  assert.deepEqual(fresh, { hasSnapshot: true, planChat: true, plan: null, level: null, introSeen: false, folds: {} });
});

test('game plan data says when the character name gives no plan chat (slug "realm-")', () => {
  const res = gamePlanData({
    safeConfig: () => ({ dataDir: '/data', overlay: { planIntroSeen: { 'realm-': true } } }),
    readCharacter: () => ({ snapshot: { level: 5, gamePlan: null } }),
    characterSlug: () => 'realm-',
  });
  assert.deepEqual(res, { hasSnapshot: true, planChat: false, plan: null, level: 5, introSeen: false, folds: {} });
});
