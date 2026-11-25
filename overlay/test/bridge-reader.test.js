import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSavedVariables } from '../../src/lua/parse.js';
import { encodeFrame, decodeFrame, packCore, packQuests, questDigest, characterTag } from '../../src/bridge/codec.js';
import {
  readStrip, decodeStrip, createAssembler, createLiveWriter, createSlugResolver, createLiveReader,
  scheduleReads, liveStatusLine, plausibleFrame, stripRowCount, HEARTBEAT_MS, BASE_MS,
} from '../src/bridge-reader.js';
import { gameBitmap, drawStrip } from './fixtures/strip-bitmap.js';

const vectorText = fs.readFileSync(new URL('../../test/fixtures/bridge-vectors.lua', import.meta.url), 'utf8');
const { vectors } = parseSavedVariables(vectorText.replace(/^return\s/m, 'BridgeVectors = ')).BridgeVectors;
const V = vectors.find((v) => v.label === 'quests-25');
const TAG = V.tag;

// Decoded frames for the 25-quest log: [page 0, page 1, page 2, page 3].
function frames({ quests = V.quests, core = V.core, tag = TAG, seq = 7 } = {}) {
  const pages = packQuests(quests, V.capacity);
  const total = pages.length + 1;
  const c = { ...core, questDigest: questDigest(quests), questCount: quests.length };
  return [packCore(c), ...pages].map((bits, page) => decodeFrame(encodeFrame({ seq, page, pages: total, tag }, bits)));
}
const symbolsOf = (page) => V.frames[page].symbols;
// The same log one kill earlier on every quest: same page layout, every page and the digest differ.
const oldQuests = V.quests.map((q) => ({ ...q, objectives: q.objectives.map((o, j) => (j === 0 ? (o + 255) % 256 : o)) }));

// ---------------------------------------------------------------------------------------
// readStrip / decodeStrip

test('a 1280x720 capture with a noisy strip decodes to the drawn frame', () => {
  for (const page of [0, 1, 3]) {
    const img = drawStrip(gameBitmap(1280, 720), symbolsOf(page));
    const symbols = readStrip(img);
    assert.ok(symbols, `page ${page}`);
    assert.equal(symbols.length, Math.floor(1280 / 3));
    assert.deepEqual(decodeStrip(symbols), decodeFrame(symbolsOf(page)), `page ${page}`);
  }
});

test('a strip below a 56 px window title bar decodes', () => {
  for (const page of [0, 2]) {
    const img = drawStrip(gameBitmap(1280, 720), symbolsOf(page), { y0: 56 });
    assert.deepEqual(decodeStrip(readStrip(img)), decodeFrame(symbolsOf(page)), `page ${page}`);
  }
  const retina = drawStrip(gameBitmap(2560, 1440), symbolsOf(0), { y0: 112 });
  assert.deepEqual(decodeStrip(readStrip(retina)), decodeFrame(symbolsOf(0)));
});

test('the marker is looked for only in the top tenth of the window, at most 120 rows', () => {
  assert.equal(readStrip(drawStrip(gameBitmap(1280, 720), symbolsOf(0), { y0: 73 })), null); // 720 / 10 = 72
  assert.equal(readStrip(drawStrip(gameBitmap(2560, 1600), symbolsOf(0), { y0: 121 })), null);
  assert.ok(readStrip(drawStrip(gameBitmap(2560, 1600), symbolsOf(0), { y0: 120 })));
});

