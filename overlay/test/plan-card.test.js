import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCardModel, planCardHtml, updatedText, PLAN_SECTIONS } from '../src/plan-card.js';

const NOW = 1_800_000_000;

const full = () => ({
  version: 1,
  summary: 'Fast questing warrior, tank in dungeons',
  goal: 'Reach 60 and tank Molten Core.',
  role: { spec: 'Protection', weapons: 'One-hander and shield', notes: 'Arms while levelling' },
  playstyle: ['Quest fast', 'Dungeons on weekends'],
  professions: [{ name: 'Mining', why: 'Money and Engineering' }, { name: 'Engineering' }],
  milestones: [{ level: 10, text: 'Defensive Stance' }, { level: 30, text: 'Scarlet Monastery' }, { text: 'Get a mount' }],
  avoid: ['PvP servers zones at night'],
  notes: 'Line one\nLine two',
  updatedAt: NOW - 2 * 3600,
});

test('sections come in the fixed order with plain titles', () => {
  const m = planCardModel(full(), { level: 20, nowSec: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['goal', 'role', 'playstyle', 'professions', 'milestones', 'avoid', 'notes']);
  assert.deepEqual(m.sections.map((s) => s.title), ['Goal', 'Role and build', 'Playstyle', 'Professions', 'Milestones', 'Avoid', 'Notes']);
  assert.deepEqual(PLAN_SECTIONS.map((s) => s.id), m.sections.map((s) => s.id));
  assert.equal(m.summary, 'Fast questing warrior, tank in dungeons');
});

test('section lines read as plain words', () => {
  const m = planCardModel(full(), { level: 20, nowSec: NOW });
  const lines = (id) => m.sections.find((s) => s.id === id).lines.map((l) => l.text);
  assert.deepEqual(lines('goal'), ['Reach 60 and tank Molten Core.']);
  assert.deepEqual(lines('role'), ['Spec: Protection', 'Weapons: One-hander and shield', 'Notes: Arms while levelling']);
  assert.deepEqual(lines('professions'), ['Mining: Money and Engineering', 'Engineering']);
  assert.deepEqual(lines('milestones'), ['Level 10: Defensive Stance', 'Level 30: Scarlet Monastery', 'Get a mount']);
  assert.deepEqual(lines('notes'), ['Line one', 'Line two']);
});

test('empty sections are left out', () => {
  const m = planCardModel({ summary: 'S', goal: 'G', playstyle: [], updatedAt: NOW }, { level: 5, nowSec: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['goal']);
});

test('milestones at or below the live level are reached, the rest and level-less ones are not', () => {
  const m = planCardModel(full(), { level: 30, nowSec: NOW });
  const ms = m.sections.find((s) => s.id === 'milestones').lines;
  assert.deepEqual(ms.map((l) => !!l.reached), [true, true, false]);
  const low = planCardModel(full(), { level: 9, nowSec: NOW }).sections.find((s) => s.id === 'milestones').lines;
  assert.deepEqual(low.map((l) => !!l.reached), [false, false, false]);
  const unknown = planCardModel(full(), { level: null, nowSec: NOW }).sections.find((s) => s.id === 'milestones').lines;
  assert.deepEqual(unknown.map((l) => !!l.reached), [false, false, false]);
});

test('every section is open by default; saved folds close only their own section', () => {
  const open = planCardModel(full(), { level: 1, nowSec: NOW });
  assert.ok(open.sections.every((s) => s.open));
  assert.equal(open.open, true);
  const folded = planCardModel(full(), { level: 1, nowSec: NOW, folds: { milestones: false, notes: true, card: false } });
  assert.deepEqual(folded.sections.filter((s) => !s.open).map((s) => s.id), ['milestones']);
  assert.equal(folded.open, false, 'the whole card folds to its summary');
});

test('updated text in plain words', () => {
  assert.equal(planCardModel(full(), { level: 1, nowSec: NOW }).updatedText, 'Updated 2 h ago');
  assert.equal(updatedText(NOW - 20, NOW), 'Updated just now');
  assert.equal(updatedText(NOW - 5 * 60, NOW), 'Updated 5 min ago');
  assert.equal(updatedText(NOW - 3 * 86400, NOW), 'Updated 3 days ago');
  assert.equal(updatedText(NOW - 86400 - 5, NOW), 'Updated 1 day ago');
  assert.equal(updatedText(undefined, NOW), '');
  assert.equal(updatedText(NOW + 100, NOW), 'Updated just now', 'a clock a little off never says "in the future"');
});

test('the html escapes every text from the plan', () => {
  const plan = { ...full(), summary: '<img src=x onerror=alert(1)>', goal: 'a & b "c" \'d\'', avoid: ['<script>'] };
  const html = planCardHtml(planCardModel(plan, { level: 1, nowSec: NOW }));
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('a &amp; b &quot;c&quot; &#39;d&#39;'));
});

test('section headers are buttons that show and toggle aria-expanded', () => {
  const open = planCardHtml(planCardModel(full(), { level: 1, nowSec: NOW }));
  assert.match(open, /<button type="button" class="[^"]*" data-fold="goal" aria-expanded="true"[^>]*>[^<]*<span class="mark">[^<]*<\/span>Goal<\/button>/);
  const closed = planCardHtml(planCardModel(full(), { level: 1, nowSec: NOW, folds: { goal: false } }));
  assert.match(closed, /data-fold="goal" aria-expanded="false"/);
  assert.match(closed, /data-fold="role" aria-expanded="true"/);
  // A folded section keeps its header but hides its lines.
  assert.ok(!closed.includes('Reach 60 and tank Molten Core.'));
  assert.ok(open.includes('Reach 60 and tank Molten Core.'));
});

test('the whole-card fold shows only the summary and a plain-word control', () => {
  const open = planCardHtml(planCardModel(full(), { level: 1, nowSec: NOW }));
  assert.match(open, /data-fold="card" aria-expanded="true"[^>]*><span class="mark">[^<]*<\/span>Fold all<\/button>/);
  assert.ok(open.includes('Updated 2 h ago'));
  const folded = planCardHtml(planCardModel(full(), { level: 1, nowSec: NOW, folds: { card: false } }));
  assert.match(folded, /data-fold="card" aria-expanded="false"[^>]*><span class="mark">[^<]*<\/span>Show all<\/button>/);
  assert.ok(folded.includes('Fast questing warrior, tank in dungeons'));
  assert.ok(!folded.includes('data-fold="goal"'));
  assert.ok(!folded.includes('Updated 2 h ago'));
});

test('reached milestones carry a plain-text check mark and the muted style', () => {
  const html = planCardHtml(planCardModel(full(), { level: 10, nowSec: NOW }));
  assert.match(html, /<li class="muted">✓ Level 10: Defensive Stance<\/li>/);
  assert.match(html, /<li>Level 30: Scarlet Monastery<\/li>/);
});
