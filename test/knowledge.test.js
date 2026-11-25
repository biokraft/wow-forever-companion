import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listKnowledge, readKnowledge, writeKnowledge, parseFrontmatter, STALE_DAYS } from '../src/knowledge.js';

let root, cfg;
const NOW = Date.UTC(2026, 10, 25) / 1000;
const doc = (o = {}) => `---\ntopic: ${o.topic ?? 'Hunter leveling'}\nsources:\n  - ${o.source ?? 'https://www.wowhead.com/classic/guide/hunter'}\nchecked: ${o.checked ?? '2026-11-25'}\nscope: forever\n---\n\n# Hunter\n${o.body ?? 'Pet tanks.'}\n`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-know-'));
  cfg = { dataDir: path.join(root, 'data'), gameDir: path.join(root, 'game'), main: null };
  fs.mkdirSync(cfg.dataDir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('parseFrontmatter reads scalars and the sources list', () => {
  assert.deepEqual(parseFrontmatter(doc()).meta, { topic: 'Hunter leveling', sources: ['https://www.wowhead.com/classic/guide/hunter'], checked: '2026-11-25', scope: 'forever' });
});

test('write then list shows a fresh cache entry, and nothing that the player did not save', () => {
  writeKnowledge(cfg, 'hunter-leveling', doc());
  const list = listKnowledge(cfg, { now: NOW });
  const mine = list.find((k) => k.slug === 'hunter-leveling');
  assert.deepEqual({ source: mine.source, ageDays: mine.ageDays, stale: mine.stale, topic: mine.topic }, { source: 'cache', ageDays: 0, stale: false, topic: 'Hunter leveling' });
  assert.deepEqual(list.map((k) => k.source), ['cache'], 'the toolkit ships no notes');
  assert.equal(readKnowledge(cfg, 'hunter-leveling').trim().endsWith('Pet tanks.'), true);
});

test(`entries older than ${STALE_DAYS} days are stale`, () => {
  writeKnowledge(cfg, 'old', doc({ checked: '2026-11-05' }));
  assert.equal(listKnowledge(cfg, { now: NOW }).find((k) => k.slug === 'old').stale, true);
});

test('invalid writes are rejected with a reason', () => {
  assert.throws(() => writeKnowledge(cfg, '../escape', doc()), /slug/);
  assert.throws(() => writeKnowledge(cfg, 'nosrc', doc().replace(/sources:\n  - .*\n/, '')), /sources/);
  assert.throws(() => writeKnowledge(cfg, 'badsrc', doc({ source: 'file:///etc/passwd' })), /http/);
  assert.throws(() => writeKnowledge(cfg, 'baddate', doc({ checked: 'yesterday' })), /checked/);
  assert.throws(() => writeKnowledge(cfg, 'big', doc({ body: 'x'.repeat(41 * 1024) })), /large/);
  assert.equal(fs.existsSync(path.join(cfg.dataDir, 'knowledge', 'nosrc.md')), false);
});

test('readKnowledge reads only the player\'s own notes and refuses traversal', () => {
  assert.throws(() => readKnowledge(cfg, 'classes/warrior'), /invalid knowledge slug/);
  assert.throws(() => readKnowledge(cfg, 'forever-rules'), /not found/);
  assert.throws(() => readKnowledge(cfg, '../../package'), /slug|not found/);
  assert.throws(() => readKnowledge(null, 'hunter-leveling'), /not found/);
  assert.deepEqual(listKnowledge(null), []);
});

test('review: reserved, shadowing, future and impossible entries are rejected', () => {
  for (const slug of ['claude', 'Claude', 'agents', 'readme']) assert.throws(() => writeKnowledge(cfg, slug, doc()), /reserved|slug/, slug);
  assert.match(writeKnowledge(cfg, 'forever-rules', doc()), /forever-rules\.md$/, 'a name the toolkit once shipped is the player\'s to use');
  assert.throws(() => writeKnowledge(cfg, 'future', doc({ checked: '2099-01-01' })), /future/);
  assert.throws(() => writeKnowledge(cfg, 'bogus', doc({ checked: '2026-02-30' })), /checked/);
});

test('review: every research note ages out, and notes without valid sources are stale at once', () => {
  const later = Date.UTC(2027, 5, 1) / 1000;
  writeKnowledge(cfg, 'ages-out', doc());
  assert.ok(listKnowledge(cfg, { now: later }).filter((k) => k.source === 'cache').every((k) => k.stale));
  fs.mkdirSync(path.join(cfg.dataDir, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(cfg.dataDir, 'knowledge', 'handmade.md'), '---\ntopic: x\nchecked: 2026-11-25\n---\nno sources\n');
  const k = listKnowledge(cfg, { now: NOW }).find((e) => e.slug === 'handmade');
  assert.equal(k.stale, true);
  assert.equal(k.valid, false);
});

test('review: the cache lists only top-level notes', () => {
  fs.mkdirSync(path.join(cfg.dataDir, 'knowledge', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(cfg.dataDir, 'knowledge', 'sub', 'x.md'), doc());
  assert.ok(!listKnowledge(cfg, { now: NOW }).some((k) => k.slug.includes('sub')));
});

test('knowledge/progress.md is player notes: listed as notes, never stale, written without frontmatter', () => {
  const later = Date.UTC(2027, 5, 1) / 1000;
  const notes = '# Progress\n\n- 2026-11-20 L12 Durotar, trained Blacksmithing\n';
  writeKnowledge(cfg, 'progress', notes);
  assert.equal(fs.readFileSync(path.join(cfg.dataDir, 'knowledge', 'progress.md'), 'utf8'), notes);
  const k = listKnowledge(cfg, { now: later }).find((e) => e.slug === 'progress');
  assert.deepEqual({ source: k.source, stale: k.stale }, { source: 'notes', stale: false });
  // Slug and size limits still hold, and research notes still need sources.
  assert.throws(() => writeKnowledge(cfg, 'progress', 'x'.repeat(41 * 1024)), /large/);
  assert.throws(() => writeKnowledge(cfg, 'progress-2', notes), /sources/);
  assert.equal(fs.readdirSync(path.join(cfg.dataDir, 'knowledge')).filter((f) => f.includes('.tmp-')).length, 0, 'written atomically, no temp file left');
});