test('top rows cut from a taller window are searched as deep as the window allows', () => {
  const crop = (img, rows) => ({ bitmap: img.bitmap.subarray(0, img.width * rows * 4), width: img.width, height: rows });
  const deep = drawStrip(gameBitmap(2560, 1600), symbolsOf(0), { y0: 120 });
  assert.equal(stripRowCount(1600), 121);
  assert.equal(stripRowCount(720), 73);
  assert.equal(stripRowCount(5), 1);
  const top = crop(deep, stripRowCount(1600));
  assert.equal(readStrip(top), null); // 121 rows alone allow only 12
  assert.deepEqual(decodeStrip(readStrip({ ...top, windowHeight: 1600 })), decodeFrame(symbolsOf(0)));
  const low = crop(drawStrip(gameBitmap(1280, 720), symbolsOf(0), { y0: 73 }), 80);
  assert.equal(readStrip({ ...low, windowHeight: 720 }), null);
});

test('the strip must start at the left edge', () => {
  assert.equal(readStrip(drawStrip(gameBitmap(1280, 720), symbolsOf(0), { x0: 3 })), null);
});

test('a surviving marker with corrupted data never yields a frame', () => {
  for (const page of [0, 1, 3]) {
    const sym = symbolsOf(page).slice();
    for (const i of [8, 30, 31, 60]) sym[i] = (sym[i] + 2) % 4;
    const r = decodeStrip(readStrip(drawStrip(gameBitmap(1280, 720), sym)));
    assert.equal(r.ok, false, `page ${page}`);
    assert.match(r.reason, /^(checksum|length)$/);
  }
});

test('a capture without the strip returns null', () => {
  assert.equal(readStrip(gameBitmap(1280, 720)), null);
  const black = { bitmap: Buffer.alloc(1280 * 720 * 4), width: 1280, height: 720 };
  assert.equal(readStrip(black), null);
  assert.equal(readStrip({ bitmap: Buffer.alloc(10), width: 1280, height: 720 }), null);
});

test('decodeStrip rejects a strip that ends inside the frame', () => {
  assert.deepEqual(decodeStrip(symbolsOf(1).slice(0, 40)), { ok: false, reason: 'length' });
  assert.deepEqual(decodeStrip(null), { ok: false, reason: 'no strip' });
});

// ---------------------------------------------------------------------------------------
// Assembler

test('page 0 alone gives the core with no quests', () => {
  const a = createAssembler();
  const [f0] = frames();
  const s = a.push(f0);
  assert.equal(s.tag, TAG);
  assert.equal(s.pages, 4);
  assert.deepEqual(s.core, { ...V.core });
  assert.equal(s.quests, null);
  assert.equal(s.questsComplete, false);
});

test('every page with a matching digest gives the whole quest log, in any order', () => {
  for (const order of [[0, 1, 2, 3], [3, 1, 0, 2]]) {
    const a = createAssembler();
    const f = frames();
    let s;
    for (const i of order) s = a.push(f[i]) ?? s;
    assert.equal(s.questsComplete, true, String(order));
    assert.deepEqual(s.quests, V.quests);
    assert.deepEqual(a.state(TAG), s);
  }
});

test('pages from an older quest log are dropped until fresh ones arrive', () => {
  const a = createAssembler();
  const fresh = frames();
  const stale = frames({ quests: oldQuests });
  a.push(fresh[0]);
  for (const i of [1, 2, 3]) a.push(stale[i]);
  assert.equal(a.state(TAG).quests, null);
  a.push(fresh[1]);
  a.push(fresh[3]);
  assert.equal(a.state(TAG).questsComplete, false); // page 2 is still the old one
  const s = a.push(fresh[2]);
  assert.equal(s.questsComplete, true);
  assert.deepEqual(s.quests, V.quests);
});

test('a new quest digest clears the complete list until its pages arrive', () => {
  const a = createAssembler();
  for (const f of frames({ quests: oldQuests })) a.push(f);
  assert.equal(a.state(TAG).questsComplete, true);
  const fresh = frames();
  const s = a.push(fresh[0]);
  assert.equal(s.quests, null);
  assert.equal(s.questsComplete, false);
  for (const f of fresh.slice(1)) a.push(f);
  assert.deepEqual(a.state(TAG).quests, V.quests);
});

