import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateGamePlan, writeGamePlan, readGamePlan, gamePlanLine, gamePlanText, gamePlanFile, previousGamePlanFile } from '../src/gameplan.js';
import { FcError } from '../src/core.js';

const SLUG = 'testrealm-testa-grimtusk';
const good = () => ({
  summary: 'Fury warrior, questing solo, Mining and Engineering, mount at 40',
  goal: 'Reach 60 with steady questing and enough gold for the mount',
  role: { spec: 'Fury', weapons: 'Two-handed axes', notes: 'Switch to dual wield at 30' },
  playstyle: ['Solo questing', 'Dungeons only for quest rewards'],
  professions: [{ name: 'Mining', why: 'Gold and ore for Engineering' }, { name: 'Engineering', why: 'Bombs and goggles' }],
  milestones: [{ level: 10, text: 'Learn Defensive Stance' }, { level: 20, text: 'Learn Sweeping Strikes' }, { text: 'Save gold for the mount' }],
  avoid: ['Heavy grinding'],
  notes: 'Keep two stacks of bandages.\nVendor grey items.',
});

let root, cfg;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wowf-gameplan-')));
  cfg = { dataDir: path.join(root, 'data'), main: 'Testa-Grimtusk' };
  fs.mkdirSync(cfg.dataDir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('a valid plan validates, gets version 1 and keeps its sections', () => {
  const r = validateGamePlan(good());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.plan.version, 1);
  assert.equal(r.plan.summary, good().summary);
  assert.deepEqual(r.plan.milestones, good().milestones);
  assert.deepEqual(r.plan.role, good().role);
});

test('only summary and goal are required', () => {
  const r = validateGamePlan({ summary: 'Level up', goal: 'Reach 60' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.plan, { version: 1, summary: 'Level up', goal: 'Reach 60' });
});

test('every problem is reported at once, naming the field and the limit', () => {
  const bad = { ...good(), summary: 'x'.repeat(121), playstyle: Array.from({ length: 9 }, (_, i) => `item ${i}`), milestones: [{ level: 10, text: 'ok' }, { level: 'ten', text: 'Learn Charge' }] };
  delete bad.goal;
  const r = validateGamePlan(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('summary: 121 characters, at most 120'), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^goal: required/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.includes('playstyle: 9 items, at most 8'), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /^milestones\[1\]\.level: .*whole number from 1 to 60/.test(e)), r.errors.join('\n'));
  assert.equal(r.errors.length, 4, r.errors.join('\n'));
});

test('wrong types, unknown fields and nested limits are errors', () => {
  const r = validateGamePlan({
    summary: 'ok', goal: 'ok', golas: 'typo', version: 2,
    role: { spec: 'x'.repeat(81), stance: 'Battle' },
    professions: [{ why: 'Gold' }, { name: 'a', why: 'b' }, { name: 'c', why: 'd' }, { name: 'e', why: 'f' }, { name: 'g', why: 'h' }],
    milestones: [{ level: 61, text: 'too high' }, { text: 'y'.repeat(101) }],
    avoid: 'grinding',
    notes: 'n'.repeat(1001),
  });
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  for (const re of [/^golas: unknown field/m, /^version: /m, /^role\.spec: 81 characters, at most 80$/m, /^role\.stance: unknown field/m,
    /^professions: 5 items, at most 4$/m, /^professions\[0\]\.name: required/m, /^milestones\[0\]\.level: /m, /^milestones\[1\]\.text: 101 characters, at most 100$/m,
    /^avoid: must be a list/m, /^notes: 1001 characters, at most 1000$/m]) assert.match(all, re);
});

test('a plan that is not an object is rejected', () => {
  for (const v of [null, [], 'plan', 3]) assert.equal(validateGamePlan(v).ok, false);
});

test('a summary must be one line', () => {
  const r = validateGamePlan({ summary: 'two\nlines', goal: 'ok' });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^summary: /);
});

