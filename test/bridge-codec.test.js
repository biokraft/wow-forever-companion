import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSavedVariables } from '../src/lua/parse.js';
import {
  GREYS, MARKER, FORMAT_VERSION, BLOCK_W, BLOCK_H,
  fletcher16, characterTag, packCore, unpackCore, packQuests, unpackQuests,
  questDigest, encodeFrame, decodeFrame, pageCapacityBits, frameSymbolCount,
} from '../src/bridge/codec.js';

const text = readFileSync(new URL('./fixtures/bridge-vectors.lua', import.meta.url), 'utf8');
const { vectors } = parseSavedVariables(text.replace(/^return\s/m, 'BridgeVectors = ')).BridgeVectors;
const byLabel = (l) => vectors.find((v) => v.label === l);

test('constants', () => {
  assert.deepEqual(GREYS, [0, 24, 48, 72]);
  assert.deepEqual(MARKER, [3, 0, 3, 0, 3, 3]);
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(BLOCK_W, 3);
  assert.equal(BLOCK_H, 2);
  assert.equal(pageCapacityBits(1280), 788);
});

test('fletcher16 known values', () => {
  assert.equal(fletcher16([]), 0);
  // classic check: bytes of "abcde" -> 0xC8F0
  assert.equal(fletcher16([...Buffer.from('abcde')]), 0xc8f0);
  assert.equal(fletcher16([...Buffer.from('abcdef')]), 0x2057);
});

test('vector file has the required cases', () => {
  for (const l of ['core-level1-empty', 'core-level60-max', 'quests-25', 'tag-testchar']) assert.ok(byLabel(l), l);
});

test('character tag vector', () => {
  const v = byLabel('tag-testchar');
  assert.equal(characterTag(v.charName, v.classFile), v.tag);
});

test('core frames reproduce vectors', () => {
  for (const l of ['core-level1-empty', 'core-level60-max']) {
    const v = byLabel(l);
    const sym = encodeFrame({ seq: v.seq, page: v.page, pages: v.pages, tag: v.tag }, packCore(v.core));
    assert.deepEqual(sym, v.symbols, l);
  }
});

test('25-quest vector: digest, pagination, every frame', () => {
  const v = byLabel('quests-25');
  assert.equal(v.quests.length, 25);
  const pages = packQuests(v.quests, v.capacity);
  assert.ok(pages.length >= 2);
  assert.equal(v.pages, pages.length + 1);
  assert.equal(v.core.questCount, 25);
  assert.equal(questDigest(v.quests), v.core.questDigest);
  assert.equal(v.frames.length, v.pages);
  const bitsPerFrame = [packCore(v.core), ...pages];
  v.frames.forEach((f, i) => {
    assert.equal(f.page, i);
    const sym = encodeFrame({ seq: v.seq, page: i, pages: v.pages, tag: v.tag }, bitsPerFrame[i]);
    assert.deepEqual(sym, f.symbols, `frame ${i}`);
  });
  for (const p of pages) assert.ok(p.length <= v.capacity);
});

test('decodeFrame round-trips header and bits', () => {
  const h = { seq: 200, page: 3, pages: 9, tag: 0xbeef };
  const bits = Array.from({ length: 100 }, (_, i) => (i * 7 + 3) % 2);
  const r = decodeFrame(encodeFrame(h, bits));
  assert.equal(r.ok, true);
  assert.deepEqual({ seq: r.seq, page: r.page, pages: r.pages, tag: r.tag, version: r.version }, { ...h, version: 1 });
  assert.deepEqual(r.bits, bits);
});

test('odd bit counts are padded with a zero bit', () => {
  const r = decodeFrame(encodeFrame({ seq: 1, page: 0, pages: 1, tag: 1 }, [1, 0, 1]));
  assert.deepEqual(r.bits, [1, 0, 1, 0]);
});

test('core pack/unpack round-trips, max values included', () => {
  for (const c of [byLabel('core-level1-empty').core, byLabel('core-level60-max').core,
    { level: 127, xp: 16777215, xpMax: 16777215, rested: 16777215, money: 4294967295, uiMapId: 65535, x: 1000, y: 0, questDigest: 65535, questCount: 31 }]) {
    assert.deepEqual(unpackCore(packCore(c)), c);
    assert.equal(packCore(c).length, 168);
  }
});

test('quests round-trip across pages, never splitting a quest', () => {
  const v = byLabel('quests-25');
  const pages = packQuests(v.quests, v.capacity);
  assert.deepEqual(pages.flatMap((p) => unpackQuests(p)), v.quests);
  assert.deepEqual(packQuests([], 788), []);
});