test('a core whose quest log could not be read (count 31, no quest pages) is never a complete empty log', () => {
  // ForeverLog sends this when collecting the quest log failed: snapshot quests must not be marked as left.
  const unread = decodeFrame(encodeFrame({ seq: 1, page: 0, pages: 1, tag: TAG }, packCore({ ...V.core, questDigest: questDigest([]), questCount: 31 })));
  const s = createAssembler().push(unread);
  assert.equal(s.questsComplete, false);
  assert.equal(s.quests, null);
  const empty = decodeFrame(encodeFrame({ seq: 1, page: 0, pages: 1, tag: TAG }, packCore({ ...V.core, questDigest: questDigest([]), questCount: 0 })));
  assert.equal(createAssembler().push(empty).questsComplete, true, 'an actually empty log is complete');
});

test('frames from two characters keep separate states', () => {
  const a = createAssembler();
  const other = 0x1234;
  for (const f of frames()) a.push(f);
  a.push(frames({ tag: other, core: { ...V.core, level: 12 }, quests: [] })[0]);
  assert.equal(a.state(TAG).core.level, 33);
  assert.equal(a.state(TAG).questsComplete, true);
  assert.equal(a.state(other).core.level, 12);
  assert.deepEqual(a.state(other).quests, []);
  assert.equal(a.state(other).questsComplete, true);
});

test('push returns null when only seq moved, and the state keeps the newest seq', () => {
  const a = createAssembler();
  assert.ok(a.push(frames({ seq: 7 })[0]));
  assert.equal(a.push(frames({ seq: 9 })[0]), null);
  assert.equal(a.state(TAG).seq, 9);
});

test('a quest page before any page 0 reports nothing yet', () => {
  const a = createAssembler();
  assert.equal(a.push(frames()[1]), null);
  assert.equal(a.state(TAG), null);
});

// ---------------------------------------------------------------------------------------
// Live writer

function writerHarness(slug = 'realm-testchar') {
  let t = 1_000_000;
  const writes = [];
  const w = createLiveWriter({
    dataDir: '/data', slugForTag: () => slug, now: () => t,
    writeFile: (file, text) => writes.push({ file, json: JSON.parse(text) }),
  });
  return { w, writes, at: (ms) => { t = ms; } };
}

function stateOf(fs4) {
  const a = createAssembler();
  for (const f of fs4) a.push(f);
  return a.state(TAG);
}

test('live.json carries the core, percent coordinates, and quests', () => {
  const h = writerHarness();
  h.w.update(stateOf(frames()));
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].file, path.join('/data', 'characters', 'realm-testchar.live.json'));
  assert.deepEqual(h.writes[0].json, {
    seenAt: 1000, changedAt: 1000, seq: 7, tag: TAG,
    level: 33, xp: 98765, xpMax: 120000, rested: 4000, money: 123456,
    map: { uiMapId: 1429, x: 51.2, y: 48.7 },
    quests: V.quests, questsComplete: true,
  });
});

test('an unchanged state writes once, then again only after 30 s', () => {
  const h = writerHarness();
  const s = stateOf(frames().slice(0, 1));
  h.w.update(s);
  h.at(1_010_000); h.w.update({ ...s, seq: 8 });
  h.at(1_000_000 + HEARTBEAT_MS - 1); h.w.update(s);
  assert.equal(h.writes.length, 1);
  h.at(1_000_000 + HEARTBEAT_MS); h.w.update({ ...s, seq: 9 });
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].json.seenAt, 1030);
  assert.equal(h.writes[1].json.changedAt, 1000);
  assert.equal(h.writes[1].json.seq, 9);
  assert.equal(h.writes[1].json.quests, null);
  assert.equal(h.writes[1].json.questsComplete, false);
});

test('a changed state writes right away and moves changedAt', () => {
  const h = writerHarness();
  const s = stateOf(frames().slice(0, 1));
  h.w.update(s);
  h.at(1_002_000);
  h.w.update({ ...s, core: { ...s.core, xp: s.core.xp + 50 } });
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].json.changedAt, 1002);
  assert.equal(h.writes[1].json.xp, 98815);
});