test('writeGamePlan stores the plan atomically with updatedAt and readGamePlan reads it back', () => {
  const { plan, file } = writeGamePlan(cfg, SLUG, good(), { now: 1_800_000_000 });
  assert.equal(file, path.join(cfg.dataDir, 'gameplans', `${SLUG}.json`));
  assert.equal(file, gamePlanFile(cfg, SLUG));
  assert.equal(plan.updatedAt, 1_800_000_000);
  assert.deepEqual(readGamePlan(cfg, SLUG), plan);
  assert.deepEqual(fs.readdirSync(path.join(cfg.dataDir, 'gameplans')), [`${SLUG}.json`], 'no temp file left');
});

test('a save keeps the plan it replaces, so a rewrite that went wrong can be taken back', () => {
  const first = writeGamePlan(cfg, SLUG, good(), { now: 1 });
  assert.equal(first.previous, null, 'nothing to keep on the first save');
  const second = writeGamePlan(cfg, SLUG, { summary: 'Rewritten', goal: 'Something else' }, { now: 2 });
  assert.equal(second.previous, previousGamePlanFile(cfg, SLUG));
  assert.deepEqual(JSON.parse(fs.readFileSync(second.previous, 'utf8')), first.plan);
  assert.equal(readGamePlan(cfg, SLUG).summary, 'Rewritten', 'the kept plan is never read as the plan');
  writeGamePlan(cfg, SLUG, good(), { now: 3 });
  assert.equal(JSON.parse(fs.readFileSync(second.previous, 'utf8')).summary, 'Rewritten', 'only the last one is kept');
});

test('an updatedAt or version on input is accepted and updatedAt is replaced', () => {
  const { plan } = writeGamePlan(cfg, SLUG, { ...good(), version: 1, updatedAt: 5 }, { now: 99 });
  assert.equal(plan.updatedAt, 99);
});