test('objective counts clamp to 255 and oversize quest throws', () => {
  const [p] = packQuests([{ id: 5, complete: false, failed: true, objectives: [999, 3] }], 788);
  assert.deepEqual(unpackQuests(p), [{ id: 5, complete: false, failed: true, objectives: [255, 3] }]);
  assert.throws(() => packQuests([{ id: 1, complete: false, failed: false, objectives: [1, 2, 3, 4, 5, 6, 7] }], 40));
});

test('single symbol flip after the marker fails the checksum', () => {
  const sym = byLabel('core-level60-max').symbols;
  for (let i = MARKER.length; i < sym.length; i++) {
    const bad = sym.slice();
    bad[i] = (bad[i] + 1) % 4;
    assert.deepEqual(decodeFrame(bad), { ok: false, reason: 'checksum' }, `symbol ${i}`);
  }
});

test('no marker, short, and version failures', () => {
  const sym = byLabel('core-level1-empty').symbols.slice();
  const noMarker = sym.slice();
  noMarker[0] = 0;
  assert.deepEqual(decodeFrame(noMarker), { ok: false, reason: 'no marker' });
  assert.deepEqual(decodeFrame(sym.slice(0, 20)), { ok: false, reason: 'short' });
  const v2 = encodeFrame({ seq: 1, page: 0, pages: 1, tag: 1, version: 2 }, [0, 1]);
  assert.deepEqual(decodeFrame(v2), { ok: false, reason: 'version' });
});

test('quest digest is width independent and recomputable from decoded frames', () => {
  const v = byLabel('quests-25');
  for (const width of [800, 1024, 1280, 1920, 2560]) {
    const cap = pageCapacityBits(width);
    const pages = packQuests(v.quests, cap);
    const total = pages.length + 1;
    const all = [packCore({ ...v.core, questDigest: questDigest(v.quests) }), ...pages];
    const decoded = all.map((b, i) => decodeFrame(encodeFrame({ seq: 1, page: i, pages: total, tag: v.tag }, b)));
    assert.ok(decoded.every((d) => d.ok), `width ${width}`);
    const core = unpackCore(decoded[0].bits);
    const quests = decoded.slice(1).flatMap((d) => unpackQuests(d.bits));
    assert.deepEqual(quests, v.quests, `width ${width}`);
    assert.equal(questDigest(quests), core.questDigest, `width ${width}`);
  }
});

// Deterministic junk: the pixels after a frame's checksum are game pixels.
const junk = (n, seed) => Array.from({ length: n }, (_, i) => (i * 7 + seed * 13 + ((i * i) % 5)) % 4);

test('frameSymbolCount finds every golden frame\'s length with game pixels after it', () => {
  const frames = [byLabel('core-level1-empty'), byLabel('core-level60-max'), ...byLabel('quests-25').frames];
  frames.forEach((f, k) => {
    assert.equal(frameSymbolCount(f.symbols), f.symbols.length, `frame ${k} alone`);
    for (const extra of [1, 7, 300]) {
      const strip = [...f.symbols, ...junk(extra, k)];
      const n = frameSymbolCount(strip);
      assert.equal(n, f.symbols.length, `frame ${k} + ${extra}`);
      assert.equal(decodeFrame(strip.slice(0, n)).ok, true);
    }
  });
});

test('page 0 is always 116 symbols', () => {
  assert.equal(frameSymbolCount([...byLabel('core-level1-empty').symbols, ...junk(50, 1)]), 116);
});

test('frameSymbolCount returns null without a marker, a header, or the whole frame', () => {
  const sym = byLabel('quests-25').frames[1].symbols;
  assert.equal(frameSymbolCount([0, 0, 0, ...sym]), null);
  assert.equal(frameSymbolCount(sym.slice(0, 20)), null);
  assert.equal(frameSymbolCount(sym.slice(0, 30)), null);
  assert.equal(frameSymbolCount(sym.slice(0, sym.length - 1)), null);
  assert.equal(frameSymbolCount(byLabel('core-level1-empty').symbols.slice(0, 115)), null);
  assert.equal(frameSymbolCount([]), null);
  const v2 = encodeFrame({ seq: 1, page: 0, pages: 1, tag: 1, version: 2 }, packCore(byLabel('core-level1-empty').core));
  assert.equal(frameSymbolCount(v2), null);
});

test('frameSymbolCount walks quest pages with odd bit counts and empty objective lists', () => {
  const quests = [{ id: 7, complete: false, failed: false, objectives: [] }, { id: 9, complete: true, failed: false, objectives: [3] }];
  const [bits] = packQuests(quests, 788);
  assert.equal(bits.length % 2, 1);
  const sym = encodeFrame({ seq: 2, page: 1, pages: 2, tag: 5 }, bits);
  assert.equal(frameSymbolCount([...sym, ...junk(40, 3)]), sym.length);
  const empty = encodeFrame({ seq: 2, page: 1, pages: 2, tag: 5 }, [0, 0, 0, 0, 0]);
  assert.equal(frameSymbolCount([...empty, 3, 3]), empty.length);
});