test('an unknown character tag is written as live-<tag>.live.json', () => {
  const h = writerHarness(null);
  h.w.update(stateOf(frames().slice(0, 1)));
  assert.equal(h.writes[0].file, path.join('/data', 'characters', `live-${TAG}.live.json`));
});

test('the default writer replaces the file atomically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-live-'));
  const w = createLiveWriter({ dataDir: dir, slugForTag: () => 'r-c', now: () => 5000 });
  w.update(stateOf(frames().slice(0, 1)));
  const files = fs.readdirSync(path.join(dir, 'characters'));
  assert.deepEqual(files, ['r-c.live.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'characters', 'r-c.live.json'), 'utf8')).level, 33);
});

// ---------------------------------------------------------------------------------------
// Slug resolver

test('slugForTag finds the synced snapshot whose name and class make the tag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-slug-'));
  const chars = path.join(dir, 'characters');
  fs.mkdirSync(chars);
  fs.writeFileSync(path.join(chars, 'realm-testchar.json'), JSON.stringify({ name: 'Testchar', classFile: 'WARRIOR', realm: 'Realm' }));
  fs.writeFileSync(path.join(chars, 'realm-other.json'), JSON.stringify({ name: 'Other', classFile: 'MAGE' }));
  fs.writeFileSync(path.join(chars, 'realm-broken.json'), '{ not json');
  fs.writeFileSync(path.join(chars, 'realm-testchar.live.json'), JSON.stringify({ name: 'Liar', classFile: 'WARRIOR' }));
  fs.writeFileSync(path.join(chars, 'realm-testchar.journal.jsonl'), '{}\n');
  const slugForTag = createSlugResolver({ dataDir: dir });
  assert.equal(slugForTag(characterTag('Testchar', 'WARRIOR')), 'realm-testchar');
  assert.equal(slugForTag(characterTag('Other', 'MAGE')), 'realm-other');
  assert.equal(slugForTag(characterTag('Liar', 'WARRIOR')), null);
  assert.equal(slugForTag(TAG), 'realm-testchar'); // the vector's tag is Testchar-WARRIOR
});

test('slugForTag rescans for an unknown tag at most once a minute', () => {
  let t = 0;
  let scans = 0;
  const snaps = [];
  const slugForTag = createSlugResolver({
    dataDir: '/data', now: () => t,
    readdir: () => { scans++; return snaps.map((s) => `${s.slug}.json`); },
    readFile: (file) => JSON.stringify(snaps.find((s) => file.endsWith(`${s.slug}.json`))),
  });
  assert.equal(slugForTag(TAG), null);
  snaps.push({ slug: 'realm-testchar', name: 'Testchar', classFile: 'WARRIOR' });
  t = 30_000;
  assert.equal(slugForTag(TAG), null);
  assert.equal(scans, 1);
  t = 60_000;
  assert.equal(slugForTag(TAG), 'realm-testchar');
  t = 61_000;
  assert.equal(slugForTag(TAG), 'realm-testchar');
  assert.equal(scans, 2);
});

test('slugForTag survives a missing characters folder', () => {
  const slugForTag = createSlugResolver({ dataDir: path.join(os.tmpdir(), 'fc-none-' + process.pid) });
  assert.equal(slugForTag(TAG), null);
});

// ---------------------------------------------------------------------------------------
// Plausibility: a checksum-valid frame with impossible values is not live state

const coreFrame = (over, head = {}) => decodeFrame(encodeFrame({ seq: 1, page: 0, pages: 4, tag: TAG, ...head }, packCore({ ...V.core, ...over })));

