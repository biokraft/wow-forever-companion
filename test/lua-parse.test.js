import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSavedVariables, LuaParseError } from '../src/lua/parse.js';

const one = (src) => parseSavedVariables(`X = ${src}`).X;

test('positional table becomes an array', () => {
  assert.deepEqual(one('{\n1,\n2,\n3,\n}'), [1, 2, 3]);
});

test('-- [n] comments are ignored', () => {
  assert.deepEqual(one('{\n"a", -- [1]\n"b", -- [2]\n}'), ['a', 'b']);
});

test('mixed keys become an object with stringified numeric keys', () => {
  assert.deepEqual(one('{\n["a"] = 1,\n[2] = "b",\n}'), { a: 1, 2: 'b' });
});

test('explicit 1..n integer keys become an array', () => {
  assert.deepEqual(one('{\n[1] = "a",\n[2] = "b",\n}'), ['a', 'b']);
});

test('sparse integer keys stay an object', () => {
  assert.deepEqual(one('{\n[1] = 1,\n[3] = 3,\n}'), { 1: 1, 3: 3 });
});

test('empty table becomes an empty array', () => {
  assert.deepEqual(one('{\n}'), []);
});

test('string escapes decode', () => {
  assert.equal(one('"a\\"b\\\\c\\n\\065"'), 'a"b\\c\nA');
});

test('nil, booleans and numbers decode', () => {
  const v = parseSavedVariables('A = nil\nB = true\nC = false\nD = -12.5\nE = 1e3\nF = 0x10\n');
  assert.deepEqual(v, { A: null, B: true, C: false, D: -12.5, E: 1000, F: 16 });
});

test('multiple top-level variables parse', () => {
  assert.deepEqual(parseSavedVariables('\nA = 1\nB = {\n"x",\n}\n'), { A: 1, B: ['x'] });
});

test('fixture: full ForeverLog SavedVariables file parses', () => {
  const text = fs.readFileSync(new URL('./fixtures/sv/ForeverLog.lua', import.meta.url), 'utf8');
  const { ForeverLogDB } = parseSavedVariables(text);
  assert.equal(ForeverLogDB.snapshot.level, 12);
  assert.equal(ForeverLogDB.snapshot.equipped['16'].name, 'Wood Chopper');
  assert.deepEqual(ForeverLogDB.snapshot.completedQuests, [4641, 788, 790]);
  assert.equal(ForeverLogDB.journal.length, 3);
  assert.equal(ForeverLogDB.snapshot.quests[0].objectives[0].have, 4);
});

test('truncated input throws LuaParseError with a line number', () => {
  const text = fs.readFileSync(new URL('./fixtures/sv/ForeverLog.lua', import.meta.url), 'utf8');
  assert.throws(() => parseSavedVariables(text.slice(0, 800)), (e) => e instanceof LuaParseError && e.line > 1);
});