test('an invalid write throws all reasons and leaves the previous file byte-identical', () => {
  const { file } = writeGamePlan(cfg, SLUG, good(), { now: 1 });
  const before = fs.readFileSync(file);
  const bad = { ...good(), summary: 'x'.repeat(130) };
  delete bad.goal;
  assert.throws(() => writeGamePlan(cfg, SLUG, bad, { now: 2 }), (e) => e instanceof FcError && /summary: 130 characters, at most 120/.test(e.message) && /goal: required/.test(e.message));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${SLUG}.json`]);
});

test('readGamePlan returns null for a missing, broken or invalid file', () => {
  assert.equal(readGamePlan(cfg, SLUG), null);
  fs.mkdirSync(path.join(cfg.dataDir, 'gameplans'));
  fs.writeFileSync(gamePlanFile(cfg, SLUG), '{ broken');
  assert.equal(readGamePlan(cfg, SLUG), null);
  fs.writeFileSync(gamePlanFile(cfg, SLUG), JSON.stringify({ summary: 'no goal' }));
  assert.equal(readGamePlan(cfg, SLUG), null);
  assert.equal(readGamePlan(cfg, undefined), null);
});

test('gamePlanLine names the first milestone above the level, else the first without a level', () => {
  const { plan } = validateGamePlan(good());
  assert.equal(gamePlanLine(plan, 5), `Game plan: ${plan.summary} · next: Learn Defensive Stance`);
  assert.equal(gamePlanLine(plan, 10), `Game plan: ${plan.summary} · next: Learn Sweeping Strikes`);
  assert.equal(gamePlanLine(plan, 25), `Game plan: ${plan.summary} · next: Save gold for the mount`);
  assert.equal(gamePlanLine({ ...plan, milestones: [{ level: 10, text: 'x' }] }, 25), `Game plan: ${plan.summary}`);
  assert.equal(gamePlanLine({ summary: 'Just level', goal: 'g' }, 3), 'Game plan: Just level');
  assert.equal(gamePlanLine(null, 3), null);
});

test('gamePlanText lists every section', () => {
  const { plan } = validateGamePlan(good());
  const t = gamePlanText({ ...plan, updatedAt: 1_800_000_000 });
  for (const s of ['Summary: Fury warrior', 'Goal: Reach 60', 'Spec: Fury', 'Weapons: Two-handed axes', 'Solo questing', 'Mining: Gold and ore', 'L10: Learn Defensive Stance', 'Save gold for the mount', 'Heavy grinding', 'Vendor grey items.']) {
    assert.ok(t.includes(s), s);
  }
});

test('every field that reaches the per-prompt line or the card stays on one line', () => {
  const r = validateGamePlan({
    summary: 'ok', goal: 'ok',
    role: { spec: 'Fury\nArms' },
    playstyle: ['solo\nquesting'],
    professions: [{ name: 'Min\ning', why: 'gold\r\nore' }],
    milestones: [{ level: 5, text: 'line1\nIGNORE ALL\r\nline3' }],
    avoid: ['grind\ring'],
  });
  assert.equal(r.ok, false);
  for (const f of ['role.spec', 'playstyle[0]', 'professions[0].name', 'professions[0].why', 'milestones[0].text', 'avoid[0]']) {
    assert.ok(r.errors.includes(`${f}: must be one line (no line breaks)`), `${f}\n${r.errors.join('\n')}`);
  }
});

test('goal and notes may span lines; Windows line ends become plain ones', () => {
  const r = validateGamePlan({ summary: 'ok', goal: 'Reach 60\r\nwith friends', notes: 'one\ntwo' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.plan.goal, 'Reach 60\nwith friends');
  assert.equal(r.plan.notes, 'one\ntwo');
});

test('control characters are refused everywhere, tabs included', () => {
  const r = validateGamePlan({ summary: 'a\u0007b', goal: 'tab\there', notes: 'nul\u0000', milestones: [{ text: 'esc\u001b[2J' }] });
  assert.equal(r.ok, false);
  for (const f of ['summary', 'goal', 'notes', 'milestones[0].text']) {
    assert.ok(r.errors.some((e) => e.startsWith(`${f}: contains control characters`)), `${f}\n${r.errors.join('\n')}`);
  }
});

test('invisible line and direction characters are refused in every field', () => {
  // NEL, the C1 range, line/paragraph separators, bidi embeddings/overrides/isolates and the
  // direction marks: they break or reorder the one plan line that goes before every prompt.
  const bad = ['\u0085', '\u0080', '\u009f', '\u2028', '\u2029', '\u202a', '\u202e', '\u2066', '\u2069', '\u200e', '\u200f', '\u061c'];
  for (const c of bad) {
    const r = validateGamePlan({
      // In the middle: trim() would drop a trailing U+2028 harmlessly.
      summary: `a${c}b`, goal: `g${c}g`, notes: `n${c}n`,
      role: { spec: `s${c}s`, weapons: `w${c}w`, notes: `r${c}r` },
      playstyle: [`p${c}p`], avoid: [`v${c}v`],
      professions: [{ name: `m${c}m`, why: `y${c}y` }],
      milestones: [{ text: `t${c}t` }],
    });
    const hex = c.codePointAt(0).toString(16);
    assert.equal(r.ok, false, hex);
    for (const f of ['summary', 'goal', 'notes', 'role.spec', 'role.weapons', 'role.notes', 'playstyle[0]', 'avoid[0]', 'professions[0].name', 'professions[0].why', 'milestones[0].text']) {
      assert.ok(r.errors.some((e) => e.startsWith(`${f}: contains control characters`)), `${hex} ${f}\n${r.errors.join('\n')}`);
    }
  }
});

test('plain accents, emoji and other scripts stay allowed', () => {
  const r = validateGamePlan({ summary: 'Jäger — Überleben 🏹', goal: 'Erreiche Stufe 60\nmit Freunden', notes: 'Ελληνικά, 日本語, عربى' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('a too-long field with a line break gets both errors in one round', () => {
  const r = validateGamePlan({ summary: 'ok', goal: 'ok', milestones: [{ text: `${'x'.repeat(60)}\n${'y'.repeat(60)}` }] });
  assert.ok(r.errors.includes('milestones[0].text: 121 characters, at most 100'), r.errors.join('\n'));
  assert.ok(r.errors.includes('milestones[0].text: must be one line (no line breaks)'), r.errors.join('\n'));
});

test('gamePlanLine never carries a line break', () => {
  const { plan } = validateGamePlan({ summary: 'ok', goal: 'a\nb', milestones: [{ text: 'next one' }], notes: 'x\ny' });
  assert.doesNotMatch(gamePlanLine(plan, 1), /[\r\n]/);
});