test('plausible frames pass: the golden cores and quest pages', () => {
  for (const f of frames()) assert.equal(plausibleFrame(f), true);
  assert.equal(plausibleFrame(coreFrame({ level: 60, xp: 0, xpMax: 0 })), true);
  assert.equal(plausibleFrame(coreFrame({ level: 1, x: 1000, y: 1000 })), true);
});

test('implausible checksum-valid frames are rejected', () => {
  for (const over of [{ level: 0 }, { level: 99 }, { xp: 5, xpMax: 4 }, { x: 1001 }, { y: 1023 }]) {
    const f = coreFrame(over);
    assert.equal(f.ok, true);
    assert.equal(plausibleFrame(f), false, JSON.stringify(over));
  }
  assert.equal(plausibleFrame(coreFrame({}, { page: 0, pages: 0 })), false);
  const quest = decodeFrame(encodeFrame({ seq: 1, page: 4, pages: 4, tag: TAG }, packQuests(V.quests, V.capacity)[0]));
  assert.equal(plausibleFrame(quest), false);
});

// ---------------------------------------------------------------------------------------
// Live reader: capture -> strip -> frame -> assembler -> writer

function readerHarness(captures) {
  const updates = [];
  const logs = [];
  let calls = 0;
  const reader = createLiveReader({
    capture: async () => { calls++; const c = captures.shift(); if (c instanceof Error) throw c; return c; },
    writer: { update: (s) => updates.push(s) },
    log: (m) => logs.push(m),
    now: () => 42_000,
  });
  return { reader, updates, logs, calls: () => calls };
}
const shot = (page) => ({ ok: true, ...drawStrip(gameBitmap(1280, 720), symbolsOf(page)) });
const miss = { ok: false, reason: 'not-running' };

test('a good capture writes the state and reports what the scheduler needs', async () => {
  const h = readerHarness([shot(0), shot(1)]);
  const r = await h.reader.read();
  assert.deepEqual(r, { ok: true, tag: TAG, pages: 4, questsComplete: false, key: `${TAG}:${V.core.questDigest}` });
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].core.level, 33);
  assert.deepEqual(h.reader.latest(TAG), { state: h.updates[0], at: 42_000 });
  const r2 = await h.reader.read();
  assert.equal(r2.ok, true);
  assert.equal(h.updates.length, 2); // every good decode reaches the writer, which keeps the heartbeat
});

test('a quest page before page 0 decodes but writes nothing', async () => {
  const h = readerHarness([shot(2)]);
  const r = await h.reader.read();
  assert.equal(r.ok, true);
  assert.equal(r.questsComplete, false);
  assert.equal(h.updates.length, 0);
});

test('an implausible core frame is a miss and writes nothing', async () => {
  const bad = (level) => ({ ok: true, ...drawStrip(gameBitmap(1280, 720), encodeFrame({ seq: 1, page: 0, pages: 1, tag: TAG }, packCore({ ...V.core, level }))) });
  const h = readerHarness([bad(0), bad(99), bad(99)]);
  assert.deepEqual(await h.reader.read(), { ok: false, reason: 'implausible' });
  await h.reader.read();
  await h.reader.read();
  assert.equal(h.updates.length, 0);
  assert.equal(h.logs.length, 1); // three implausible reads count as a miss streak
});

test('three misses in a row log once; a good read resets the count', async () => {
  const noStrip = { ok: true, ...gameBitmap(1280, 720) };
  const h = readerHarness([miss, noStrip, new Error('boom'), miss, miss, shot(0), miss, miss, miss]);
  for (let i = 0; i < 9; i++) await h.reader.read();
  assert.equal(h.logs.length, 2);
  assert.match(h.logs[0], /3 reads in a row/);
  assert.equal(h.updates.length, 1);
});

