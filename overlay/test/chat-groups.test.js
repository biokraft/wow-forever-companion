import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChats, dateLabel } from '../src/chat-groups.js';

// Seconds for a local date and time, so the tests hold in any time zone.
const at = (y, mo, d, h = 0, mi = 0, s = 0) => Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);
const item = (id, updatedAt) => ({ id, title: id, updatedAt });
const NOW = at(2026, 11, 25, 14, 30);

test('empty input gives no groups', () => {
  assert.deepEqual(groupChats([], NOW), []);
});

test('chats fall under Today, Yesterday and Earlier in their given order', () => {
  const items = [
    item('a', at(2026, 11, 25, 13, 0)),
    item('b', at(2026, 11, 25, 9, 0)),
    item('c', at(2026, 11, 24, 22, 0)),
    item('d', at(2026, 11, 20, 8, 0)),
    item('e', at(2025, 3, 2, 8, 0)),
  ];
  const groups = groupChats(items, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ['Today', ['a', 'b']],
    ['Yesterday', ['c']],
    ['Earlier', ['d', 'e']],
  ]);
});

test('empty groups are left out', () => {
  const groups = groupChats([item('x', at(2026, 11, 1, 12))], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Earlier']);
});

test('the day boundaries are local midnights', () => {
  const items = [
    item('today-start', at(2026, 11, 25, 0, 0, 0)),
    item('yesterday-end', at(2026, 11, 24, 23, 59, 59)),
    item('yesterday-start', at(2026, 11, 24, 0, 0, 0)),
    item('before-yesterday', at(2026, 11, 23, 23, 59, 59)),
  ];
  const groups = groupChats(items, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ['Today', ['today-start']],
    ['Yesterday', ['yesterday-end', 'yesterday-start']],
    ['Earlier', ['before-yesterday']],
  ]);
});

test('just after midnight, late last evening is Yesterday', () => {
  const now = at(2026, 11, 25, 0, 0, 30);
  const groups = groupChats([item('late', at(2026, 11, 24, 23, 50))], now);
  assert.deepEqual(groups.map((g) => g.label), ['Yesterday']);
});

test('a time slightly ahead of now (clock skew) counts as Today', () => {
  const groups = groupChats([item('ahead', NOW + 120)], NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today']);
});

test('dateLabel gives the local day and short English month', () => {
  assert.equal(dateLabel(at(2026, 11, 3, 10)), '3 Nov');
  assert.equal(dateLabel(at(2026, 1, 31, 23, 59)), '31 Jan');
  assert.equal(dateLabel(at(2026, 5, 1, 0, 0)), '1 May');
});