test('reads asked for while one runs share its capture', async () => {
  const h = readerHarness([shot(0), shot(0)]);
  const [a, b] = await Promise.all([h.reader.read(), h.reader.read()]);
  assert.equal(h.calls(), 1);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------------------
// Scheduler (R7): follow-up reads when the quest list is incomplete

function scheduleHarness(results) {
  const delays = [];
  let pending = null;
  let reads = 0;
  const stop = scheduleReads({
    read: async () => { reads++; const r = results.shift() ?? { ok: false }; if (r instanceof Error) throw r; return r; },
    setTimer: (fn, ms) => { pending = fn; delays.push(ms); return 1; },
    clearTimer: () => { pending = null; },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    delays, stop, reads: () => reads,
    step: async () => { const fn = pending; pending = null; await fn?.(); await settle(); },
    settle,
  };
}
const incomplete = (key = 'k1', pages = 4) => ({ ok: true, questsComplete: false, pages, key });
const complete = { ok: true, questsComplete: true, pages: 4, key: 'k1' };

test('complete reads and misses keep the 10 s cadence', async () => {
  assert.equal(BASE_MS, 10_000);
  const h = scheduleHarness([complete, { ok: false }, new Error('x'), complete]);
  await h.settle();
  for (let i = 0; i < 3; i++) await h.step();
  assert.equal(h.reads(), 4);
  assert.deepEqual(h.delays, [10000, 10000, 10000, 10000]);
});

test('an incomplete quest list takes up to 2 x (pages - 1) + 2 follow-ups 1.1 s apart', async () => {
  const h = scheduleHarness(Array.from({ length: 12 }, () => incomplete('k1', 4)));
  await h.settle();
  for (let i = 0; i < 9; i++) await h.step();
  // first read, then 8 follow-ups, then back to 10 s
  assert.deepEqual(h.delays, [1100, 1100, 1100, 1100, 1100, 1100, 1100, 1100, 10000, 10000]);
  assert.equal(h.reads(), 10);
});

test('follow-ups stop as soon as the list is complete', async () => {
  const h = scheduleHarness([incomplete(), incomplete(), complete, complete]);
  await h.settle();
  await h.step(); await h.step(); await h.step();
  assert.deepEqual(h.delays, [1100, 1100, 10000, 10000]);
});

test('a new quest digest after a used-up burst starts a new burst', async () => {
  const results = [...Array.from({ length: 6 }, () => incomplete('k1', 2)), incomplete('k2', 2)];
  const h = scheduleHarness(results);
  await h.settle();
  for (let i = 0; i < 6; i++) await h.step();
  // 2 x (2 - 1) + 2 = 4 follow-ups for k1; the same k1 later waits 10 s; k2 starts a burst
  assert.deepEqual(h.delays, [1100, 1100, 1100, 1100, 10000, 10000, 1100]);
});

test('nothing runs after stop', async () => {
  const h = scheduleHarness([complete, complete]);
  await h.settle();
  h.stop();
  await h.step();
  assert.equal(h.reads(), 1);
});

// ---------------------------------------------------------------------------------------
// Status line

test('the status line prefers fresh live values', () => {
  const snapshot = { name: 'Testchar', classFile: 'WARRIOR', level: 30, xp: 0, xpMax: 100, zone: 'Durotar', subzone: '', mapId: 1411 };
  const state = { tag: TAG, core: { ...V.core, level: 12, xp: 45, xpMax: 100, uiMapId: 1411 } };
  const live = { state, at: 100_000 };
  assert.equal(liveStatusLine({ snapshot, live, nowMs: 130_000 }), 'Testchar L12 45% XP · Durotar (live)');
  const elsewhere = { state: { ...state, core: { ...state.core, uiMapId: 1429 } }, at: 100_000 };
  assert.equal(liveStatusLine({ snapshot, live: elsewhere, nowMs: 130_000 }), 'Testchar L12 45% XP (live)');
  assert.equal(liveStatusLine({ snapshot, live, nowMs: 100_000 + 121_000 }), null);
  assert.equal(liveStatusLine({ snapshot, live: null, nowMs: 0 }), null);
});
